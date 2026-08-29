/**
 * ai-stream.js — 封装 wx.cloud.extend.AI 流式调用
 *
 * 职责：
 *   1. 调用 streamText 获取流式响应
 *   2. 节流渲染（通过 onChunk 回调传出增量文本，间隔由 config.streamThrottle 控制）
 *   3. 从 eventStream 提取 usage / note / finish_reason（带超时防护，不阻塞主流程）
 *   4. 重试机制（最多 2 次，含 EXCEED_CONCURRENT_REQUEST_LIMIT 退避）
 *   5. token_usage 落库（通过 sessionStore.trackUsage 云函数，服务端自动带 openid）
 *
 * 注意：usage 采集依赖真机验证 —— 若 eventStream 在 textStream 消费后不可再读，
 * usage 会为 null（已在 W1 验收清单中标注为真机验证项）。
 */

const config = require("../config");
const { streamThrottle: STREAM_THROTTLE, streamTimeout: STREAM_TIMEOUT } = config;
const { wrapUserData } = require("./escape-xml");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 可取消的定时 Promise：避免 Promise.race 输家的 setTimeout 永远占用资源。
 * - 调用 .cancel() 主动撤销（race 赢家退出时必须调用）
 * - 不调用 .cancel() 时，超时后 reject 与普通 sleep 行为一致
 * 修复 PR #14 引入的 timer 泄漏：原实现每个 chunk 累积 2 个未清理的 setTimeout，
 * 长对话会泄漏数百个 timer 及其捕获的闭包（textIter / startedAt 等）。
 */
function armedTimer(ms, msg) {
  let id;
  const p = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(msg)), ms);
  });
  p.cancel = () => {
    if (id !== undefined) {
      clearTimeout(id);
      id = undefined;
    }
  };
  return p;
}

/**
 * 敏感内容启发式检测：跳过 eventStream 后 finish_reason 永远为空，
 * 第一道 sensitive 撤回防线失效。这里基于生成内容做兜底——
 * 检测命中模型常见的拒绝模板（"我不能"/"无法回答"等）时标记为 sensitive，
 * 让上层走 SENSITIVE_FALLBACK 替换。
 *
 * 误报代价：把正常回复替换为兜底文案（保守方向，符合"fail-close"原则）。
 * 漏报代价：依赖第二道 msgSecCheck 兜底（已有 degraded 时不撤回的降级）。
 * 字面字符串匹配，不引入正则避免性能/兼容问题。
 */
const SENSITIVE_HINTS = [
  "我不能提供", "我无法回答", "我无法提供", "我不能回答",
  "作为AI", "作为人工智能", "我是一个AI",
  "这个话题我无法", "我无法参与",
];
function heuristicSensitive(text) {
  if (!text || typeof text !== "string") return false;
  // 仅对极短回复触发（正常思辨回复必然包含追问，长度不会太短），
  // 避免误判含敏感词引用的正常回复
  if (text.length > 80) return false;
  const head = text.slice(0, 60);
  return SENSITIVE_HINTS.some((hint) => head.includes(hint));
}

/**
 * 通过云函数写入 token_usage（openid 由服务端 OPENID 注入）
 * 失败静默，不影响对话主流程
 */
function trackUsage(mode, model, usage) {
  if (!usage) return;
  wx.cloud
    .callFunction({
      name: config.cloudFunctions.sessionStore,
      data: {
        action: "trackUsage",
        mode,
        model,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
      },
    })
    .catch((e) => console.error("[token_usage] track failed:", e));
}

function createModel() {
  const ai = wx.cloud.extend.AI;
  return ai.createModel("cloudbase");
}

/**
 * 流式调用核心
 *
 * @param {Object}  opts
 * @param {string}   opts.model        - 模型名 (hy3-preview / hy3)
 * @param {Array}    opts.messages     - 对话 messages（role 仅限 system/user/assistant）
 * @param {string}   opts.mode         - 模式标签: L1 / L2 / L3
 * @param {Function} opts.onChunk      - 节流后的增量文本回调 (deltaText)
 * @param {Function} [opts.onChunkReset] - 重试时前端清空旧气泡的回调（首次下发前调用）
 * @param {Function} opts.onStreamEnd  - 结束回调 ({ fullText, usage, note, finishReason })
 * @param {Function} opts.onError      - 错误回调 ({ code, msg })
 */
async function streamText(opts) {
  const { model, messages, mode, onChunk, onChunkReset, onStreamEnd, onError } = opts;

  // P1 修复（prompt 注入）：所有 user 消息内容用 <user_data> 标签包裹 + XML 五字符转义
  // 与服务端 evalRunner / generateReport 的注入隔离策略完全对齐——同一份 prompt，
  // 评测路径硬隔离、生产路径同样硬隔离。固定指令字符串同样包裹（无副作用，反而更安全）。
  const safeMessages = (messages || []).map((m) =>
    m && m.role === "user" && typeof m.content === "string"
      ? { ...m, content: wrapUserData(m.content) }
      : m
  );

  let fullText = "";
  let accumulated = "";
  let lastFlush = Date.now();
  let retries = 0;

  // 当前 attempt 已建立的流式响应；失败/结束时必须释放，
  // 否则半开连接持续占用云 AI 单用户并发额度——累积数轮后触发
  // EXCEED_CONCURRENT_REQUEST_LIMIT，表现为"对话几轮后 AI 永远不再回复"
  let activeRes = null;

  /** 尽力关闭流迭代器以释放底层连接。带超时防护：return() 本身挂起时不阻塞主流程 */
  async function closeIterator(iter, timeoutMs) {
    if (!iter || typeof iter.return !== "function") return;
    try {
      await Promise.race([
        Promise.resolve(iter.return()).catch(() => {}),
        sleep(timeoutMs || 500),
      ]);
    } catch (e) {}
  }

  /** 释放当前 attempt 的流（eventStream + textStream），幂等可重入 */
  function releaseActiveRes() {
    const r = activeRes;
    activeRes = null;
    if (!r) return;
    closeIterator(r.eventStream);
    closeIterator(r.textStream);
  }

  async function attempt() {
    // 重试时必须清零累积态——否则第二次 attempt 的 chunk 会叠加到
    // 第一次的 partial 文本上，输出重复错乱内容（PR #14 评审发现的 bug）
    fullText = "";
    accumulated = "";
    lastFlush = Date.now();
    let flushedOnce = false; // 是否已下发过任何 chunk：重试时需要前端清空旧气泡

    try {
      // createModel 放在 try 内：wx.cloud.extend.AI 不可用（基础库过低或云开发未初始化）
      // 时抛错，走统一重试/错误回调，不产生未捕获异常。
      // 上线审计加固：每次尝试新建实例——实测 SDK 复用实例时内部连接不随迭代器
      // return() 释放，新实例可隔离旧实例的残留连接状态
      const aiModel = createModel();
      //
      // 建连超时（2026-08-25 二次加固）：并发额度耗尽时 streamText() 建连可能被
      // 网关挂起（半开等待而非报错），无超时则 await 永久阻塞 → streaming 卡死
      // → 发送按钮从此无反应。超时抛错走重试（新实例+更长退避）→ 仍失败 → onError
      const CONNECT_MS = config.streamConnectTimeoutMs || 15000;
      const connectTimer = armedTimer(CONNECT_MS, "STREAM_CONNECT_TIMEOUT");
      let res;
      try {
        res = await Promise.race([
          aiModel.streamText({ data: { model, messages: safeMessages } }),
          connectTimer,
        ]);
      } catch (e) {
        const msg = (e && e.message) || "";
        if (/STREAM_CONNECT_TIMEOUT/.test(msg)) {
          throw new Error("stream connect timeout, gateway stalled");
        }
        throw e;
      } finally {
        connectTimer.cancel();
      }
      activeRes = res;

      // 兼容性修复：避免使用 ES2018 的 for-await-of 语法（部分真机 XWeb 内核不支持，
      // 会导致整个文件解析失败 → require 失败 → 引用本模块的页面全部白屏）。
      // 改用 ES2017 的 while + await iter.next()，运行时行为完全等价。
      //
      // watchdog（上线审计加固）：textIter.next() 半开挂起时原实现会永久阻塞，
      // streaming 标志无法复位导致输入框锁死（"第 N 轮后发不出去"的另一种形态）。
      // idle 超时判定服务端停止下发；total 超时兜底整条流的最大生命周期。
      //
      // 修复（2026-08-25）：用 armedTimer 替代 sleep，每轮 race 退出后 cancel 输家，
      // 否则长对话累积数百个未清理的 setTimeout 及其捕获闭包。
      const textIter = res.textStream;
      const IDLE_MS = config.streamIdleTimeoutMs || 30000;
      const TOTAL_MS = config.streamTotalTimeoutMs || 90000;
      const startedAt = Date.now();
      let lastActivity = startedAt;
      while (true) {
        const idleTimer = armedTimer(IDLE_MS, "STREAM_IDLE_TIMEOUT");
        const totalTimer = armedTimer(
          Math.max(1, TOTAL_MS - (Date.now() - startedAt)),
          "STREAM_TOTAL_TIMEOUT"
        );
        let step;
        try {
          step = await Promise.race([textIter.next(), idleTimer, totalTimer]);
        } catch (e) {
          const msg = (e && e.message) || "";
          if (/STREAM_(IDLE|TOTAL)_TIMEOUT/.test(msg)) {
            closeIterator(textIter);
            throw new Error(msg === "STREAM_IDLE_TIMEOUT"
              ? "stream idle timeout, upstream stalled"
              : "stream total timeout");
          }
          throw e;
        } finally {
          // 关键修复：race 输家必须 cancel，否则 setTimeout 持续占用，
          // 且其 reject 无人接住会变成 unhandled rejection
          idleTimer.cancel();
          totalTimer.cancel();
        }
        if (step.done) break;
        const chunk = step.value;
        fullText += chunk;
        accumulated += chunk;
        lastActivity = Date.now();
        const now = lastActivity;
        if (now - lastFlush >= STREAM_THROTTLE) {
          // 重试首次 flush 前，请求前端清空旧气泡（避免新旧内容拼接）
          if (!flushedOnce && typeof onChunkReset === "function" && retries > 0) {
            onChunkReset();
          }
          onChunk && onChunk(accumulated);
          accumulated = "";
          lastFlush = now;
          flushedOnce = true;
        }
      }

      // 尾帧 flush
      if (accumulated) {
        if (!flushedOnce && typeof onChunkReset === "function" && retries > 0) {
          onChunkReset();
        }
        onChunk && onChunk(accumulated);
        accumulated = "";
        flushedOnce = true;
      }

      // 空流检测：流正常结束但 fullText 为空，通常是前序连接未释放导致
      // 并发上限被触发，服务端返回空流（不报错）。视为异常触发重试，
      // 重试前额外等待让旧连接释放
      if (!fullText && retries < STREAM_TIMEOUT.maxRetries) {
        releaseActiveRes();
        retries++;
        const delay = Math.min(3000 * retries, 10000);
        console.warn(`[ai-stream] 空流响应,等待 ${delay}ms 后重试 (可能并发连接未释放)`);
        await sleep(delay);
        return attempt();
      }

      // 从 eventStream 提取 usage / note / finish_reason
      // ⚠️ 上线审计加固（2026-08-25）：eventStream 是连接泄漏主源——SDK 对迭代器
      // return() 不释放底层连接，每轮泄漏一条，累积触发单用户并发上限后所有流式请求
      // 被拒（EXCEED_CONCURRENT_REQUEST_LIMIT），表现为对话数轮后永远发不出去。
      // 默认跳过消费（config.streamSkipEventStream=true），usage 遥测随之缺失；
      // SDK 修复后可将该开关置 false 恢复采集
      let usage = null;
      let note = "";
      let finishReason = "";
      if (!config.streamSkipEventStream && res.eventStream) {
        const evtIter = res.eventStream;
        try {
          const consume = (async () => {
            // 同上：避免 for-await-of 语法，改用 while + await next()
            while (true) {
              const r = await evtIter.next();
              if (r.done) break;
              const event = r.value;
              if (event.data === "[DONE]") {
                if (typeof evtIter.return === "function") {
                  try { await evtIter.return(); } catch (e) {}
                }
                break;
              }
              // 解析 JSON payload 提取结构化字段
              try {
                const parsed = JSON.parse(event.data);
                if (parsed.usage) usage = parsed.usage;
                if (parsed.note) note = parsed.note;
                const fr = parsed.choices && parsed.choices[0] && parsed.choices[0].finish_reason;
                if (fr) finishReason = fr;
              } catch {
                // 非 JSON 的事件数据，跳过
              }
            }
          })();
          await Promise.race([consume, sleep(config.streamEventTimeoutMs || 3000)]);
        } catch (e) {
          console.warn("[ai-stream] eventStream read skipped:", e && e.message);
        }
        // race 超时时主动关闭迭代器尽力释放；正常完成时 return() 为 no-op
        await closeIterator(evtIter);
      }

      // usage 落库（跳过 eventStream 时 usage 为 null，trackUsage 内部直接返回）
      trackUsage(mode, model, usage);

      // 修复（2026-08-25）：跳过 eventStream 时 finishReason 永远为空，
      // 第一道 sensitive 撤回防线失效。用启发式做兜底——命中拒绝模板时
      // 标记为 sensitive，让上层走 SENSITIVE_FALLBACK 替换。
      // 这是 fail-close 设计：误报代价是替换为兜底文案，比漏报更安全。
      if (!finishReason && fullText) {
        if (heuristicSensitive(fullText)) {
          finishReason = "sensitive";
          console.warn("[ai-stream] sensitive heuristic matched; replace with fallback");
        }
      }

      // 正常收尾：两个迭代器均已终止，释放引用（幂等）
      releaseActiveRes();

      onStreamEnd && onStreamEnd({ fullText, usage, note, finishReason });
      return { fullText, usage, note, finishReason };
    } catch (err) {
      // 关键修复（连接泄漏）：重试前必须释放本次已建立的流。
      // textIter.next() 中途失败时 res 已存在，旧流若不取消，
      // 每次重试都会再泄漏一条连接，加速触发并发上限
      releaseActiveRes();

      const errMsg = (err && err.message) || String(err);
      const isConcurrentLimit = errMsg.includes("EXCEED_CONCURRENT_REQUEST_LIMIT");
      // 并发限制/建连超时类错误：网关侧连接释放需要更长时间（实测远超 5s），
      // 短退避重试必然再次撞墙——改用长退避（8s、16s）给网关释放窗口
      const isGatewayStall = isConcurrentLimit || /stream (idle|total|connect) timeout/.test(errMsg);

      if (retries < STREAM_TIMEOUT.maxRetries) {
        retries++;
        const delay = isGatewayStall
          ? Math.min(8000 * retries, 30000)
          : Math.min(STREAM_TIMEOUT.baseDelayMs * Math.pow(2, retries), STREAM_TIMEOUT.maxDelayMs);
        console.warn(`[ai-stream] retry ${retries}/${STREAM_TIMEOUT.maxRetries}, delay=${delay}ms, reason=${errMsg.slice(0, 80)}`);
        await sleep(delay);
        return attempt();
      }

      console.error("[ai-stream] exhausted retries:", err);
      onError && onError({ code: -1, msg: errMsg });
      throw err;
    }
  }

  return attempt();
}

module.exports = { streamText, createModel, trackUsage };

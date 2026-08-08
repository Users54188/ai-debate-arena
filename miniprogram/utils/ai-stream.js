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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
 * @param {Function} opts.onStreamEnd  - 结束回调 ({ fullText, usage, note, finishReason })
 * @param {Function} opts.onError      - 错误回调 ({ code, msg })
 */
async function streamText(opts) {
  const { model, messages, mode, onChunk, onStreamEnd, onError } = opts;
  const provider = createModel();

  let fullText = "";
  let accumulated = "";
  let lastFlush = Date.now();
  let retries = 0;

  async function attempt() {
    try {
      const res = await provider.streamText({
        data: { model, messages },
      });

      for await (const chunk of res.textStream) {
        fullText += chunk;
        accumulated += chunk;
        const now = Date.now();
        if (now - lastFlush >= STREAM_THROTTLE) {
          onChunk && onChunk(accumulated);
          accumulated = "";
          lastFlush = now;
        }
      }

      // 尾帧 flush
      if (accumulated) {
        onChunk && onChunk(accumulated);
        accumulated = "";
      }

      // 从 eventStream 提取 usage / note / finish_reason
      // 超时防护：即使 eventStream 挂起或不可读，也不阻塞 onStreamEnd
      let usage = null;
      let note = "";
      let finishReason = "";
      try {
        const consume = (async () => {
          for await (const event of res.eventStream) {
            if (event.data === "[DONE]") break;
            if (event.usage) usage = event.usage;
            if (event.note) note = event.note;
            const fr =
              event.finish_reason ||
              event.finishReason ||
              (event.choices && event.choices[0] && event.choices[0].finish_reason);
            if (fr) finishReason = fr;
          }
        })();
        await Promise.race([consume, sleep(config.streamEventTimeoutMs || 3000)]);
      } catch (e) {
        console.warn("[ai-stream] eventStream read skipped:", e && e.message);
      }

      // usage 落库
      trackUsage(mode, model, usage);

      onStreamEnd && onStreamEnd({ fullText, usage, note, finishReason });
      return { fullText, usage, note, finishReason };
    } catch (err) {
      const errMsg = (err && err.message) || String(err);
      const isConcurrentLimit = errMsg.includes("EXCEED_CONCURRENT_REQUEST_LIMIT");

      if (retries < STREAM_TIMEOUT.maxRetries) {
        retries++;
        const delay = isConcurrentLimit
          ? STREAM_TIMEOUT.maxDelayMs
          : Math.min(STREAM_TIMEOUT.baseDelayMs * Math.pow(2, retries), STREAM_TIMEOUT.maxDelayMs);
        console.warn(`[ai-stream] retry ${retries}/${STREAM_TIMEOUT.maxRetries}, delay=${delay}ms`);
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

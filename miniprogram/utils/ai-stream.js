/**
 * ai-stream.js — 封装 wx.cloud.extend.AI 流式调用
 *
 * 职责：
 *   1. 调用 streamText 获取流式响应
 *   2. 120ms 节流渲染（通过回调 onChunk 传入渲染函数）
 *   3. usage 采集 + 自动写入 token_usage 表
 *   4. 重试机制（最多 2 次，含 EXCEED_CONCURRENT_REQUEST_LIMIT 退避）
 *   5. 统一错误格式
 */

const config = require("../config");
const { STREAM_THROTTLE, STREAM_TIMEOUT } = config;

/**
 * 带退避的 sleep
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 写入 token_usage
 */
function writeUsage(db, openid, mode, model, usage) {
  if (!db) return;
  db.collection(config.collections.tokenUsage)
    .add({
      data: {
        openid,
        mode,
        model,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        createdAt: db.serverDate(),
      },
    })
    .catch((e) => console.error("[token_usage] write failed:", e));
}

/**
 * 创建 AI 模型实例
 */
function createModel() {
  const ai = wx.cloud.extend.AI;
  return ai.createModel("cloudbase");
}

/**
 * 流式调用核心
 *
 * @param {Object}  opts
 * @param {string}  opts.model        - 模型名 (hy3-preview / hy3)
 * @param {Array}   opts.messages     - 对话 messages
 * @param {string}  opts.mode         - 模式标签: L1 / L2 / L3
 * @param {Function} opts.onChunk     - 节流后的文本回调 (accumulatedText)
 * @param {Function} opts.onStreamEnd - 结束时回调 ({ fullText, usage, note })
 * @param {Function} opts.onError     - 错误回调 (error)
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
      }

      // 从 eventStream 提取 usage
      let usage = null;
      let note = "";
      for await (const event of res.eventStream) {
        if (event.data === "[DONE]") break;
        if (event.usage) usage = event.usage;
        if (event.note) note = event.note;
      }

      onStreamEnd && onStreamEnd({ fullText, usage, note });
      return { fullText, usage, note };
    } catch (err) {
      const errMsg = err?.message || String(err);
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

module.exports = { streamText, createModel, writeUsage };

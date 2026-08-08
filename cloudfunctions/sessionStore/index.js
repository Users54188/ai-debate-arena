const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * sessionStore — 会话持久化 + 用量记录
 * W1 会话读写返回 mock；W2 实现完整 get/append 逻辑。
 *
 * 接口：
 *   action: "get" | "append" | "trackUsage"
 *   get:        { sessionId }
 *   append:     { sessionId, userId, role, content, round }
 *   trackUsage: { mode, model, prompt_tokens, completion_tokens }
 */
exports.main = async (event) => {
  const { action } = event;

  switch (action) {
    case "get":
      return { code: 0, data: { ok: true, session: null } };

    case "append":
      return { code: 0, data: { ok: true } };

    case "trackUsage": {
      try {
        const { OPENID } = cloud.getWXContext();
        await db.collection("token_usage").add({
          data: {
            openid: OPENID || "",
            mode: event.mode || "unknown",
            model: event.model || "",
            prompt_tokens: event.prompt_tokens || 0,
            completion_tokens: event.completion_tokens || 0,
            total_tokens: (event.prompt_tokens || 0) + (event.completion_tokens || 0),
            createdAt: db.serverDate(),
          },
        });
        return { code: 0, data: { ok: true } };
      } catch (e) {
        console.error("[sessionStore] trackUsage failed:", e);
        return { code: -1, msg: "trackUsage failed" };
      }
    }

    default:
      return { code: -1, msg: `Unknown action: ${action}` };
  }
};

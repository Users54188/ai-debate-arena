const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * sessionStore — 会话持久化
 * W1 返回 mock；W2 实现完整 get/append 逻辑。
 *
 * 接口：
 *   action: "get" | "append"
 *   get:    { sessionId }
 *   append: { sessionId, userId, role, content, round }
 */
exports.main = async (event) => {
  const { action } = event;

  switch (action) {
    case "get":
      return { code: 0, data: { ok: true, session: null } };
    case "append":
      return { code: 0, data: { ok: true } };
    default:
      return { code: -1, msg: `Unknown action: ${action}` };
  }
};

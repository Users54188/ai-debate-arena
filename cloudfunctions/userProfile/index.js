const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * userProfile — 用户档案查询
 * W1 返回 mock；W2 对接 users 表。
 *
 * 接口：
 *   { action: "get" }
 * 返回：
 *   { code: 0, data: { rank, totalSessions, totalRounds, avgScore, winRate } }
 */
exports.main = async (event) => {
  const { action } = event;

  if (action === "get") {
    return {
      code: 0,
      data: {
        rank: "青铜",
        totalSessions: 0,
        totalRounds: 0,
        avgScore: 0,
        winRate: 0,
      },
    };
  }

  return { code: -1, msg: `Unknown action: ${action}` };
};

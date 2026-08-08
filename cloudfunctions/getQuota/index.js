const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * getQuota — 每日配额查询
 * W1 单模式查询；W2 扩展跨模式聚合。
 *
 * 接口：{ mode: "L1"|"L2"|"L3" }
 * 返回：{ used: number, limit: number, available: boolean }
 */
const DAILY_LIMITS = { L1: 3, L2: 2, L3: 1 };

exports.main = async (event) => {
  const { mode = "L1" } = event;
  const { OPENID } = cloud.getWXContext();
  const limit = DAILY_LIMITS[mode] || 3;

  // 获取今日已用量（按 sessions 集合的 createdAt 统计当天）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const res = await db
      .collection("sessions")
      .where({
        _openid: OPENID || "",
        mode,
        createdAt: _.gte(today).and(_.lt(tomorrow)),
      })
      .count();

    const used = res.total || 0;
    return {
      code: 0,
      data: {
        used,
        limit,
        available: used < limit,
      },
    };
  } catch (e) {
    console.error("[getQuota] query failed:", e);
    // 降级：查询失败时放行（不影响用户使用）
    return { code: 0, data: { used: 0, limit, available: true } };
  }
};

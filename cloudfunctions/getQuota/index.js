const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * getQuota — 每日配额查询
 * W1 单模式查询；W2 依赖 sessionStore.append 写入 sessions 后生效。
 *
 * 接口：{ mode: "L1"|"L2"|"L3" }
 * 返回：{ used: number, limit: number, available: boolean }
 *
 * 契约（W2 必须遵守）：
 * - sessions 文档由云函数写入时须显式携带 openid 字段（cloud.getWXContext().OPENID）
 *   与 createdAt: db.serverDate()；_openid 系统字段不会在云函数写入时自动注入
 * - 今日区间按北京时间（UTC+8）显式计算，不依赖云函数时区配置
 */
const DAILY_LIMITS = { L1: 3, L2: 2, L3: 1 };

exports.main = async (event) => {
  const { mode = "L1" } = event;
  const { OPENID } = cloud.getWXContext();
  const limit = DAILY_LIMITS[mode] || 3;

  // 显式计算北京时间（UTC+8）今日区间，不依赖云函数时区配置
  const OFFSET = 8 * 3600 * 1000;
  const bjDayStartUtc = Math.floor((Date.now() + OFFSET) / 86400000) * 86400000 - OFFSET;
  const today = new Date(bjDayStartUtc);
  const tomorrow = new Date(bjDayStartUtc + 86400000);

  try {
    const res = await db
      .collection("sessions")
      .where({
        openid: OPENID || "",
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

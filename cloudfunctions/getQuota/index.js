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

// 段位分档（与 userProfile 保持一致）。limit 按 classify 决定，实现"精准分类"。
const TIERS = {
  new:      { daily: { L1: 3,  L2: 2,  L3: 1 },  maxRounds: 10 },
  bronze:   { daily: { L1: 5,  L2: 3,  L3: 2 },  maxRounds: 12 },
  silver:   { daily: { L1: 8,  L2: 5,  L3: 3 },  maxRounds: 15 },
  gold:     { daily: { L1: 12, L2: 8,  L3: 5 },  maxRounds: 20 },
  platinum: { daily: { L1: 20, L2: 12, L3: 8 },  maxRounds: 30 },
  diamond:  { daily: { L1: 30, L2: 20, L3: 12 }, maxRounds: 40 },
  king:     { daily: { L1: 50, L2: 30, L3: 20 }, maxRounds: 60 },
  beta:     { daily: { L1: 999, L2: 999, L3: 999 }, maxRounds: 999 },
};

async function getClassify(OPENID) {
  try {
    const u = await db.collection("users").doc(OPENID || "").get();
    return (u.data && u.data.classify) || "new";
  } catch (e) {
    return "new";
  }
}

exports.main = async (event) => {
  const { mode = "L1" } = event;
  const { OPENID } = cloud.getWXContext();
  const classify = await getClassify(OPENID);
  const tier = TIERS[classify] || TIERS.new;
  const limit = tier.daily[mode] || DAILY_LIMITS[mode] || 3;

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

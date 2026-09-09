const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * getQuota — 每日配额查询（按段位 classify 分档）
 *
 * 接口：{ mode: "L1"|"L2"|"L3" }
 * 返回：{ used, limit, available, classify, tierMaxRounds }
 *
 * 契约（必须遵守）：
 * - sessions 文档须显式携带 openid + createdAt: db.serverDate()
 * - 今日区间按北京时间（UTC+8）显式计算，不依赖云函数时区配置
 * - 档位限制完全服务端决定，客户端只读；重启小程序无法绕过（同一微信账号 openid 不变）
 *
 * 测试期：TIERS.beta = 999；上线前还原（与 userProfile / sessionStore 同源）
 */

// 兜底默认值（用于 classify 缺失或异常情况）
const DAILY_LIMITS = { L1: 3, L2: 2, L3: 1 };

// 配额旁路开关：测试期可置 true 强制按 beta 档（999）计算；
// ⚠️ 正式上线必须改回 false 还原正式配额（与 sessionStore / userProfile 同步）
const QUOTA_BYPASS = false;

// 段位分档：与 userProfile / sessionStore 保持一致
// 配额调整（2026-09-09）：所有段位统一 L1 30 / L2 20 / L3 10（用户反馈原阶梯太陡）
const TIERS = {
  new:      { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  bronze:   { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  silver:   { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  gold:     { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  platinum: { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  diamond:  { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  king:     { daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
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
  const tier = QUOTA_BYPASS ? TIERS.beta : (TIERS[classify] || TIERS.new);
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
        classify,
        tierMaxRounds: tier.maxRounds,
      },
    };
  } catch (e) {
    console.error("[getQuota] query failed:", e);
    // 降级：查询失败时放行（不影响用户使用；fail-open，避免单点故障卡死全部用户）
    return { code: 0, data: { used: 0, limit, available: true, classify, tierMaxRounds: tier.maxRounds } };
  }
};

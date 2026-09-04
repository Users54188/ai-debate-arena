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

// 兜底默认值（用于 classify 缺失或异常情况）；与 TIERS.new 对齐
const DAILY_LIMITS = { L1: 8, L2: 5, L3: 3 };

// 正式档：按 classify 实际档位返回配额，与 sessionStore / userProfile 的
// 同名开关保持同步；正式上线版（2026-09-02 已还原并放宽）
const QUOTA_BYPASS = false;

// 段位分档：与 userProfile / sessionStore 保持一致
// 正式上线版（2026-09-02 放宽）：体验优先，兼顾微信 AI 免费额度
const TIERS = {
  new:      { daily: { L1: 8,   L2: 5,   L3: 3  },  maxRounds: 30  },
  bronze:   { daily: { L1: 15,  L2: 8,   L3: 5  },  maxRounds: 40  },
  silver:   { daily: { L1: 25,  L2: 12,  L3: 8  },  maxRounds: 50  },
  gold:     { daily: { L1: 40,  L2: 20,  L3: 12 },  maxRounds: 60  },
  platinum: { daily: { L1: 60,  L2: 30,  L3: 18 },  maxRounds: 80  },
  diamond:  { daily: { L1: 100, L2: 50,  L3: 30 },  maxRounds: 100 },
  king:     { daily: { L1: 200, L2: 100, L3: 50 },  maxRounds: 150 },
  // 内测白名单档（BETA_OPENIDS 为空时不可达）；保留兜底
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
  const rawClassify = await getClassify(OPENID);
  // 兼容测试期遗留的 beta：正式环境按 new 处理（userProfile 会异步把它纠正为真实段位）
  const classify = !QUOTA_BYPASS && rawClassify === "beta" ? "new" : rawClassify;
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

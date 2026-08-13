const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

/**
 * userProfile — 用户档案 / 段位分类 / 配额分档
 *
 * 接口：
 *   { action: "ensure" }                静默建档（首启调用），返回 openid + classify
 *   { action: "get" }                   返回档案 + 实时段位/统计/配额分档
 *   { action: "updateProfile", ... }    保存头像/昵称
 *
 * 段位(分类)由累计轮次映射，写入 users.classify；getQuota / sessionStore
 * 读取该字段做配额分档，实现"用户精准分类 + 防重启绕过"（限制完全服务端决定）。
 */

// 内测白名单（测试期无限配额）。上线前清空或迁库，勿在此硬编码生产账号。
const BETA_OPENIDS = [];

// 分类档位：段位标签 + 每日配额(分模式) + 单日总轮次上限
const TIERS = {
  new:      { rank: "新手", daily: { L1: 3,  L2: 2,  L3: 1 },  maxRounds: 10 },
  bronze:   { rank: "青铜", daily: { L1: 5,  L2: 3,  L3: 2 },  maxRounds: 12 },
  silver:   { rank: "白银", daily: { L1: 8,  L2: 5,  L3: 3 },  maxRounds: 15 },
  gold:     { rank: "黄金", daily: { L1: 12, L2: 8,  L3: 5 },  maxRounds: 20 },
  platinum: { rank: "铂金", daily: { L1: 20, L2: 12, L3: 8 },  maxRounds: 30 },
  diamond:  { rank: "钻石", daily: { L1: 30, L2: 20, L3: 12 }, maxRounds: 40 },
  king:     { rank: "王者", daily: { L1: 50, L2: 30, L3: 20 }, maxRounds: 60 },
  beta:     { rank: "内测", daily: { L1: 999, L2: 999, L3: 999 }, maxRounds: 999 },
};

function computeClassify(stats) {
  if (stats.beta) return "beta";
  const r = stats.totalRounds || 0;
  if (r >= 200) return "king";
  if (r >= 120) return "diamond";
  if (r >= 80) return "platinum";
  if (r >= 50) return "gold";
  if (r >= 30) return "silver";
  if (r >= 10) return "bronze";
  return "new";
}

async function ensureUser(OPENID) {
  const col = db.collection("users");
  const doc = col.doc(OPENID);
  const exist = await doc.get().catch(() => null);
  if (!exist || !exist.data) {
    await doc.set({
      data: {
        openid: OPENID,
        createdAt: db.serverDate(),
        classify: BETA_OPENIDS.includes(OPENID) ? "beta" : "new",
        nickName: "",
        avatar: "",
        updatedAt: db.serverDate(),
      },
    });
  }
  return OPENID;
}

async function getProfile(OPENID) {
  const col = db.collection("users");
  let user = (await col.doc(OPENID).get().catch(() => ({ data: null }))).data;
  if (!user) {
    await ensureUser(OPENID);
    user = { openid: OPENID, classify: "new", nickName: "", avatar: "" };
  }

  const sessRes = await db.collection("sessions").where({ openid: OPENID }).count();
  const totalSessions = sessRes.total || 0;

  let totalRounds = 0;
  let scoreSum = 0;
  try {
    const agg = await db
      .collection("sessions")
      .where({ openid: OPENID })
      .aggregate()
      .group({
        _id: null,
        totalRounds: $.sum("$round"),
        scoreSum: $.sum("$score"),
      })
      .end();
    if (agg.list && agg.list[0]) {
      totalRounds = agg.list[0].totalRounds || 0;
      scoreSum = agg.list[0].scoreSum || 0;
    }
  } catch (e) {
    console.error("[userProfile] aggregate failed:", e);
  }

  const beta = BETA_OPENIDS.includes(OPENID) || user.classify === "beta";
  const classify = computeClassify({ totalRounds, beta });
  await col
    .doc(OPENID)
    .update({ data: { classify, updatedAt: db.serverDate() } })
    .catch(() => {});

  const tier = TIERS[classify] || TIERS.new;
  const avgScore = totalSessions ? Math.round((scoreSum / totalSessions) * 10) / 10 : 0;

  return {
    code: 0,
    data: {
      rank: tier.rank,
      classify,
      totalSessions,
      totalRounds,
      avgScore,
      winRate: 0, // 胜率需辩论/评分体系支撑，暂置 0
      nickName: user.nickName || "",
      avatar: user.avatar || "",
      dailyLimit: tier.daily,
      maxRounds: tier.maxRounds,
    },
  };
}

async function updateProfile(OPENID, data) {
  await db
    .collection("users")
    .doc(OPENID)
    .update({
      data: {
        nickName: data.nickName || "",
        avatar: data.avatar || "",
        updatedAt: db.serverDate(),
      },
    })
    .catch(() => {});
  return { code: 0 };
}

exports.main = async (event) => {
  const { action } = event;
  const { OPENID } = cloud.getWXContext();

  if (action === "ensure") {
    const openid = await ensureUser(OPENID || "");
    return { code: 0, data: { openid, classify: BETA_OPENIDS.includes(openid) ? "beta" : "new" } };
  }

  if (action === "get") {
    return getProfile(OPENID || "");
  }

  if (action === "updateProfile") {
    return updateProfile(OPENID || "", event);
  }

  return { code: -1, msg: `Unknown action: ${action}` };
};

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
 * 段位（classify）由累计轮次映射，写入 users.classify；getQuota / sessionStore
 * 读取该字段做配额分档，实现"用户精准分类 + 防重启绕过"（限制完全服务端决定）。
 *
 * 安全：
 * - 所有调用方 openid 来自 cloud.getWXContext()（服务端），客户端无法伪造
 * - 档案读写均按 OPENID 做 doc 主键，天然无 IDOR
 *
 * 测试期：限制全放开（TIERS.beta = 999）；上线前还原 dailyQuota / maxRounds
 */

// 段位分档：与 getQuota / sessionStore 保持一致
// 配额调整（2026-09-09）：所有段位的单日上限统一上调至 L1 30 / L2 20 / L3 10
// 原阶梯过于陡峭（新手 3/2/1 → 王者 50/30/20），用户反馈早期配额太紧挫败感强
const TIERS = {
  new:      { rank: "新手", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  bronze:   { rank: "青铜", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  silver:   { rank: "白银", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  gold:     { rank: "黄金", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  platinum: { rank: "铂金", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  diamond:  { rank: "钻石", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  king:     { rank: "王者", daily: { L1: 30, L2: 20, L3: 10 }, maxRounds: 60 },
  // 测试期放开档（TODO-上线前清空或收紧）：配合 ENFORCE_QUOTA=false 使用
  beta:     { rank: "内测", daily: { L1: 999, L2: 999, L3: 999 }, maxRounds: 999 },
};

// 内测白名单（测试期无限配额）。TODO-上线前清空：勿在此硬编码生产账号。
const BETA_OPENIDS = [];

// 配额旁路开关：测试期可置 true 让所有用户按 beta 档（999）计算并写回 users.classify；
// ⚠️ 正式上线必须改回 false（与 getQuota / sessionStore 同步）
const QUOTA_BYPASS = false;

function computeClassify(stats) {
  if (QUOTA_BYPASS || stats.beta) return "beta";
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
        // 未成年人标记：默认未知（null）。前端引导用户确认成年后置 false；
        // 显式标记为 true 时启用更严格的内容过滤与配额折减（I5 最小可行版）
        isMinor: null,
        minorConfirmedAt: null,
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

  // 完成场次数来自 sessions 表（status=finished 表示已结束的会话）
  const sessRes = await db.collection("sessions").where({ openid: OPENID }).count();
  const totalSessions = sessRes.total || 0;

  // 累计轮次来自 sessions 表的 round 字段求和
  // Bug 修复（2026-09-09）：云函数 SDK 不支持 where().aggregate() 链式调用，
  // 必须用 aggregate().match() pipeline 形式。原写法抛 "aggregate is not a function"
  // 被 catch 吞掉，导致 totalRounds 永远是 0
  let totalRounds = 0;
  try {
    const sessAgg = await db
      .collection("sessions")
      .aggregate()
      .match({ openid: OPENID })
      .group({ _id: null, totalRounds: $.sum("$round") })
      .end();
    if (sessAgg.list && sessAgg.list[0]) {
      const raw = sessAgg.list[0].totalRounds;
      // 兼容历史数组残留：aggregate 对数组求和会得到非数字结果，兜底转 0
      totalRounds = Number(raw) || 0;
    }
  } catch (e) {
    console.error("[userProfile] sessions aggregate failed:", e);
  }

  // 平均得分 + 胜率来自 reports 表（sessions 表本身没有 score 字段）
  // 胜率定义：得分 ≥ 60 的报告占比（思辨场景的"合格率"）
  const _ = db.command;
  let reportCount = 0;
  let scoreSum = 0;
  let winCount = 0;
  let avgScore = 0;
  let winRate = 0;
  let bestScore = 0;
  try {
    // Bug 修复（2026-09-09）：同样改成 aggregate().match() pipeline 形式
    const repAgg = await db
      .collection("reports")
      .aggregate()
      .match({ openid: OPENID })
      .group({
        _id: null,
        reportCount: $.sum(1),
        scoreSum: $.sum("$score"),
        bestScore: $.max("$score"),
      })
      .end();
    if (repAgg.list && repAgg.list[0]) {
      reportCount = repAgg.list[0].reportCount || 0;
      scoreSum = repAgg.list[0].scoreSum || 0;
      bestScore = Number(repAgg.list[0].bestScore) || 0;
    }
    // 用简单 count 查询拿胜场（避免依赖 aggregate 高级语法 $.cond）
    const winRes = await db
      .collection("reports")
      .where({ openid: OPENID, score: _.gte(60) })
      .count();
    winCount = winRes.total || 0;
    if (reportCount > 0) {
      avgScore = Math.round((scoreSum / reportCount) * 10) / 10;
      winRate = Math.round((winCount / reportCount) * 100);
    }
  } catch (e) {
    console.error("[userProfile] reports aggregate failed:", e);
  }

  const beta = BETA_OPENIDS.includes(OPENID) || user.classify === "beta";
  const classify = computeClassify({ totalRounds, beta });
  await col
    .doc(OPENID)
    .update({ data: { classify, updatedAt: db.serverDate() } })
    .catch(() => {});

  const tier = TIERS[classify] || TIERS.new;

  return {
    code: 0,
    data: {
      rank: tier.rank,
      classify,
      totalSessions,
      totalRounds,
      avgScore,
      bestScore,
      winRate,
      reportCount,
      nickName: user.nickName || "",
      avatar: user.avatar || "",
      dailyLimit: tier.daily,
      maxRounds: tier.maxRounds,
      // 未成年人标记供前端展示与定制提示
      isMinor: user.isMinor === true,
      minorConfirmed: user.isMinor !== null && user.isMinor !== undefined,
    },
  };
}

async function updateProfile(OPENID, data) {
  // 头像/昵称字段长度防御（防超长输入撑爆文档；昵称过 msgSecCheck 由前端调用前完成）
  const nickName = String(data.nickName || "").slice(0, 32);
  const avatar = String(data.avatar || "").slice(0, 500);
  await db
    .collection("users")
    .doc(OPENID)
    .update({
      data: { nickName, avatar, updatedAt: db.serverDate() },
    })
    .catch(() => {});
  return { code: 0 };
}

/** 用户成年确认（首次进入小程序时由前端引导后调用） */
async function confirmNonMinor(OPENID) {
  await db
    .collection("users")
    .doc(OPENID)
    .update({
      data: { isMinor: false, minorConfirmedAt: db.serverDate(), updatedAt: db.serverDate() },
    })
    .catch(() => {});
  return { code: 0 };
}

/**
 * 列出本人 reports（P0 修复 2026-08-27）：前端直查 reports 在"仅创建者可读写"
 * 权限下读不到云函数写入的报告。通过云函数读取，按 OPENID 过滤后返回字段白名单
 */
async function listReports(OPENID, limit) {
  try {
    const res = await db
      .collection("reports")
      .where({ openid: OPENID || "" })
      .orderBy("createdAt", "desc")
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
      .get();
    const reports = (res.data || []).map((r) => ({
      id: r._id,
      sessionId: r.sessionId,
      mode: r.mode || "L1",
      score: r.score || 0,
      baseScore: r.baseScore || 0,
      depthScore: r.depthScore || 0,
      fixScore: r.fixScore || 0,
      degraded: r.degraded === true,
      createdAt: r.createdAt,
    }));
    return { code: 0, data: { reports } };
  } catch (e) {
    console.error("[userProfile] listReports failed:", e);
    return { code: -1, msg: "listReports failed" };
  }
}

exports.main = async (event) => {
  const { action } = event;
  const { OPENID } = cloud.getWXContext();

  if (action === "ensure") {
    const openid = await ensureUser(OPENID || "");
    const classify = QUOTA_BYPASS || BETA_OPENIDS.includes(openid) ? "beta" : "new";
    return { code: 0, data: { openid, classify } };
  }

  if (action === "get") {
    return getProfile(OPENID || "");
  }

  if (action === "updateProfile") {
    return updateProfile(OPENID || "", event);
  }

  if (action === "confirmNonMinor") {
    return confirmNonMinor(OPENID || "");
  }

  if (action === "listReports") {
    return listReports(OPENID || "", event.limit);
  }

  return { code: -1, msg: `Unknown action: ${action}` };
};

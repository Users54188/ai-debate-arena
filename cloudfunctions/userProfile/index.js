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
 *   { action: "bindPhone", code }       用 getPhoneNumber 的一次性 code 换微信手机号并绑定
 *
 * 段位（classify）由累计轮次映射，写入 users.classify；getQuota / sessionStore
 * 读取该字段做配额分档，实现"用户精准分类 + 防重启绕过"（限制完全服务端决定）。
 *
 * 安全：
 * - 所有调用方 openid 来自 cloud.getWXContext()（服务端），客户端无法伪造
 * - 档案读写均按 OPENID 做 doc 主键，天然无 IDOR
 */

// 段位分档：与 getQuota / sessionStore 保持一致
// 正式上线版（2026-09-02 放宽）：体验优先，兼顾微信 AI 免费额度
const TIERS = {
  new:      { rank: "新手", daily: { L1: 8,   L2: 5,   L3: 3  },  maxRounds: 30  },
  bronze:   { rank: "青铜", daily: { L1: 15,  L2: 8,   L3: 5  },  maxRounds: 40  },
  silver:   { rank: "白银", daily: { L1: 25,  L2: 12,  L3: 8  },  maxRounds: 50  },
  gold:     { rank: "黄金", daily: { L1: 40,  L2: 20,  L3: 12 },  maxRounds: 60  },
  platinum: { rank: "铂金", daily: { L1: 60,  L2: 30,  L3: 18 },  maxRounds: 80  },
  diamond:  { rank: "钻石", daily: { L1: 100, L2: 50,  L3: 30 },  maxRounds: 100 },
  king:     { rank: "王者", daily: { L1: 200, L2: 100, L3: 50 },  maxRounds: 150 },
  // 内测白名单档（BETA_OPENIDS 为空时不可达）；保留兜底，仅供临时调试使用
  beta:     { rank: "内测", daily: { L1: 999, L2: 999, L3: 999 }, maxRounds: 999 },
};

// 内测白名单（无限配额）；正式上线保持为空，仅在压测/调试时按需临时填入 openid
const BETA_OPENIDS = [];

// 正式档：按累计轮次映射真实 classify，与 getQuota / sessionStore 同步；
// 正式上线版（2026-09-02 已还原）
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
        phoneNumber: "",   // 微信绑定手机号（仅服务端保存，不回传明文）
        countryCode: "",
        phoneBoundAt: null,
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

  // P0 还原修复（2026-09-02）：原实现 `user.classify === "beta"` 会把测试期
  // 写入的旧 beta 标记带入计算，导致 QUOTA_BYPASS=false 后用户仍永远卡在"内测"段位。
  // 修复：正式档下只在 BETA_OPENIDS 显式白名单命中时才承认 beta，否则按累计轮次重算。
  const beta = BETA_OPENIDS.includes(OPENID);
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
      // 手机号绑定状态（仅回传脱敏号，明文不出服务端）
      phoneBound: !!user.phoneNumber,
      maskedPhone: user.phoneNumber ? maskPhone(user.phoneNumber) : "",
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

/** 手机号脱敏：13812345678 -> 138****5678 */
function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length < 7) return s;
  return s.slice(0, 3) + "****" + s.slice(-4);
}

/**
 * bindPhone — 用前端 getPhoneNumber 回调的一次性 code 换取微信绑定手机号并绑定到当前档案。
 * 安全：openid 来自服务端 getWXContext()；手机号明文只落库不外发，仅回传脱敏号。
 * 前置：小程序需为非个人主体并在公众平台开通「手机号」接口，否则 openapi 会报权限错误。
 */
async function bindPhone(OPENID, code) {
  if (!OPENID) return { code: -1, msg: "no_openid" };
  if (!code) return { code: -1, msg: "missing_code" };
  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    const info = (res && res.phoneInfo) || {};
    const pure = info.purePhoneNumber || info.phoneNumber || "";
    if (!pure) {
      return { code: -1, msg: "empty_phone", errMsg: res && res.errMsg };
    }
    await ensureUser(OPENID);
    await db
      .collection("users")
      .doc(OPENID)
      .update({
        data: {
          phoneNumber: String(pure),
          countryCode: String(info.countryCode || "86"),
          phoneBoundAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    return { code: 0, data: { phoneBound: true, maskedPhone: maskPhone(pure) } };
  } catch (err) {
    console.error("[userProfile] bindPhone error:", err);
    return {
      code: -1,
      msg: "getPhoneNumber_failed",
      errCode: err && err.errCode,
      errMsg: err && err.errMsg,
    };
  }
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

  if (action === "bindPhone") {
    return bindPhone(OPENID || "", event.code);
  }

  if (action === "confirmNonMinor") {
    return confirmNonMinor(OPENID || "");
  }

  if (action === "listReports") {
    return listReports(OPENID || "", event.limit);
  }

  return { code: -1, msg: `Unknown action: ${action}` };
};

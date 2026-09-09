const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  // 模拟真实客户端调用：用 callFunction 触发 userProfile.get
  // callFunction 在云函数间调用时，OPENID 来自首次调用链的 wxContext
  const wx = cloud.getWXContext();
  const OPENID = wx.OPENID || "";

  if (!OPENID) {
    return {
      error: "no openid in context",
      wx,
      hint: "请用真机调试或开发者工具登录后触发，CLI invoke 没有微信身份"
    };
  }

  // 直接复制 getProfile 的查询逻辑做诊断
  // 1. sessions.where({ openid: OPENID }).count()
  const sessCount = await db.collection("sessions").where({ openid: OPENID }).count();

  // 2. sessions aggregate round sum
  let aggRounds = null;
  try {
    const r = await db.collection("sessions")
      .where({ openid: OPENID })
      .aggregate()
      .group({ _id: null, totalRounds: db.command.aggregate.sum("$round") })
      .end();
    aggRounds = r.list;
  } catch (e) {
    aggRounds = { error: e.message };
  }

  // 3. sessions 样本（看真实 openid 字段值）
  const sessSample = await db.collection("sessions").where({ openid: OPENID }).limit(2).get();

  // 4. reports count + 样本
  const repCount = await db.collection("reports").where({ openid: OPENID }).count();
  const repSample = await db.collection("reports").where({ openid: OPENID }).limit(2).get();

  // 5. 所有 reports 看真实 openid 格式（防止字段名不符）
  const allRep = await db.collection("reports").limit(5).get();

  return {
    OPENID,
    OPENID_length: OPENID.length,
    sessions: {
      count: sessCount.total,
      aggRounds,
      sample: (sessSample.data || []).map(s => ({
        _id: s._id,
        round: s.round,
        roundType: typeof s.round,
        openid_in_doc: s.openid,
        openidMatches: s.openid === OPENID
      }))
    },
    reports: {
      count: repCount.total,
      sample: (repSample.data || []).map(r => ({
        _id: r._id,
        score: r.score,
        openid_in_doc: r.openid,
        openidMatches: r.openid === OPENID
      })),
      allSample: (allRep.data || []).map(r => ({
        openid_in_doc: r.openid,
        score: r.score
      }))
    }
  };
};

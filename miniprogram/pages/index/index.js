const config = require("../../config");
const app = getApp();

// 段位映射（与 cloudfunctions/userProfile TIERS 同源）
const RANK_IMAGE_MAP = {
  new:      "/images/rank-bronze.png",
  bronze:   "/images/rank-bronze.png",
  silver:   "/images/rank-silver.png",
  gold:     "/images/rank-gold.png",
  platinum: "/images/rank-gold.png",
  diamond:  "/images/rank-gold.png",
  king:     "/images/rank-gold.png",
  beta:     "/images/rank-bronze.png",
};

const RANK_ORDER = ["new", "bronze", "silver", "gold", "platinum", "diamond", "king"];
const RANK_NEXT_NAME = {
  new: "青铜", bronze: "白银", silver: "黄金", gold: "铂金",
  platinum: "钻石", diamond: "王者", king: "", beta: "",
};
const RANK_THRESHOLD = { new: 0, bronze: 10, silver: 30, gold: 50, platinum: 80, diamond: 120, king: 200 };

function nextRankLabel(c) {
  return RANK_NEXT_NAME[c] || "";
}
function classifyProgress(totalRounds, c) {
  const idx = RANK_ORDER.indexOf(c);
  if (idx < 0 || idx >= RANK_ORDER.length - 1) return 100;
  const cur = RANK_THRESHOLD[c] || 0;
  const nxt = RANK_THRESHOLD[RANK_ORDER[idx + 1]] || cur;
  if (nxt <= cur) return 100;
  const p = Math.round(((totalRounds - cur) / (nxt - cur)) * 100);
  return Math.max(0, Math.min(100, p));
}

Page({
  data: {
    journey: {
      title: "思辨之旅",
      count: 0,
      best: 0,
      mode: "-",
      rankName: "新手",
      rankImage: "/images/rank-bronze.png",
      nextRank: "青铜",
      progress: 0,
    },
    showOnboarding: false,
  },

  async onLoad() {
    // 确保静默建档完成（兼容从 login 页跳转来的场景）
    if (app.globalData.loginReady) {
      try {
        await app.globalData.loginReady;
      } catch (e) {
        console.error("[index] login failed:", e);
      }
    }
    // 首启未引导 → 弹 onboarding
    if (!app.globalData.onboarded) {
      this.setData({ showOnboarding: true });
    }
  },

  onShow() {
    this.loadJourney();
  },

  onOnboardingDone() {
    app.markOnboarded();
    // 用户已勾选"我确认已成年"，服务端记录成年确认（I5 最小可行版）
    wx.cloud
      .callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "confirmNonMinor" },
      })
      .catch((e) => console.warn("[index] confirmNonMinor failed:", e));
    this.setData({ showOnboarding: false });
  },

  /** 聚合本人 reports：完成场次 / 最佳得分 / 最近模式（走云函数） */
  async loadJourney() {
    try {
      // P0 修复（2026-08-27）：原 db.collection("reports").get() 前端直查在
      // "仅创建者可读写"权限下读不到云函数写入的报告。改走 userProfile.listReports
      // 段位展示恢复（2026-09-02）：并行调用 userProfile.get 拿段位信息
      // 修复（2026-09-02）：箭头函数括号逗号表达式在微信 Babel 下解析失败，改用块函数体
      const fetchReports = wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "listReports", limit: 50 },
      }).catch(function (e) {
        console.warn("[index] listReports failed:", e);
        return { result: { code: -1, data: { reports: [] } } };
      });
      const fetchProfile = wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "get" },
      }).catch(function (e) {
        console.warn("[index] get profile failed:", e);
        return { result: { code: -1, data: null } };
      });
      const [reportsRes, profileRes] = await Promise.all([fetchReports, fetchProfile]);

      // —— 报告统计 ——
      const reportsResult = reportsRes.result || {};
      const reports = (reportsResult.code === 0 && reportsResult.data && reportsResult.data.reports) || [];
      let best = 0;
      let latestMode = "-";
      if (reports.length) {
        latestMode = { L1: "L1", L2: "L2", L3: "L3" }[reports[0].mode] || "L1";
        for (const r of reports) {
          if ((r.score || 0) > best) best = r.score || 0;
        }
      }

      // —— 段位信息 ——
      const profileResult = profileRes.result || {};
      const profile = (profileResult.code === 0 && profileResult.data) || null;
      let classify = (profile && profile.classify) || app.globalData.classify || "new";
      // 兼容测试期遗留的内测档：正式环境按新手展示，避免段位徽章与"内测"文案混搭
      if (classify === "beta") classify = "new";
      let rankName = (profile && profile.rank) || "新手";
      if (rankName === "内测") rankName = "新手";
      const rankImage = RANK_IMAGE_MAP[classify] || "/images/rank-bronze.png";
      const nextRank = nextRankLabel(classify);
      const totalRounds = (profile && profile.totalRounds) || 0;
      const progress = nextRank ? classifyProgress(totalRounds, classify) : 100;

      this.setData({
        journey: {
          title: reports.length ? `已完成 ${reports.length} 场思辨` : "开始你的思辨之旅",
          count: reports.length,
          best,
          mode: latestMode,
          rankName,
          rankImage,
          nextRank,
          progress,
        },
      });
    } catch (e) {
      console.error("[index] load journey failed:", e);
    }
  },

  goSocrates() {
    wx.navigateTo({ url: "/pages/socrates/index" });
  },

  goDual() {
    wx.navigateTo({ url: "/pages/dual/index" });
  },

  goDebate() {
    wx.navigateTo({ url: "/pages/debate/index" });
  },

  /** 分享卡片（开屏即支持分享） */
  onShareAppMessage() {
    return {
      title: "AI 思辨场 — 让 AI 不给答案，只追问",
      path: "/pages/index/index",
    };
  },
});

const config = require("../../config");
const { playTabEnter } = require("../../utils/pageMotion");
const { rankBadge } = require("../../utils/rankBadge");
const app = getApp();

// 段位分档（与 userProfile 云函数保持一致）
const RANK_ORDER = ["new", "bronze", "silver", "gold", "platinum", "diamond", "king"];
const RANK_THRESHOLDS = { new: 0, bronze: 10, silver: 30, gold: 50, platinum: 80, diamond: 120, king: 200 };
const RANK_NAMES = {
  new: "新手", bronze: "青铜", silver: "白银", gold: "黄金",
  platinum: "铂金", diamond: "钻石", king: "王者"
};

/** 根据当前累计轮次和段位，计算下一档信息（progress%、nextRank、roundsToNext） */
function computeRankProgress(classify, totalRounds) {
  const curIdx = RANK_ORDER.indexOf(classify);
  if (curIdx < 0 || curIdx === RANK_ORDER.length - 1) {
    // 已达最高段位
    return { nextRank: "", roundsToNext: 0, rankProgress: 100 };
  }
  const nextClassify = RANK_ORDER[curIdx + 1];
  const curThreshold = RANK_THRESHOLDS[classify] || 0;
  const nextThreshold = RANK_THRESHOLDS[nextClassify] || curThreshold;
  const span = nextThreshold - curThreshold;
  const passed = totalRounds - curThreshold;
  const progress = span > 0 ? Math.min(100, Math.max(0, Math.round((passed / span) * 100))) : 0;
  const roundsToNext = Math.max(0, nextThreshold - totalRounds);
  return { nextRank: RANK_NAMES[nextClassify] || nextClassify, roundsToNext, rankProgress: progress };
}

Page({
  data: {
    journey: { count: 0, best: 0, mode: "-" },
    profile: { classify: "new", rank: "新手", totalRounds: 0, nextRank: "", roundsToNext: 0, rankProgress: 0 },
    showOnboarding: false,
    tabAnim: "tab-enter tab-enter--idle",
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
    playTabEnter(this, "/pages/index/index");
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

  /** 并行拉取段位（userProfile.get）和旅程统计（userProfile.listReports） */
  async loadJourney() {
    // 段位
    wx.cloud
      .callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "get" },
      })
      .then((res) => {
        const result = res.result || {};
        if (result.code !== 0 || !result.data) return;
        const d = result.data;
        const classify = d.classify || "new";
        const totalRounds = d.totalRounds || 0;
        const { nextRank, roundsToNext, rankProgress } = computeRankProgress(classify, totalRounds);
        this.setData({
          profile: {
            classify,
            rankBadge: rankBadge(classify),
            rank: d.rank || RANK_NAMES[classify] || "新手",
            totalRounds,
            nextRank,
            roundsToNext,
            rankProgress,
          },
        });
      })
      .catch((e) => console.error("[index] load profile failed:", e));

    // 旅程统计
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "listReports", limit: 50 },
      });
      const result = res.result || {};
      if (result.code !== 0) {
        throw new Error(result.msg || "listReports failed");
      }
      const reports = (result.data.reports) || [];
      let best = 0;
      let latestMode = "-";
      if (reports.length) {
        latestMode = { L1: "L1", L2: "L2", L3: "L3" }[reports[0].mode] || "L1";
        for (const r of reports) {
          if ((r.score || 0) > best) best = r.score || 0;
        }
      }
      this.setData({
        journey: {
          count: reports.length,
          best,
          mode: latestMode,
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

const config = require("../../config");
const app = getApp();

Page({
  data: {
    journey: { title: "思辨之旅", count: 0, best: 0, mode: "-" },
    showOnboarding: false,
  },

  onLoad() {
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
    this.setData({ showOnboarding: false });
  },

  /** 聚合本人 reports：完成场次 / 最佳得分 / 最近模式（纯前端统计） */
  async loadJourney() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection("reports").orderBy("createdAt", "desc").limit(50).get();
      const reports = res.data || [];
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
          title: reports.length ? `已完成 ${reports.length} 场思辨` : "开始你的思辨之旅",
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
    wx.switchTab({ url: "/pages/socrates/index" });
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

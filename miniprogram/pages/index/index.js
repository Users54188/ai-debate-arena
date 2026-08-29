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

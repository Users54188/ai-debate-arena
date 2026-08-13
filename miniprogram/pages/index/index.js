const config = require("../../config");

Page({
  data: {
    l1Quota: config.dailyQuota.L1,
  },

  onLoad() {
    // W1: 首页展示配额，W6 改为动态读取 user_quota 表
  },

  goSocrates() {
    wx.navigateTo({ url: "/packageA/pages/socrates/index" });
  },

  goDual() {
    wx.navigateTo({ url: "/packageA/pages/dual/index" });
  },

  goDebate() {
    // 测试期间临时放开：直接跳转（正式版需实现 L2 完成解锁逻辑）
    wx.navigateTo({ url: "/packageA/pages/debate/index" });
  },
});

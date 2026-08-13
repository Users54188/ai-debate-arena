const config = require("../../config");

Page({
  data: {
    l1Quota: config.dailyQuota.L1,
  },

  onLoad() {
    // W1: 首页展示配额，W6 改为动态读取 user_quota 表
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
});

const config = require("../../config");
const app = getApp();

Page({
  data: {
    profile: null,
    loading: true,
    openid: "",
  },

  onShow() {
    this.setData({
      openid: app.globalData.openid || wx.getStorageSync("openid") || "",
    });
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "get" },
      });
      const d = (res.result && res.result.data) || null;
      this.setData({ profile: d, loading: false });
    } catch (e) {
      console.error("[mine] loadProfile failed:", e);
      this.setData({ loading: false });
    }
  },

  async onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;
    wx.showLoading({ title: "上传中" });
    try {
      const ext = (avatarUrl.match(/\.\w+$/) || [".png"])[0];
      const cloudPath = `avatars/${this.data.openid || "anon"}${ext}`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl });
      const profile = this.data.profile || {};
      this.setData({ profile: Object.assign({}, profile, { avatar: up.fileID }) });
      await this.saveProfile();
    } catch (err) {
      console.error("[mine] upload avatar failed:", err);
      wx.showToast({ title: "头像上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  onNickNameInput(e) {
    const profile = this.data.profile || {};
    this.setData({ profile: Object.assign({}, profile, { nickName: e.detail.value }) });
  },

  onNickNameBlur() {
    this.saveProfile();
  },

  async saveProfile() {
    const profile = this.data.profile || {};
    try {
      await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: {
          action: "updateProfile",
          nickName: profile.nickName || "",
          avatar: profile.avatar || "",
        },
      });
    } catch (e) {
      console.error("[mine] saveProfile failed:", e);
    }
  },

  clearCache() {
    wx.showModal({
      title: "清空本地缓存",
      content: "将清除本机缓存（不影响云端记录与段位），确定？",
      success: (r) => {
        if (r.confirm) {
          wx.clearStorageSync();
          wx.showToast({ title: "已清空", icon: "success" });
        }
      },
    });
  },

  goFeedback() {
    wx.showModal({
      title: "意见反馈",
      content: "内测反馈请按《内测引导文档》提交：机型 / 模式 / 轮次 / 问题描述 / 截图。",
      showCancel: false,
    });
  },
});

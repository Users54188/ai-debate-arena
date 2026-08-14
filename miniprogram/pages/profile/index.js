/**
 * profile 页 — 我的（W6 + W7 接入 userProfile.classify 段位体系）
 *
 * 流程：onShow 调 userProfile.get 拿真实段位（服务端按累计轮次映射）
 *       → 展示段位 + 配额分档 + 统计 + 头像/昵称设置入口
 *
 * 合规：页面常驻 "AI 生成内容仅供参考" 说明（生成式 AI 服务备案提示）
 *       头像/昵称采用 wx.chooseAvatar + nickname input（2024 微信已废弃 getUserProfile 弹窗授权）
 */

const config = require("../../config");
const app = getApp();

const MODE_LABEL = { L1: "单人思辨", L2: "双人共修", L3: "辩论场" };

Page({
  data: {
    profile: null,
    openid: "",
    loading: true,
    showSettings: false,
    rankAnimClass: "",
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
      // 段位升级动效：检测段位名称变化触发动画
      const prevName = this.data.profile && this.data.profile.rank;
      const newName = d && d.rank;
      const rankAnimClass = newName && prevName && newName !== prevName ? "rank-up-anim" : "";
      this.setData({ profile: d, loading: false, rankAnimClass });
      if (rankAnimClass) {
        if (wx.vibrateShort) wx.vibrateShort({ type: "medium" });
        setTimeout(() => this.setData({ rankAnimClass: "" }), 1600);
      }
    } catch (e) {
      console.error("[profile] load failed:", e);
      this.setData({ loading: false });
    }
  },

  /** 头像选择（微信 chooseAvatar 接口） */
  async onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;
    wx.showLoading({ title: "上传中" });
    try {
      const ext = (avatarUrl.match(/\.\w+$/) || [".png"])[0];
      const openid = this.data.openid || "anon";
      const cloudPath = `avatars/${openid}${ext}`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl });
      const profile = this.data.profile || {};
      this.setData({ profile: Object.assign({}, profile, { avatar: up.fileID }) });
      await this.saveProfile();
    } catch (err) {
      console.error("[profile] upload avatar failed:", err);
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
      console.error("[profile] saveProfile failed:", e);
    }
  },

  goHistory() {
    wx.switchTab({ url: "/pages/history/index" });
  },

  goRanking() {
    wx.navigateTo({ url: "/pages/ranking/index" });
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
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

  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content:
        "为提供服务并改进体验，本小程序收集：微信 openid（账号标识）、对话记录（用于会话恢复与报告生成）、头像昵称（仅在你主动设置时保存）。上述信息仅用于本小程序内功能，不对外提供。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showAbout() {
    wx.showModal({
      title: "关于思辨场",
      content:
        "AI 思辨场是一款即时推理式对话应用，2026 微信小程序开发者大赛参赛作品。\n\n所有 AI 生成内容仅供参考，不构成专业建议。",
      showCancel: false,
    });
  },

  /** 分享小程序卡片 */
  onShareAppMessage() {
    return {
      title: `我在「AI 思辨场」练到 ${this.data.profile ? this.data.profile.rank : "新手"} 段位`,
      path: "/pages/index/index",
    };
  },
});

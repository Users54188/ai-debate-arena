/**
 * 登录页 —— 微信授权头像昵称后进入思辨场
 *
 * 流程：
 *   打开小程序 → 检查本地缓存已登录标记
 *     ├─ 已登录 → 自动 redirectTo 首页
 *     └─ 未登录 → 展示头像/昵称授权页
 *         ├─ chooseAvatar 选头像 → 上传云存储
 *         ├─ type=nickname 输入框 → 微信原生昵称填充
 *         └─ "进入思辨场" → silentRegister + updateProfile → 缓存登录态 → 跳首页
 *
 * 头像昵称采用 wx.chooseAvatar + type=nickname（2024 微信新接口），
 * 已废弃 getUserProfile 弹窗授权。
 */

const config = require("../../config");
const app = getApp();

Page({
  data: {
    avatar: "",
    nickName: "",
    entering: false,
  },

  onLoad() {
    // 已登录过（本地缓存标记）→ 直接跳首页，不展示登录页
    if (wx.getStorageSync("loginReady")) {
      this.gotoHome();
      return;
    }
    // 即使没缓存标记，如果 openid 已拿到也视为已登录（兼容旧版本）
    if (app.globalData.openid) {
      wx.setStorageSync("loginReady", true);
      this.gotoHome();
    }
  },

  /** 头像选择（微信 chooseAvatar 接口） */
  async onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;
    this.setData({ avatar: avatarUrl });
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  /** 进入思辨场：静默建档 + 保存头像昵称 → 跳首页 */
  async onEnter() {
    const { avatar, nickName } = this.data;
    if (this.data.entering) return;

    if (!avatar && !nickName.trim()) {
      wx.showToast({ title: "请选择头像或输入昵称", icon: "none", duration: 2000 });
      return;
    }

    this.setData({ entering: true });

    try {
      // 1. 静默建档（拿到 openid）
      await app.silentRegister();
      if (!app.globalData.openid) {
        throw new Error("登录失败，未拿到 openid");
      }

      const openid = app.globalData.openid;

      // 2. 上传头像到云存储（若有）
      let avatarFileID = "";
      if (avatar && avatar.startsWith("http")) {
        try {
          const ext = (avatar.match(/\.\w+$/) || [".png"])[0];
          const cloudPath = "avatars/" + openid + ext;
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: avatar });
          avatarFileID = up.fileID;
        } catch (err) {
          console.error("[login] 头像上传失败:", err);
        }
      }

      // 3. 保存头像昵称到 users 文档
      if (avatarFileID || nickName.trim()) {
        try {
          await wx.cloud.callFunction({
            name: config.cloudFunctions.userProfile,
            data: {
              action: "updateProfile",
              nickName: nickName.trim(),
              avatar: avatarFileID,
            },
          });
        } catch (err) {
          console.warn("[login] 保存头像昵称失败(不阻断):", err);
        }
      }

      // 4. 缓存登录态 + 跳首页
      wx.setStorageSync("loginReady", true);
      wx.showToast({ title: "欢迎进入思辨场", icon: "success", duration: 1500 });
      setTimeout(() => this.gotoHome(), 800);
    } catch (e) {
      console.error("[login] 进入失败:", e);
      wx.showToast({ title: "网络异常，请重试", icon: "none", duration: 2000 });
      this.setData({ entering: false });
    }
  },

  /** 跳过：仅静默建档进入，头像昵称留空 */
  async onSkip() {
    if (this.data.entering) return;
    this.setData({ entering: true });
    try {
      await app.silentRegister();
      wx.setStorageSync("loginReady", true);
      this.gotoHome();
    } catch (e) {
      console.error("[login] 跳过失败:", e);
      wx.showToast({ title: "网络异常，请重试", icon: "none", duration: 2000 });
      this.setData({ entering: false });
    }
  },

  gotoHome() {
    wx.redirectTo({ url: "/pages/index/index" });
  },
});

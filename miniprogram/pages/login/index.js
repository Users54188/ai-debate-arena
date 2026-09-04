/**
 * 登录页 —— 微信授权头像昵称后进入思辨场
 *
 * 流程：
 *   打开小程序 → 检查本地缓存已登录标记
 *     ├─ 已登录 → 自动 redirectTo 首页
 *     └─ 未登录 → 展示头像/昵称授权页
 *         ├─ chooseAvatar 选头像 → 上传云存储
 *         ├─ type=nickname 输入框 → 微信原生昵称填充
 *         ├─ getPhoneNumber 按钮 → 官方手机号验证（区分用户，进入前必做）
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
    phoneVerified: false, // 是否已完成微信官方手机号验证
    maskedPhone: "",      // 脱敏手机号，如 138****5678
    binding: false,       // 手机号换取中
    phoneEnabled: !!config.requirePhoneVerification, // 非个人主体才开启官方手机号验证
  },

  onLoad() {
    this.setData({ phoneEnabled: !!config.requirePhoneVerification });
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

  /** 微信官方手机号验证：getPhoneNumber 回调，拿一次性 code 去云函数换手机号绑定 */
  async onGetPhoneNumber(e) {
    const detail = e.detail || {};
    // 用户拒绝授权
    if (detail.errMsg && detail.errMsg.indexOf("ok") === -1) {
      wx.showToast({ title: "已取消手机号验证", icon: "none", duration: 1800 });
      return;
    }
    const code = detail.code;
    if (!code) {
      wx.showToast({ title: "未获取到授权凭证，请重试", icon: "none", duration: 1800 });
      return;
    }
    if (this.data.binding || this.data.phoneVerified) return;
    this.setData({ binding: true });
    try {
      // 确保已静默建档拿到 openid，手机号按 openid 绑定
      await app.silentRegister();
      if (!app.globalData.openid) throw new Error("no openid");
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "bindPhone", code },
      });
      const r = (res && res.result) || {};
      if (r.code === 0 && r.data) {
        this.setData({ phoneVerified: true, maskedPhone: r.data.maskedPhone || "" });
        wx.showToast({ title: "手机号验证成功", icon: "success", duration: 1200 });
      } else {
        console.error("[login] bindPhone failed:", r);
        wx.showModal({
          title: "手机号验证失败",
          content: this.phoneErrText(r),
          showCancel: false,
          confirmText: "我知道了",
        });
      }
    } catch (err) {
      console.error("[login] bindPhone error:", err);
      wx.showToast({ title: "网络异常，请重试", icon: "none", duration: 1800 });
    } finally {
      this.setData({ binding: false });
    }
  },

  /** 手机号接口失败文案（常见为小程序未开通手机号权限） */
  phoneErrText(r) {
    const ec = r && r.errCode;
    const msg = (r && r.errMsg) || "";
    if (ec === 41003 || ec === 41001 || /permission|scope|unauthorized|权限/i.test(msg)) {
      return "小程序暂未开通手机号验证权限。该接口仅限非个人主体小程序，需在微信公众平台「设置-接口设置」申请「手机号」能力后使用。";
    }
    return "验证服务暂不可用，请稍后重试。";
  },

  /** 进入思辨场：静默建档 + 保存头像昵称 → 跳首页 */
  async onEnter() {
    const { avatar, nickName } = this.data;
    if (this.data.entering) return;

    // 手机号验证用于区分用户；仅非个人主体（config 开关）下强制，个人主体走 openid
    if (config.requirePhoneVerification && !this.data.phoneVerified) {
      wx.showToast({ title: "请先完成微信手机号验证", icon: "none", duration: 2000 });
      return;
    }

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
    wx.switchTab({ url: "/pages/index/index" });
  },
});

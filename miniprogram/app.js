const config = require("./config");

App({
  globalData: {
    openid: "",
    classify: "new",
    onboarded: false,
    loginReady: null, // 登录就绪 Promise，页面 await 它确保 openid 已拿到
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error("CloudBase SDK not available, check base library version.");
    } else {
      console.log('onLaunch called, init cloud...');
      // 修复：wx.cloud.init 为同步调用且不返回 Promise，
      // 链式 .then() 会抛 TypeError 中断 onLaunch，导致后续
      // silentRegister / 版本检查 / 隐私授权全部不执行
      try {
        wx.cloud.init({
          env: config.envId,
          // 多端模式（wxext 运行时）下必须显式传 appid，否则云开发初始化
          // 失败（errCode -601002），所有 callFunction 全部不可用；
          // 普通小程序模式下 appid 从项目配置读取，传入无害
          appid: config.appid,
          traceUser: true,
        });
        console.log('cloud init OK');
      } catch (e) {
        console.error('cloud init FAIL:', e);
      }
    }

    // 静默建档：首次进入即创建 users 文档（服务端 openid 稳定，无需 wx.login 换 code）
    // 存为 Promise 供页面 await，确保进入功能前 openid 已拿到，避免多用户数据混杂
    this.globalData.loginReady = this.silentRegister();

    // 引导态：从本地存储读是否已通过 onboarding
    this.globalData.onboarded = !!wx.getStorageSync("onboarded");

    const sdkVersion = wx.getAppBaseInfo().SDKVersion;
    console.log(`SDKVersion: ${sdkVersion}`);
    const requiredVersion = "3.7.1"; // wx.cloud.extend.AI 最低要求
    if (this.compareVersion(sdkVersion, requiredVersion) < 0) {
      wx.showModal({
        title: "版本过低",
        content: `当前微信版本过低，请升级至基础库 ${requiredVersion} 以上以使用 AI 功能。当前版本：${sdkVersion}`,
        showCancel: false,
      });
    }

    // 隐私授权（2024 起强制）：触发微信原生隐私弹窗，用户拒绝时再按需提示
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: () => console.log("[privacy] authorized"),
        fail: () => console.warn("[privacy] not authorized or no declaration"),
      });
    }
  },

  /** 静默建档 + 段位拉取，写入 globalData 与本地存储供前端页面读 */
  async silentRegister() {
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "ensure" },
      });
      const d = res.result && res.result.data;
      if (d && d.openid) {
        this.globalData.openid = d.openid;
        this.globalData.classify = d.classify || "new";
        wx.setStorageSync("openid", d.openid);
      }
    } catch (e) {
      console.error("[app] userProfile ensure failed:", e);
    }
  },

  /** 标记已完成 onboarding（首次引导三屏后调用） */
  markOnboarded() {
    this.globalData.onboarded = true;
    wx.setStorageSync("onboarded", true);
  },

  compareVersion(v1, v2) {
    const a = v1.split(".").map(Number);
    const b = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] || 0) - (b[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  },
});

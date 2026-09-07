const config = require("./config");
const cache = require("./utils/cache");
const fmt = require("./utils/format");

App({
  globalData: {
    openid: "",
    classify: "new",
    onboarded: false,
    loginReady: null, // 登录就绪 Promise，页面 await 它确保 openid 已拿到
    lastTabIndex: null, // 上一次所在 tab 序号，用于 tab 切换方向动画
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

    // B 方案：后台预取 —— 用户进首页浏览时悄悄拉好 history / profile 数据写入缓存，
    // 用户点 tab 时大概率已就绪，秒开（不阻塞 onLaunch，不 await，失败静默）
    this.prefetchTabData();
  },

  /**
   * 后台预取 tab 数据（B 方案）
   * - 等 silentRegister 完成后再发请求（依赖 openid 在服务端就绪）
   * - 仅写缓存，不更新 globalData（避免污染页面状态机）
   * - 失败静默（首次冷启动云函数慢或失败时，页面会按原有流程兜底）
   */
  async prefetchTabData() {
    try {
      if (this.globalData.loginReady) {
        try { await this.globalData.loginReady; } catch (e) {}
      }
    } catch (e) {}

    // 并行预取，互不阻塞
    const prefetchHistory = wx.cloud
      .callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "list", limit: 50 },
      })
      .then((res) => {
        const result = (res && res.result) || {};
        if (result.code === 0 && result.data && result.data.sessions) {
          const sessions = fmt.formatSessions(result.data.sessions);
          if (sessions.length > 0) cache.set("history:sessions", sessions);
        }
      })
      .catch((e) => console.warn("[app] prefetch history failed:", e && e.message));

    const prefetchProfile = wx.cloud
      .callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "get" },
      })
      .then((res) => {
        const result = (res && res.result) || {};
        if (result.code === 0 && result.data) {
          const d = result.data;
          // 与 profile 页一致的内测档兼容处理
          if (d.classify === "beta") d.classify = "new";
          if (d.rank === "内测") d.rank = "新手";
          cache.set("profile:info", d);
        }
      })
      .catch((e) => console.warn("[app] prefetch profile failed:", e && e.message));

    // 不 await —— 后台并行执行，不阻塞 onLaunch 返回
    Promise.all([prefetchHistory, prefetchProfile]).catch(() => {});
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

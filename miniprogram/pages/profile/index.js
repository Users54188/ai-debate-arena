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
const cache = require("../../utils/cache");
const { msgSecCheck } = require("../../utils/security");
const { playTabEnter } = require("../../utils/pageMotion");
const app = getApp();

const MODE_LABEL = { L1: "单人思辨", L2: "双人共修", L3: "辩论场" };

Page({
  data: {
    profile: null,
    openid: "",
    loading: true,
    loadError: "",
    rankAnimClass: "",
    tabAnim: "tab-enter tab-enter--idle",
  },

  onShow() {
    playTabEnter(this, "/pages/profile/index");
    this.setData({
      openid: app.globalData.openid || wx.getStorageSync("openid") || "",
    });
    // A 方案：缓存秒开 —— 先用本地缓存立即渲染（loading=false），后台再调云函数刷新
    // 命中缓存后 this.data.profile 不为空，下面 loadProfile 的 firstLoad 自然为 false
    if (!this.data.profile) {
      const cached = cache.get("profile:info");
      if (cached) {
        this.setData({
          profile: cached,
          loading: false,
          loadError: "",
          tabAnim: "content-reveal",
        });
      }
    }
    this.loadProfile();
  },

  async loadProfile() {
    // 已有资料（含缓存预填）时后台静默刷新，避免每次切 tab 闪骨架屏
    const firstLoad = !this.data.profile;
    this.setData({ loading: firstLoad, loadError: "" });
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "get" },
      });
      const d = (res.result && res.result.data) || null;
      if (!d) {
        // 服务端返回空数据：首次加载视为错误；已有缓存则保留旧内容不打断
        if (!this.data.profile) {
          this.setData({ loading: false, loadError: "暂时无法加载你的资料，请稍后重试" });
        } else {
          this.setData({ loading: false });
        }
        return;
      }
      // 兼容测试期遗留的内测档：正式环境按新手展示，避免出现"内测"段位
      if (d.classify === "beta") d.classify = "new";
      if (d.rank === "内测") d.rank = "新手";
      // 段位升级动效：检测段位名称变化触发动画
      const prevName = this.data.profile && this.data.profile.rank;
      const newName = d && d.rank;
      const rankAnimClass = newName && prevName && newName !== prevName ? "rank-up-anim" : "";
      // A 方案：写入缓存供下次秒开
      cache.set("profile:info", d);
      this.setData({ profile: d, loading: false, loadError: "", rankAnimClass });
      if (rankAnimClass) {
        if (wx.vibrateShort) wx.vibrateShort({ type: "medium" });
        setTimeout(() => this.setData({ rankAnimClass: "" }), 1600);
      }
    } catch (e) {
      console.error("[profile] load failed:", e);
      // P1 修复：错误态独立化，不再静默吞掉错误让 UI 渲染 0 值
      if (!this.data.profile) {
        this.setData({
          loading: false,
          loadError: "网络异常，资料加载失败，下拉刷新或返回重试",
        });
      } else {
        // 已有资料（含缓存）时后台刷新失败：保留旧内容，不打断浏览
        this.setData({ loading: false });
      }
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

  onNickNameBlur() {
    this.saveProfile();
  },

  async saveProfile() {
    const profile = this.data.profile || {};
    const nickName = (profile.nickName || "").trim();

    // 合规：昵称经 msgSecCheck（scene=1 资料）后再入库，违规拒收并提示
    if (nickName) {
      try {
        const check = await msgSecCheck(nickName, 1);
        if (!check.pass) {
          wx.showToast({
            title: check.degraded ? "网络繁忙，请稍后重试" : "昵称包含违规信息，未保存",
            icon: "none", duration: 2000,
          });
          // 回滚前端昵称为旧值（若有）
          return;
        }
      } catch (e) {
        console.error("[profile] nickName check failed:", e);
        wx.showToast({ title: "昵称校验失败，未保存", icon: "none", duration: 2000 });
        return;
      }
    }

    try {
      await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: {
          action: "updateProfile",
          nickName: nickName,
          avatar: profile.avatar || "",
        },
      });
      // 同步更新缓存（保证下次秒开看到的是最新头像/昵称）
      cache.set("profile:info", this.data.profile);
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
      title: "隐私协议",
      content:
        "我们收集：微信 openid（账号标识）、对话记录（用于会话恢复与报告生成）、头像/昵称（仅在你主动设置时保存）。\n\n" +
        "信息仅用于本小程序内功能，不对外提供。数据存储于境内腾讯云开发服务器。\n\n" +
        "保留期限：至你主动删除或注销账号。\n\n" +
        "你的权利：可查询、更正、删除（历史页长按会话删除；可联系我们删除云端全部数据，15 个工作日内处理）。\n\n" +
        "未成年人：请在监护人陪同下使用。\n\n" +
        "完整《隐私协议》请通过小程序内「我的 - 隐私协议」查看；对本协议有任何疑问，可通过「我的 - 关于与合规」反馈。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showUserAgreement() {
    wx.showModal({
      title: "用户协议",
      content:
        "1. 本服务所有 AI 生成内容（思辨追问、专家讲解、辩论、报告等）均由 AI 模型生成，仅供参考，不构成任何专业建议（医疗、法律、金融、心理咨询等）。\n\n" +
        "2. 你不得输入或传播涉政、涉黄、涉暴、涉毒、谣言、隐私、版权侵犯等内容；系统对所有输入与 AI 输出进行内容安全审核。\n\n" +
        "3. 若你是未成年人，请在监护人陪同下使用并完成本协议确认。\n\n" +
        "4. 你在本服务内生成的内容归你本人所有，但你授予本服务在功能范围内处理你的内容的必要权限。\n\n" +
        "5. 开发者保留在法律法规允许范围内变更、终止服务的权利。\n\n" +
        "完整《用户协议》请通过小程序首次启动时的引导页查看。",
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

/**
 * history 页 — 思辨历史（W6）
 *
 * 流程：onShow 先用本地缓存（含 app 启动后台预取写入）秒开 → 再调 sessionStore.list
 *       后台刷新并覆盖缓存；点击进入 report 页查看报告；长按删除会话
 *
 * 数据来源：CloudBase sessionStore.list 云函数（服务端按 OPENID 过滤返回）
 * 加速策略：A 本地缓存秒开 + B app.onLaunch 预取（见 app.js / utils/cache.js）
 */

const config = require("../../config");
const cache = require("../../utils/cache");
const fmt = require("../../utils/format");
const { playTabEnter } = require("../../utils/pageMotion");

const CACHE_KEY = "history:sessions";

Page({
  data: {
    sessions: [],
    loading: true,
    loadError: "",
    empty: false,
    tabAnim: "tab-enter tab-enter--idle",
  },

  onShow() {
    playTabEnter(this, "/pages/history/index");
    // A 方案：缓存秒开 —— 内存为空时先用本地缓存（app 预取也写同一 key）立即渲染，
    // 随后 loadHistory 后台静默刷新；这样二次进入/预取命中时完全不闪骨架屏
    if (this.data.sessions.length === 0) {
      const cached = cache.get(CACHE_KEY);
      if (Array.isArray(cached) && cached.length > 0) {
        this.setData({
          sessions: cached,
          loading: false,
          empty: false,
          loadError: "",
          tabAnim: "content-reveal",
        });
      }
    }
    this.loadHistory();
  },

  async loadHistory() {
    // 已有列表（内存或缓存预填）时后台静默刷新，避免每次切 tab 都闪骨架屏造成"卡顿感"
    const firstLoad = this.data.sessions.length === 0;
    this.setData({ loading: firstLoad, empty: false, loadError: "" });
    try {
      // P0 修复（2026-08-27）：前端直查在"仅创建者可读写"权限下读不到云函数写入的
      // 文档，改走 sessionStore.list 云函数，由云函数身份读取后按 OPENID 过滤返回
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "list", limit: 50 },
      });
      const result = res.result || {};
      if (result.code !== 0) {
        throw new Error(result.msg || "list failed");
      }
      // 复用统一格式化（与 app 预取同一份逻辑，保证缓存形状一致）
      const sessions = fmt.formatSessions((result.data || {}).sessions);
      // A：回写缓存供下次秒开；空列表则清掉旧缓存，避免删光后仍闪现已删记录
      if (sessions.length > 0) {
        cache.set(CACHE_KEY, sessions);
      } else {
        cache.del(CACHE_KEY);
      }
      this.setData({
        sessions,
        loading: false,
        empty: sessions.length === 0,
        loadError: "",
        // 首次（无缓存）：骨架 → 内容柔和上浮淡入；后台刷新保持 tab 方向动画不重放
        tabAnim: firstLoad ? "content-reveal" : this.data.tabAnim,
      });
    } catch (e) {
      console.error("[history] load failed:", e);
      // P1 修复：错误态独立化（原实现把异常折叠为空列表，用户不知道是真空还是出错）
      if (this.data.sessions.length === 0) {
        this.setData({
          loading: false,
          empty: false,
          loadError: "历史记录加载失败，下拉刷新重试",
          tabAnim: "content-reveal",
        });
      } else {
        // 已有列表时后台刷新失败：保留旧内容，不打断浏览
        this.setData({ loading: false });
      }
    }
  },

  goReport(e) {
    const id = (e.currentTarget.dataset || {}).id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/report/index?sessionId=${id}` });
  },

  goHome() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  onDelete(e) {
    const id = (e.currentTarget.dataset || {}).id;
    if (!id) return;
    wx.showModal({
      title: "删除这条会话？",
      content: "删除后对应的思辨报告也将不可用",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#DC2626",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          // P1 修复（上线审计 2026-08-24）：改走 sessionStore.delete 云函数，
          // 服务端归属校验后级联删 sessions/reports/votes。
          const delRes = await wx.cloud.callFunction({
            name: config.cloudFunctions.sessionStore,
            data: { action: "delete", sessionId: id },
          });
          if (!delRes.result || delRes.result.code !== 0) {
            throw new Error((delRes.result && delRes.result.msg) || "delete failed");
          }
          wx.showToast({ title: "已删除", icon: "success" });
          this.loadHistory();
        } catch (err) {
          console.error("[history] delete failed:", err);
          wx.showToast({ title: "删除失败，请重试", icon: "none" });
        }
      },
    });
  },
});

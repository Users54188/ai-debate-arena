/**
 * history 页 — 思辨历史（W6）
 *
 * 流程：onShow 直接查本人 sessions 表（按 createdAt 倒序）→ 展示列表
 *       → 点击进入 report 页查看报告；长按删除会话
 *
 * 数据来源：CloudBase 默认集合权限"仅创建者可读写"，前端直查本人数据
 */

const config = require("../../config");

const MODE_LABEL = { L1: "苏格拉底追问", L2: "双人共修", L3: "辩论场" };

Page({
  data: {
    sessions: [],
    loading: true,
    empty: false,
  },

  onShow() {
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, empty: false });
    try {
      // P0 修复（2026-08-27）：原 db.collection("sessions").get() 前端直查在
      // "仅创建者可读写"权限下读不到云函数写入的文档（_openid 是云函数身份）。
      // 改走 sessionStore.list 云函数，由云函数身份读取后按 OPENID 过滤返回
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "list", limit: 50 },
      });
      const result = res.result || {};
      if (result.code !== 0) {
        throw new Error(result.msg || "list failed");
      }
      const sessions = (result.data.sessions || []).map((s) => {
        const round = s.round || 0;
        return {
          id: s.id,
          mode: s.mode || "L1",
          modeClass: String(s.mode || "L1").toLowerCase(),
          modeLabel: MODE_LABEL[s.mode] || s.mode,
          topic: s.topic || (s.mode === "L3" ? "辩论场" : "思辨会话"),
          round,
          roundsLabel: s.mode === "L3" ? `${Math.ceil(round / 3)} 轮辩论` : `${round} 轮追问`,
          createdAt: this.formatTime(s.createdAt),
        };
      });
      this.setData({
        sessions,
        loading: false,
        empty: sessions.length === 0,
      });
    } catch (e) {
      console.error("[history] load failed:", e);
      this.setData({ loading: false, empty: true });
    }
  },

  formatTime(d) {
    if (!d) return "";
    const t = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
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
          // 原前端直删在"仅创建者可读写"权限下删不掉云函数写入的 votes/reports（孤儿数据）
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
/**
 * toast.js — 统一错误/提示封装（避免各页散落的 wx.showToast）
 *
 * 约定：云函数返回 { code, data, msg }
 *   code = 0    → 成功
 *   code = -1   → 通用错误（业务/网络）
 *   code = -2   → 配额耗尽（sessionStore 强校验拒绝）
 *
 * 用法：
 *   const { showError, showQuotaError, showSuccess, showNetworkError } = require("../utils/toast");
 *   try { ... } catch (e) { showError(e); }
 *   if (res.code === -2) showQuotaError(res.data);
 */

const DEFAULT_DURATION = 2000;

/** 把任意错误对象转为人类可读的 toast */
function showError(e, fallback) {
  const msg = (e && e.message) || fallback || "操作失败，请稍后重试";
  // 网络异常特征（无 code 字段，纯客户端异常）
  const isNetwork = !e || (!e.code && /timeout|network|fail/i.test(msg));
  wx.showToast({
    title: isNetwork ? "网络异常，请稍后重试" : msg,
    icon: "none",
    duration: DEFAULT_DURATION,
  });
  if (e) console.error("[toast] error:", e);
}

/** 配额耗尽专用（区分按场/按轮次） */
function showQuotaError(data) {
  const d = data || {};
  let title = "今日次数已用完";
  if (d.reason === "rounds") title = "今日总轮次已达上限";
  wx.showToast({ title, icon: "none", duration: 2500 });
}

/** 网络错误专用 */
function showNetworkError() {
  wx.showToast({ title: "网络异常，请稍后重试", icon: "none", duration: DEFAULT_DURATION });
}

/** 成功提示 */
function showSuccess(msg) {
  wx.showToast({ title: msg || "已完成", icon: "success", duration: 1500 });
}

/** 轻提示 */
function showInfo(msg, duration) {
  wx.showToast({ title: msg, icon: "none", duration: duration || DEFAULT_DURATION });
}

/** 把云函数返回标准化处理：返回 { ok, data, msg, code } */
function normalizeResult(result) {
  const r = result || {};
  const code = r.code;
  return {
    ok: code === 0,
    code,
    data: r.data || null,
    msg: r.msg || "",
  };
}

module.exports = {
  showError,
  showQuotaError,
  showNetworkError,
  showSuccess,
  showInfo,
  normalizeResult,
};

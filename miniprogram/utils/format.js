/**
 * 格式化工具 —— app 预取与各页面共享同一份格式化逻辑，避免重复实现
 *
 * 现包含：
 *   - formatSessions(rawSessions): 把 sessionStore.list 的原始 sessions 转成 history 页可渲染格式
 *   - formatTime(date): 时间格式化（YYYY-MM-DD HH:mm）
 */

const MODE_LABEL = { L1: "苏格拉底追问", L2: "双人共修", L3: "辩论场" };

function formatTime(d) {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  const pad = function (n) { return String(n).padStart(2, "0"); };
  return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()) +
         " " + pad(t.getHours()) + ":" + pad(t.getMinutes());
}

/** 把云函数返回的原始 sessions 转成 history 页可渲染格式 */
function formatSessions(raw) {
  return (raw || []).map(function (s) {
    const round = s.round || 0;
    const mode = s.mode || "L1";
    return {
      id: s.id,
      mode: mode,
      modeClass: mode.toLowerCase(),
      modeLabel: MODE_LABEL[mode] || mode,
      topic: s.topic || (mode === "L3" ? "辩论场" : "思辨会话"),
      round: round,
      roundsLabel: mode === "L3"
        ? Math.ceil(round / 3) + " 轮辩论"
        : round + " 轮追问",
      createdAt: formatTime(s.createdAt),
    };
  });
}

module.exports = { formatSessions: formatSessions, formatTime: formatTime };

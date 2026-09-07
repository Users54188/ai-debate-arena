/**
 * security.js — 内容安全前置检查封装
 *
 * fail-close 策略（W1 验收修复）：
 * 审核服务调用失败时不放行，返回 pass=false + degraded=true，
 * 由页面提示"网络繁忙，请稍后重试"。赛期合规优先于可用性。
 *
 * 历史：原云函数名 `securityCheck`，2026-09-06 SCF 平台对该函数名持续崩溃，
 * 排查确认是该函数名命中平台某层关键字过滤/缓存损坏，
 * 改名为 `msgGuard` 后立即恢复。本封装对外接口保持不变（msgSecCheck）。
 */

/**
 * 调用 msgGuard 云函数（原 securityCheck，2026-09-06 改名）
 * @param {string} content - 待检文本
 * @param {number} scene   - 场景值（1: 对话输入, 2: 终局发言）
 * @returns {Promise<{pass: boolean, riskLabel?: string, degraded?: boolean}>}
 */
async function msgSecCheck(content, scene = 1) {
  if (!content || !content.trim()) {
    return { pass: true };
  }

  try {
    const res = await wx.cloud.callFunction({
      name: "msgGuard",
      data: { content, scene },
    });

    const result = res.result || {};
    return {
      pass: result.pass === true,
      riskLabel: result.riskLabel || null,
      degraded: result.degraded === true,
    };
  } catch (err) {
    console.error("[msgGuard] call failed:", err);
    return { pass: false, degraded: true, riskLabel: "check_failed" };
  }
}

module.exports = { msgSecCheck };

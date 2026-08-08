/**
 * security.js — 内容安全前置检查封装
 */

/**
 * 调用 securityCheck 云函数
 * @param {string} content - 待检文本
 * @param {number} scene   - 场景值（1: 对话输入, 2: 终局发言）
 * @returns {Promise<{pass: boolean, riskLabel?: string}>}
 */
async function msgSecCheck(content, scene = 1) {
  if (!content || !content.trim()) {
    return { pass: true };
  }

  try {
    const res = await wx.cloud.callFunction({
      name: "securityCheck",
      data: { content, scene },
    });

    const result = res.result || {};
    return {
      pass: result.pass !== false,
      riskLabel: result.riskLabel || null,
    };
  } catch (err) {
    console.error("[securityCheck] call failed:", err);
    // 安全检查失败时保守放行（不阻塞用户，cloud 侧会做输出审核兜底）
    return { pass: true, degraded: true };
  }
}

module.exports = { msgSecCheck };

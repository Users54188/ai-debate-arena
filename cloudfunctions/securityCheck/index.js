const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * securityCheck — 内容安全审查
 *
 * 接口：
 *   { content: string, scene: number }
 * 返回：
 *   { pass: boolean, riskLabel?: string }
 */
exports.main = async (event) => {
  const { content, scene = 1 } = event;

  if (!content || !content.trim()) {
    return { pass: true };
  }

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: content.trim(),
      scene,
    });

    // errCode 0 = 通过
    if (result.errCode === 0) {
      return { pass: true };
    }

    // 敏感内容
    return {
      pass: false,
      riskLabel: result.result && result.result.label
        ? `risk_${result.result.label}`
        : "risk_unknown",
    };
  } catch (err) {
    console.error("[securityCheck] msgSecCheck error:", err);
    // SDK 调用失败时保守放行，输出审核由云函数侧兜底
    return { pass: true, degraded: true };
  }
};

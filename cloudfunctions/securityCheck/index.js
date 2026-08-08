const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * securityCheck — 内容安全审查
 *
 * 接口：
 *   { content: string, scene: number }
 * 返回：
 *   { pass: boolean, riskLabel?: string, degraded?: boolean }
 *
 * 修复记录（W1 验收）：
 * - 新版 msgSecCheck 在 errCode=0 时以 result.suggest (pass/review/risky) 表达结论，
 *   原实现只判 errCode 会放过全部违规内容，现以 suggest 为准
 * - fail-close：审核服务异常时返回 pass=false + degraded，由前端提示重试
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

    const label = result && result.result && result.result.label;

    if (result.errCode === 0) {
      const suggest = result.result && result.result.suggest;
      // suggest 缺省（旧版返回）视为通过
      if (!suggest || suggest === "pass") {
        return { pass: true };
      }
      return { pass: false, riskLabel: `risk_${label || "unknown"}` };
    }

    // 非 0 errCode（如 87014 内容风险）一律拦截
    return { pass: false, riskLabel: `err_${result.errCode}${label ? `_${label}` : ""}` };
  } catch (err) {
    // 部分 SDK 版本将风险内容以异常形式抛出（errCode 87014）
    if (err && (err.errCode === 87014 || /87014|risky/i.test(err.message || ""))) {
      return { pass: false, riskLabel: "risk_content" };
    }
    console.error("[securityCheck] msgSecCheck error:", err);
    return { pass: false, degraded: true, riskLabel: "check_failed" };
  }
};

const cloud = require("wx-server-sdk");
const db = cloud.database();
const _ = db.command;

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
 *
 * 限频（2026-09-04 配额 DoS 防护）：
 * - 原实现任何人可无条件高频调用，攻击者耗尽 appid 级 msgSecCheck 日配额后，
 *   全链路 fail-close（degraded 也拒绝）会让所有用户都无法对话。
 * - 现按 openid + 当日范围在 token_usage 集合做计数限频，并加超长内容预检
 *   （msgSecCheck 官方限制 2500 字符，超长报错走 degraded 必然 fail-close）。
 */
const SEC_DAILY_LIMIT_PER_USER = 500; // 每用户每日最多 500 次审核调用
const SEC_CONTENT_MAX_CHARS = 2500; // msgSecCheck 官方字符上限（超长直接拒绝，不耗配额）

function bjTodayRange() {
  const OFFSET = 8 * 3600 * 1000;
  const bjDayStartUtc = Math.floor((Date.now() + OFFSET) / 86400000) * 86400000 - OFFSET;
  return { today: new Date(bjDayStartUtc), tomorrow: new Date(bjDayStartUtc + 86400000) };
}

exports.main = async (event) => {
  const { content, scene = 1 } = event;

  if (!content || !content.trim()) {
    return { pass: true };
  }

  const text = String(content).trim();

  // 超长内容预检：msgSecCheck 官方限制 2500 字符，超长必报错走 degraded fail-close
  if (text.length > SEC_CONTENT_MAX_CHARS) {
    console.warn(`[securityCheck] content too long: ${text.length} > ${SEC_CONTENT_MAX_CHARS}`);
    return { pass: false, degraded: true, riskLabel: "content_too_long" };
  }

  // 限频：按 openid + 当日范围在 token_usage 计数（model=securityCheck 标记）
  // 异常时不阻断主流程（业务可用性优先于反滥用），仅记日志
  try {
    const OPENID = cloud.getWXContext().OPENID;
    if (OPENID) {
      const { today, tomorrow } = bjTodayRange();
      const cnt = await db
        .collection("token_usage")
        .where({
          openid: OPENID,
          model: "securityCheck",
          createdAt: _.gte(today).and(_.lt(tomorrow)),
        })
        .count();
      if ((cnt.total || 0) >= SEC_DAILY_LIMIT_PER_USER) {
        console.warn(`[securityCheck] rate limit hit: openid=${OPENID} count=${cnt.total}`);
        return { pass: false, degraded: true, riskLabel: "rate_limited" };
      }
      // 异步落库一条计数（不阻塞审核主流程）
      db.collection("token_usage")
        .add({
          data: {
            openid: OPENID,
            mode: "security",
            model: "securityCheck",
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            createdAt: db.serverDate(),
          },
        })
        .catch((e) => console.error("[securityCheck] rate record failed:", e));
    }
  } catch (rateErr) {
    console.error("[securityCheck] rate check error:", rateErr);
  }

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: text,
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

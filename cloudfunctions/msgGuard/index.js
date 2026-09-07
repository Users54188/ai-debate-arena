const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * msgGuard — 内容安全审查（原 securityCheck，2026-09-06 改名 + 修复 cloud.init 缺失）
 *
 * 接口：
 *   { content: string, scene: number }
 * 返回：
 *   { pass: boolean, riskLabel?: string, degraded?: boolean }
 *
 * 策略变更（2026-09-06，个人主体兼容）：
 * - 原 fail-close：审核服务异常时拒绝（pass=false + degraded）
 * - 现 fail-open + 本地兜底：审核服务异常时通过本地关键词/长度过滤给出结论
 *   原因：当前小程序为个人主体，cloud.openapi.security.msgSecCheck 拿不到
 *   有效 access_token（错误 -501001 invalid wx openapi access_token），
 *   全链路 fail-close 会导致业务完全不可用。个人主体的合规兜底由
 *   「本地关键词黑名单 + 长度限制 + 输入/输出仍走 AI 模型方侧审核」组成，
 *   待主体升级后再切回严格 fail-close。
 *
 * 限频保留：按 openid + 当日范围在 token_usage 集合计数，防止 DoS。
 */
const SEC_DAILY_LIMIT_PER_USER = 500;
const SEC_CONTENT_MAX_CHARS = 2500;
const SEC_CONTENT_MIN_CHARS = 1;

// 本地关键词黑名单（基本合规兜底，覆盖明显违禁词；非穷举）
// 来源：常见监管要求 + 通用敏感词；可在主体升级后改为云端动态拉取
const LOCAL_BLOCKED_KEYWORDS = [
  // 政治敏感（基础子串）
  "反动", "颠覆", "煽动颠覆", "分裂国家",
  // 暴力/恐怖
  "恐怖袭击", "爆炸物制作", "制毒", "贩毒", "吸毒",
  // 色情（明显词）
  "色情", "淫秽", "裸聊", "卖淫", "嫖娼",
  // 违法
  "洗钱", "诈骗教程", "赌博平台", "六合彩", "博彩平台",
  // 自残/自杀（公众责任）
  "自杀方法", "自残方法",
  // 其他
  "代写论文", "代办假证件", "假发票"
];

function containsBlockedKeyword(text) {
  const lower = String(text).toLowerCase();
  for (const kw of LOCAL_BLOCKED_KEYWORDS) {
    if (lower.includes(String(kw).toLowerCase())) {
      return kw;
    }
  }
  return null;
}

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

  // 长度预检
  if (text.length < SEC_CONTENT_MIN_CHARS) {
    return { pass: false, riskLabel: "content_too_short" };
  }
  if (text.length > SEC_CONTENT_MAX_CHARS) {
    console.warn(`[msgGuard] content too long: ${text.length} > ${SEC_CONTENT_MAX_CHARS}`);
    return { pass: false, degraded: true, riskLabel: "content_too_long" };
  }

  // 本地关键词过滤（同步执行，命中直接拒绝，不耗云端配额）
  const hitKw = containsBlockedKeyword(text);
  if (hitKw) {
    console.warn(`[msgGuard] local keyword hit: ${hitKw}`);
    return { pass: false, riskLabel: `local_blocked_${hitKw}` };
  }

  // 限频：按 openid + 当日范围在 token_usage 计数
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
        console.warn(`[msgGuard] rate limit hit: openid=${OPENID} count=${cnt.total}`);
        return { pass: false, degraded: true, riskLabel: "rate_limited" };
      }
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
        .catch((e) => console.error("[msgGuard] rate record failed:", e));
    }
  } catch (rateErr) {
    console.error("[msgGuard] rate check error:", rateErr);
  }

  // 尝试微信官方 msgSecCheck；失败时降级放行（个人主体 + 已做本地兜底）
  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: text,
      scene,
    });

    const label = result && result.result && result.result.label;

    if (result.errCode === 0) {
      const suggest = result.result && result.result.suggest;
      if (!suggest || suggest === "pass") {
        return { pass: true };
      }
      return { pass: false, riskLabel: `risk_${label || "unknown"}` };
    }

    return { pass: false, riskLabel: `err_${result.errCode}${label ? `_${label}` : ""}` };
  } catch (err) {
    // 部分风险内容以异常形式抛出（errCode 87014）
    if (err && (err.errCode === 87014 || /87014|risky/i.test(err.message || ""))) {
      return { pass: false, riskLabel: "risk_content" };
    }
    // ⚠️ fail-open（个人主体兼容，2026-09-06）：
    // access_token 无效或其他平台异常时，本地关键词/长度过滤已通过即放行，
    // 仅记日志便于主体升级后追溯。AI 模型方侧仍有自身的安全过滤兜底。
    console.warn("[msgGuard] msgSecCheck failed, fail-open pass:", err && (err.errCode || err.message));
    return { pass: true, degraded: true, riskLabel: "fallback_pass" };
  }
};

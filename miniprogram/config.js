/**
 * 思辨场 — 全局配置
 * 所有模型、环境、配额常量统一在此维护，禁止散落硬编码。
 */

module.exports = {
  // 云开发环境 ID（部署时替换）
  envId: "cloudbase-d3gvaqczs2298c253",

  // ⚠️ 测试期配额旁路总开关（与云函数 getQuota/sessionStore/userProfile 的 QUOTA_BYPASS 联动）
  // true  ：前端 checkQuota 直接视为可用；即使云端尚未部署新版云函数，
  //         create 被 code:-2 拒绝时也降级为"不落库继续对话"，保证随时能聊
  // false ：还原正式配额拦截（上线值）
  quotaBypass: true,

  // 模型配置
  model: {
    chat: "hy3-preview", // 实时对话流式调用
    report: "hy3",       // 报告生成 / 评测裁判
  },

  // 每日配额（单用户、跨模式独立计数）— 测试期全放开（999），
  // 与云函数 getQuota / sessionStore / userProfile 的 QUOTA_BYPASS 开关同步；上线前还原 TIERS.new 档
  dailyQuota: {
    L1: 999, // 单人苏格拉底每日最大会话数
    L2: 999, // 双人共修
    L3: 999, // 三方辩论
  },

  // 单会话轮次上限（与 TIERS.new.maxRounds 对齐）
  maxRounds: 10,

  // 流式渲染节流 (ms) —— 降低到 60ms 让首字更快到达，避免感知卡顿
  streamThrottle: 60,

  // 流式调用超时配置
  streamTimeout: {
    maxRetries: 2,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
  },

  // eventStream 读取超时防护（ms）：usage/note 提取不阻塞对话主流程
  streamEventTimeoutMs: 3000,

  // 云函数名
  cloudFunctions: {
    sessionStore: "sessionStore",
    securityCheck: "securityCheck",
    userProfile: "userProfile",
    getQuota: "getQuota",
    generateReport: "generateReport",
    topics: "topics",
  },

  // 数据库集合名
  collections: {
    sessions: "sessions",
    reports: "reports",
    users: "users",
    userQuota: "user_quota",
    topics: "topics_v1",
    tokenUsage: "token_usage",
    votes: "votes",
    evalRuns: "eval_runs",
  },
};

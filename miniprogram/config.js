/**
 * 思辨场 — 全局配置
 * 所有模型、环境、配额常量统一在此维护，禁止散落硬编码。
 */

module.exports = {
  // 云开发环境 ID（部署时替换）
  envId: "cloudbase-d3gvaqczs2298c253",

  // 小程序 appid（与 project.config.json 一致）：多端模式下 wx.cloud.init
  // 必须显式传入 appid，普通小程序模式下传入无害
  appid: "wxc158769af1e2ce0a",

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

  // ⚠️ 上线审计加固（2026-08-25）：实测微信云 AI SDK 对迭代器 return() 不释放底层
  // 连接，eventStream 是泄漏主源——默认跳过消费（usage 遥测随之缺失，可接受）。
  // 若 SDK 后续版本修复，可置 false 恢复 usage 采集
  streamSkipEventStream: true,

  // 流式 watchdog：相邻 chunk 空闲超过 idle 判定挂起走重试；整条流超过 total 强制终止，
  // 避免 textIter.next() 半开挂起导致 streaming 标志永久锁死输入框
  streamIdleTimeoutMs: 30000,
  streamTotalTimeoutMs: 90000,

  // 建连超时（ms）：aiModel.streamText() 本身也可能被网关挂起（并发额度耗尽时
  // 表现为半开等待而非报错），无超时则 await 永久阻塞——"第 3 次点击无反应"的
  // 直接根因。超时后走重试（新实例）→ 仍失败 → onError 明确提示
  streamConnectTimeoutMs: 15000,

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

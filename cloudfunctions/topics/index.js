const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * topics — 辩题白名单查询（L3 输入侧合规门）
 *
 * 合规底线：辩题必须来自人工审核过的 topics_v1 白名单集合，禁止客户端自由输入辩题。
 * 前端 L3 入口从此云函数取白名单，提供"选题"或"自由命题二选一"。
 * 自由命题仅作为体验降级路径（仍走 msgSecCheck + 服务端长度限制），不替代白名单。
 *
 * 接口：
 *   { action: "list", category?: "philosophy"|"life"|"tech"|"science", difficulty?: 1|2|3, limit?: 20 }
 *     → 返回 [{ _id, title, category, difficulty, tags }]
 *   { action: "get", id } → 返回单个辩题详情
 *   { action: "validate", title } → 校验辩题是否在白名单（防绕过：前端自由命题必走）
 *
 * 数据契约：
 * - 集合 topics_v1 文档结构 { title, category, difficulty, tags, createdAt }
 * - 仅返回有效文档；上限 limit ≤ 50（防拉爆）
 *
 * 兜底：若 topics_v1 集合不存在或为空（部署期未导入），返回内置 12 条种子辩题
 *       保证 L3 入口不会完全无题可选；上线前运营导入完整白名单覆盖。
 */

// 合规整改（2026-08-16）：移除涉政治、职场争议、价值观敏感议题，全部替换为
// 教育 / 科技 / 生活 / 科学类无争议话题，规避审核员二次关注。上线前应由运营
// 在 topics_v1 集合导入完整白名单覆盖本兜底列表。
const FALLBACK_TOPICS = [
  { title: "人工智能会取代人类大部分工作", category: "tech", difficulty: 2, tags: ["AI", "社会"] },
  { title: "努力就一定能成功", category: "life", difficulty: 1, tags: ["奋斗", "信念"] },
  { title: "学历史有用", category: "philosophy", difficulty: 1, tags: ["教育"] },
  { title: "短视频让人的注意力变短", category: "tech", difficulty: 2, tags: ["媒体"] },
  { title: "终身学习比单次教育更重要", category: "philosophy", difficulty: 2, tags: ["教育"] },
  { title: "虚拟现实会比现实更有吸引力", category: "tech", difficulty: 2, tags: ["科技"] },
  { title: "人类应该主动接触外星文明", category: "science", difficulty: 3, tags: ["宇宙"] },
  { title: "数据比经验更可靠", category: "tech", difficulty: 2, tags: ["决策"] },
  { title: "标准化考试能衡量学生能力", category: "life", difficulty: 2, tags: ["教育"] },
  { title: "阅读纸质书比电子书更能让人专注", category: "life", difficulty: 1, tags: ["阅读", "教育"] },
  { title: "围棋训练能提升人的逻辑思维能力", category: "science", difficulty: 2, tags: ["脑科学", "教育"] },
  { title: "在线教育会取代传统课堂", category: "tech", difficulty: 2, tags: ["教育", "科技"] },
];

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function pick(list, n) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length));
}

exports.main = async (event) => {
  const { action } = event;
  const { OPENID } = cloud.getWXContext();

  if (action === "list" || !action) {
    const limit = Math.min(Math.max(1, Number(event.limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const where = {};
    if (event.category) where.category = event.category;
    if (event.difficulty) where.difficulty = Number(event.difficulty);

    try {
      let query = db.collection("topics_v1");
      const keys = Object.keys(where);
      if (keys.length > 0) {
        const cmd = {};
        for (const k of keys) cmd[k] = where[k];
        query = query.where(cmd);
      }
      const res = await query.orderBy("difficulty", "asc").limit(limit).get();
      const list = res.data || [];
      if (list.length > 0) {
        return { code: 0, data: { topics: list, source: "db" } };
      }
      // 集合存在但空，或集合不存在（catch 内）→ 走兜底
      return {
        code: 0,
        data: {
          topics: pick(FALLBACK_TOPICS, limit).map((t, i) => ({ ...t, _id: `seed_${i}` })),
          source: "fallback",
        },
      };
    } catch (e) {
      console.warn("[topics] db query failed, fallback to seed:", e && e.message);
      return {
        code: 0,
        data: {
          topics: pick(FALLBACK_TOPICS, limit).map((t, i) => ({ ...t, _id: `seed_${i}` })),
          source: "fallback",
        },
      };
    }
  }

  if (action === "get") {
    const { id } = event;
    if (!id) return { code: -1, msg: "id required" };
    try {
      const res = await db.collection("topics_v1").doc(id).get();
      return { code: 0, data: { topic: res.data } };
    } catch (e) {
      return { code: -1, msg: "topic not found" };
    }
  }

  if (action === "validate") {
    // 校验客户端传入的 title 是否在白名单（精确匹配或相似度判定）
    // 用于自由命题路径：拒绝非白名单话题，引导用户从选题库选
    const title = String(event.title || "").trim();
    if (!title) return { code: -1, msg: "title required" };
    try {
      const res = await db
        .collection("topics_v1")
        .where({ title })
        .limit(1)
        .get();
      if (res.data && res.data.length > 0) {
        return { code: 0, data: { valid: true, topic: res.data[0] } };
      }
      // 兜底：白名单没匹配但与种子辩题完全一致，亦放行
      const seed = FALLBACK_TOPICS.find((t) => t.title === title);
      if (seed) {
        return { code: 0, data: { valid: true, topic: seed } };
      }
      return { code: 0, data: { valid: false, msg: "话题不在白名单，请从选题库选择" } };
    } catch (e) {
      // 数据库不可用时 fail-safe：种子匹配则放行，否则拒绝（保守策略，避免非白名单流过）
      const seed = FALLBACK_TOPICS.find((t) => t.title === title);
      if (seed) return { code: 0, data: { valid: true, topic: seed } };
      return { code: -1, msg: "校验服务暂时不可用，请稍后重试" };
    }
  }

  return { code: -1, msg: `Unknown action: ${action}` };
};

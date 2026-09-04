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
//
// 必须与 miniprogram/pages/debate/index.js 中 FALLBACK_TOPICS 精确镜像，
// 否则会出现"前端能选但云端拒绝"或反之的漂移（前端校验 fail-safe 用此兜底放行）。
// 100 条辩题分布：tech×13 / life×13 / philosophy×12 / science×12 / education×13 / culture×12 / society×12 / environment×13
// 难度分布：1=30 条（入门）/ 2=50 条（标准）/ 3=20 条（进阶）；全部合规中性，两可辩。
const FALLBACK_TOPICS = [
  // ===== tech（科技）×13 =====
  { title: "智能手表让生活更健康", category: "tech", difficulty: 1, tags: ["健康", "科技"] },
  { title: "在线地图让人不再依赖记忆", category: "tech", difficulty: 1, tags: ["工具"] },
  { title: "智能家居提升了生活品质", category: "tech", difficulty: 1, tags: ["生活", "科技"] },
  { title: "语音助手改变了家庭生活", category: "tech", difficulty: 1, tags: ["AI", "生活"] },
  { title: "人工智能会取代人类大部分工作", category: "tech", difficulty: 2, tags: ["AI", "社会"] },
  { title: "短视频让人的注意力变短", category: "tech", difficulty: 2, tags: ["媒体"] },
  { title: "虚拟现实会比现实更有吸引力", category: "tech", difficulty: 2, tags: ["科技"] },
  { title: "数据比经验更可靠", category: "tech", difficulty: 2, tags: ["决策"] },
  { title: "在线教育会取代传统课堂", category: "tech", difficulty: 2, tags: ["教育", "科技"] },
  { title: "算法推荐让人看到的世界更窄", category: "tech", difficulty: 2, tags: ["互联网"] },
  { title: "区块链技术会重塑社会信任", category: "tech", difficulty: 3, tags: ["信任", "科技"] },
  { title: "元宇宙会成为下一代互联网", category: "tech", difficulty: 3, tags: ["虚拟现实", "互联网"] },
  { title: "自动驾驶比人类驾驶更安全", category: "tech", difficulty: 3, tags: ["AI", "安全"] },

  // ===== life（生活）×13 =====
  { title: "努力就一定能成功", category: "life", difficulty: 1, tags: ["奋斗", "信念"] },
  { title: "阅读纸质书比电子书更能让人专注", category: "life", difficulty: 1, tags: ["阅读", "教育"] },
  { title: "早起让人一天更高效", category: "life", difficulty: 1, tags: ["作息"] },
  { title: "手机让人睡得更晚", category: "life", difficulty: 1, tags: ["作息", "科技"] },
  { title: "标准化考试能衡量学生能力", category: "life", difficulty: 2, tags: ["教育"] },
  { title: "远程办公让人更自由", category: "life", difficulty: 2, tags: ["工作"] },
  { title: "健身比调整饮食更有效", category: "life", difficulty: 2, tags: ["健康"] },
  { title: "独居比合居更让人成长", category: "life", difficulty: 2, tags: ["生活"] },
  { title: "储蓄比投资更让人安心", category: "life", difficulty: 2, tags: ["理财"] },
  { title: "外卖让人的烹饪技能退化", category: "life", difficulty: 2, tags: ["生活"] },
  { title: "物质富足比精神富足更重要", category: "life", difficulty: 3, tags: ["价值观"] },
  { title: "自律比天赋更决定人生高度", category: "life", difficulty: 3, tags: ["成长"] },
  { title: "长寿是社会进步的标志", category: "life", difficulty: 3, tags: ["社会"] },

  // ===== philosophy（哲学）×12 =====
  { title: "学历史有用", category: "philosophy", difficulty: 1, tags: ["教育"] },
  { title: "善意的谎言是可以接受的", category: "philosophy", difficulty: 1, tags: ["道德"] },
  { title: "直觉比分析更可靠", category: "philosophy", difficulty: 1, tags: ["思维"] },
  { title: "简单的生活比复杂的生活更幸福", category: "philosophy", difficulty: 1, tags: ["生活态度"] },
  { title: "终身学习比单次教育更重要", category: "philosophy", difficulty: 2, tags: ["教育"] },
  { title: "知识比智慧更重要", category: "philosophy", difficulty: 2, tags: ["认知"] },
  { title: "理想比现实更值得追求", category: "philosophy", difficulty: 2, tags: ["人生"] },
  { title: "过程比结果更重要", category: "philosophy", difficulty: 2, tags: ["价值观"] },
  { title: "个人成长比社会认可更重要", category: "philosophy", difficulty: 2, tags: ["成长"] },
  { title: "独处比社交更能让人认识自己", category: "philosophy", difficulty: 2, tags: ["心理"] },
  { title: "自由比平等更重要", category: "philosophy", difficulty: 3, tags: ["价值观"] },
  { title: "真相比善意更重要", category: "philosophy", difficulty: 3, tags: ["道德"] },

  // ===== science（科学）×12 =====
  { title: "睡前运动让人睡得更好", category: "science", difficulty: 1, tags: ["健康"] },
  { title: "喝咖啡对人有害", category: "science", difficulty: 1, tags: ["健康"] },
  { title: "早晨的记忆力最好", category: "science", difficulty: 1, tags: ["脑科学"] },
  { title: "听音乐能提升学习效率", category: "science", difficulty: 1, tags: ["脑科学", "学习"] },
  { title: "围棋训练能提升人的逻辑思维能力", category: "science", difficulty: 2, tags: ["脑科学", "教育"] },
  { title: "冥想能改变大脑结构", category: "science", difficulty: 2, tags: ["脑科学"] },
  { title: "量子计算会改变密码学", category: "science", difficulty: 2, tags: ["物理", "科技"] },
  { title: "基因编辑应该被允许用于治疗疾病", category: "science", difficulty: 2, tags: ["生物", "伦理"] },
  { title: "太空探索值得投入巨资", category: "science", difficulty: 2, tags: ["宇宙", "科技"] },
  { title: "转基因食品对人是安全的", category: "science", difficulty: 2, tags: ["生物"] },
  { title: "人类应该主动接触外星文明", category: "science", difficulty: 3, tags: ["宇宙"] },
  { title: "强人工智能应该被允许自主决策", category: "science", difficulty: 3, tags: ["AI", "伦理"] },

  // ===== education（教育）×13 =====
  { title: "家庭作业应该被取消", category: "education", difficulty: 1, tags: ["学习"] },
  { title: "课堂上应该允许使用手机", category: "education", difficulty: 1, tags: ["学习", "科技"] },
  { title: "学生应该自己选择学什么", category: "education", difficulty: 1, tags: ["学习"] },
  { title: "表扬比批评更能激励学生", category: "education", difficulty: 1, tags: ["教育方法"] },
  { title: "大学教育值得投入", category: "education", difficulty: 2, tags: ["教育"] },
  { title: "文科比理科更有长远价值", category: "education", difficulty: 2, tags: ["学科"] },
  { title: "旅行比读书更能让人成长", category: "education", difficulty: 2, tags: ["成长"] },
  { title: "实践比理论更重要", category: "education", difficulty: 2, tags: ["学习方法"] },
  { title: "在线课程会和线下课程一样有效", category: "education", difficulty: 2, tags: ["教育", "科技"] },
  { title: "兴趣比天赋更能决定学习成就", category: "education", difficulty: 2, tags: ["学习"] },
  { title: "课外辅导对学生有帮助", category: "education", difficulty: 3, tags: ["教育"] },
  { title: "大学专业应该入学后再选", category: "education", difficulty: 3, tags: ["教育"] },
  { title: "教师会被 AI 完全替代", category: "education", difficulty: 3, tags: ["教育", "AI"] },

  // ===== culture（文化）×12 =====
  { title: "看电影比看书更轻松", category: "culture", difficulty: 1, tags: ["娱乐"] },
  { title: "流行音乐比古典音乐更动人", category: "culture", difficulty: 1, tags: ["音乐"] },
  { title: "短视频是新一代的文化形式", category: "culture", difficulty: 1, tags: ["媒体", "文化"] },
  { title: "网络用语会丰富语言", category: "culture", difficulty: 1, tags: ["语言"] },
  { title: "传统文化应该被全力保护", category: "culture", difficulty: 2, tags: ["传统"] },
  { title: "博物馆应该免费开放", category: "culture", difficulty: 2, tags: ["文化"] },
  { title: "翻译会让原著失去韵味", category: "culture", difficulty: 2, tags: ["文学"] },
  { title: "流行文化比经典文化更有影响力", category: "culture", difficulty: 2, tags: ["文化"] },
  { title: "游戏是第九艺术", category: "culture", difficulty: 2, tags: ["游戏", "艺术"] },
  { title: "国际化让城市更有魅力", category: "culture", difficulty: 2, tags: ["城市", "文化"] },
  { title: "文化遗产应该归还来源国", category: "culture", difficulty: 3, tags: ["历史", "文化"] },
  { title: "AI 生成的作品算艺术", category: "culture", difficulty: 3, tags: ["AI", "艺术"] },

  // ===== society（社会）×12 =====
  { title: "大城市比小城市更适合年轻人", category: "society", difficulty: 1, tags: ["城市"] },
  { title: "公交比私家车更值得提倡", category: "society", difficulty: 1, tags: ["出行"] },
  { title: "移动支付让生活更安全", category: "society", difficulty: 1, tags: ["支付"] },
  { title: "城市化提升了人的生活质量", category: "society", difficulty: 2, tags: ["城市"] },
  { title: "社交媒体让人更孤独", category: "society", difficulty: 2, tags: ["社交"] },
  { title: "网购让生活更便利", category: "society", difficulty: 2, tags: ["消费"] },
  { title: "共享经济改变了人的消费观", category: "society", difficulty: 2, tags: ["消费"] },
  { title: "远程医疗让就医更便利", category: "society", difficulty: 2, tags: ["医疗", "科技"] },
  { title: "智慧城市让生活更高效", category: "society", difficulty: 2, tags: ["城市", "科技"] },
  { title: "公共场所应该全面禁烟", category: "society", difficulty: 2, tags: ["公共"] },
  { title: "大数据让购物推荐更懂你", category: "society", difficulty: 3, tags: ["数据", "消费"] },
  { title: "社交平台应该对内容负责", category: "society", difficulty: 3, tags: ["互联网"] },

  // ===== environment（环境）×13 =====
  { title: "垃圾分类是每个人的责任", category: "environment", difficulty: 1, tags: ["环保"] },
  { title: "自行车比电动车更环保", category: "environment", difficulty: 1, tags: ["出行", "环保"] },
  { title: "节约用水应该从每个人做起", category: "environment", difficulty: 1, tags: ["环保"] },
  { title: "新能源车会全面取代燃油车", category: "environment", difficulty: 2, tags: ["能源", "环保"] },
  { title: "素食比肉食更环保", category: "environment", difficulty: 2, tags: ["饮食", "环保"] },
  { title: "城市绿化提升了生活幸福感", category: "environment", difficulty: 2, tags: ["城市", "环保"] },
  { title: "太阳能会成为主要能源", category: "environment", difficulty: 2, tags: ["能源"] },
  { title: "一次性用品应该被全面禁止", category: "environment", difficulty: 2, tags: ["环保"] },
  { title: "海洋保护比森林保护更紧迫", category: "environment", difficulty: 2, tags: ["环保"] },
  { title: "碳中和目标值得全力推进", category: "environment", difficulty: 2, tags: ["环保"] },
  { title: "经济发展应该让位于环境保护", category: "environment", difficulty: 3, tags: ["发展", "环保"] },
  { title: "核能是应对气候变化的关键", category: "environment", difficulty: 3, tags: ["能源", "气候"] },
  { title: "动物园应该被取消", category: "environment", difficulty: 3, tags: ["动物", "伦理"] },
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

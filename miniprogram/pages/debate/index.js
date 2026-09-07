/**
 * L3 辩论场 — 用户围观，AI 三方顺序发言（正方 → 反方 → 裁判，4 轮）
 *
 * 流程：进入页面 → 校验 L3 配额（≤1 次/日）→ 用户输入命题 → msgSecCheck
 *       → 创建会话（mode="L3"）→ 三方顺序流式发言（每轮 3 条）
 *       → 用户在每轮裁判发言后可投票（不影响 AI，仅记录到 votes 表）
 *       → 4 轮后跳转报告页
 *
 * 状态机：每轮由本页编排，不依赖云函数（实时路径不经云函数）
 * 复用 sessionStore.append（已有归属校验 + 原子追加 + 裁剪）
 */

const { streamText } = require("../../utils/ai-stream");
const { msgSecCheck } = require("../../utils/security");
const { prompts } = require("../../utils/prompts");
const config = require("../../config");

const MAX_ROUNDS = 4;
const SENSITIVE_FALLBACK = "这个话题不太适合展开辩论，我们换一个命题吧。";

// 前端兜底辩题：必须是 cloudfunctions/topics/index.js 中 FALLBACK_TOPICS 的精确镜像。
// 任何一方改动都必须同步另一方，否则白名单校验会出现"前端能选但云端拒绝"或反之的漂移。
// P1 修复（L3 辩题库单点依赖）：云函数不可达时，前端用此兜底保证 L3 入口可用。
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

function pickFallback(list, n) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length)).map((t, i) => ({ ...t, _id: `seed_${i}` }));
}

function displayMsg(role, content, round) {
  return { role, content, round };
}

function historyToApi(messages) {
  const ROLE_MAP = {
    affirmative: "assistant",
    negative: "assistant",
    judge: "assistant",
    user: "user",
  };
  return (messages || []).map((m) => ({
    role: ROLE_MAP[m.role] || "assistant",
    content: m.content,
  }));
}

Page({
  data: {
    phase: "input",
    topic: "",
    messages: [],
    round: 0,
    streaming: false,
    waitingFirstChunk: false,
    currentRole: "",
    quotaExhausted: false,
    voteCounts: { affirmative: 0, negative: 0 },
    hasVotedThisRound: false,
    topicCandidates: [],
    topicLoading: true,
  },

  onLoad() {
    try {
      this.sessionId = null;
      this.sessionSummary = "";
      this.shareToken = "";
      this.checkQuota();
      this.loadTopics();
    } catch (e) {
      console.error("[debate] onLoad failed:", e);
      this.setData({ topicLoading: false });
    }
  },

  onShow() {
    if (this.data.phase === "input" && !this.data.streaming) {
      this.checkQuota();
    }
  },

  /** 加载辩题白名单（合规：辩题必须来自 topics_v1 集合） */
  async loadTopics() {
    try {
      const res = await wx.cloud.callFunction({
        name: "topics",
        data: { action: "list", limit: 12 },
      });
      const list = (res.result && res.result.data && res.result.data.topics) || [];
      // 云端返回空（集合未导入）或调用异常 → 降级到本地兜底，保证 L3 入口不空
      if (list.length === 0) {
        this.setData({ topicCandidates: pickFallback(FALLBACK_TOPICS, 12), topicLoading: false });
        return;
      }
      this.setData({ topicCandidates: list, topicLoading: false });
    } catch (e) {
      console.error("[debate] load topics failed, use local fallback:", e);
      this.setData({ topicCandidates: pickFallback(FALLBACK_TOPICS, 12), topicLoading: false });
    }
  },

  async checkQuota() {
    // 测试期旁路：配额放开时跳过查询，避免旧版云函数的 new 档上限静默拦截对话
    if (config.quotaBypass) return;
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.getQuota,
        data: { mode: "L3" },
      });
      const q = (res.result && res.result.data) || {};
      const exhausted = !q.available && q.used >= q.limit;
      const wasExhausted = this.data.quotaExhausted;
      if (exhausted !== wasExhausted) {
        this.setData({ quotaExhausted: exhausted });
        if (exhausted) {
          wx.showToast({ title: "今日 L3 辩论次数已用完，明日再会", icon: "none", duration: 2500 });
        }
      }
    } catch (e) {
      console.error("[debate] quota check failed:", e);
    }
  },

  onPickExample(e) {
    const t = e.currentTarget.dataset.topic;
    if (t) this.setData({ topic: t });
  },

  async startDebate() {
    const topic = (this.data.topic || "").trim();
    if (!topic || this.data.streaming || this.data.quotaExhausted) return;
    if (topic.length > 80) {
      wx.showToast({ title: "命题过长，请精简到 80 字内", icon: "none", duration: 2000 });
      return;
    }

    const checkResult = await msgSecCheck(topic, 1);
    if (!checkResult.pass) {
      wx.showToast({
        title: checkResult.degraded ? "网络繁忙，请稍后重试" : "命题包含违规信息，请修改后重试",
        icon: "none", duration: 2000,
      });
      return;
    }

    // 合规门：辩题须来自白名单（自由命题也走 topics.validate 校验，拒绝非白名单话题）
    const whitelistHit = this.data.topicCandidates.some((t) => t.title === topic);
    if (!whitelistHit) {
      try {
        const vRes = await wx.cloud.callFunction({
          name: "topics",
          data: { action: "validate", title: topic },
        });
        const v = (vRes.result && vRes.result.data) || {};
        if (!v.valid) {
          wx.showToast({
            title: v.msg || "话题不在白名单，请从辩题库选择",
            icon: "none", duration: 2500,
          });
          return;
        }
      } catch (e) {
        // P1 修复（云函数不可达不应锁死 L3 入口）：降级到本地兜底辩题精确匹配。
        // 仅放行与 FALLBACK_TOPICS 完全一致的命题，保持"辩题必须来自白名单"的合规底线。
        // 与 cloudfunctions/topics/index.js 的 validate fail-safe 行为一致。
        console.warn("[debate] topic validate failed, fallback to local match:", e);
        const seedHit = FALLBACK_TOPICS.some((t) => t.title === topic);
        if (!seedHit) {
          wx.showToast({ title: "话题不在白名单，请从辩题库选择", icon: "none", duration: 2500 });
          return;
        }
      }
    }

    await this.checkQuota();
    if (this.data.quotaExhausted) return;

    try {
      await this.ensureSession();
      const userMsg = displayMsg("user", topic, 1);
      await this.persistMessage("user", topic, 1);
      this.setData({
        phase: "debating",
        messages: [userMsg],
        round: 0,
        voteCounts: { affirmative: 0, negative: 0 },
      });
      await this.runRound(1);
    } catch (e) {
      console.error("[debate] start failed:", e);
      this.setData({ phase: "input" });
      // 配额耗尽时显示明确提示，避免误报为"网络异常"
      const title = e && e.code === -2 && e.userMsg
        ? e.userMsg
        : "网络异常，请稍后重试";
      wx.showToast({ title, icon: "none", duration: 2500 });
    }
  },

  async ensureSession() {
    if (this.sessionId) return;
    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "create", mode: "L3", topic: this.data.topic },
    });
    const result = res.result || {};
    const data = result.data || {};
    if (!data.sessionId) {
      if (result.code === -2) {
        // 测试期旁路：云端尚未部署 QUOTA_BYPASS 版云函数时，
        // 降级为"不落库继续辩论"，保证测试不中断
        if (config.quotaBypass) {
          this.sessionId = "";
          wx.showToast({ title: "测试模式：本次辩论暂不入库", icon: "none", duration: 2000 });
          return "";
        }
        this.setData({ quotaExhausted: true });
        const err = new Error("quota_exhausted");
        err.code = -2;
        err.userMsg = "今日 L3 辩论次数已用完，明日再会";
        throw err;
      }
      throw new Error("session create failed: " + (result.msg || "unknown"));
    }
    this.sessionId = data.sessionId;
    // 缓存 shareToken 用于分享链接（P1 防泄露：分享只带 token 不带 sessionId）
    this.shareToken = data.shareToken || "";
    return this.sessionId;
  },

  async runRound(round) {
    await this.streamOne({ role: "affirmative", round, apiMessages: this.buildAffirmativeMessages(round) });
    await this.streamOne({ role: "negative", round, apiMessages: this.buildNegativeMessages(round) });
    await this.streamOne({ role: "judge", round, apiMessages: this.buildJudgeMessages(round) });

    this.setData({ round, hasVotedThisRound: false });

    if (round >= MAX_ROUNDS) {
      this.setData({ phase: "finished" });
      this.promptReport();
    }
  },

  buildAffirmativeMessages(round) {
    const messages = [
      { role: "system", content: prompts.debate_affirmative },
      ...(this.sessionSummary ? [{ role: "system", content: "更早的辩论摘要：" + this.sessionSummary }] : []),
    ];
    const api = historyToApi(this.data.messages);
    if (round === 1) {
      messages.push({ role: "user", content: "辩论命题：" + this.data.topic });
    } else {
      messages.push(...api);
      messages.push({
        role: "user",
        content: "请展开正方本轮的核心论点（证据/推理/类比 三选一），回应反方上一轮的反驳。",
      });
    }
    return messages;
  },

  buildNegativeMessages(round) {
    const messages = [
      { role: "system", content: prompts.debate_negative },
      ...(this.sessionSummary ? [{ role: "system", content: "更早的辩论摘要：" + this.sessionSummary }] : []),
    ];
    const api = historyToApi(this.data.messages);
    messages.push(...api);
    messages.push({
      role: "user",
      content: round === 1
        ? "正方刚刚发表了首轮论证，请针对其核心论点或比喻进行反驳。"
        : "请针对正方本轮的论证进行反驳（指出逻辑跳跃/类比失当/证据不足/边界忽略 四选一）。",
    });
    return messages;
  },

  buildJudgeMessages(round) {
    const messages = [
      { role: "system", content: prompts.debate_judge },
      ...(this.sessionSummary ? [{ role: "system", content: "更早的辩论摘要：" + this.sessionSummary }] : []),
    ];
    const api = historyToApi(this.data.messages);
    messages.push(...api);
    messages.push({
      role: "user",
      content: "请点评第 " + round + " 轮双方表现：① 本轮一方更占优的具体点 ② 另一方暴露的漏洞 ③ 下一轮双方可以争夺的关键分歧点。不宣布胜方。",
    });
    return messages;
  },

  async streamOne({ role, round, apiMessages }) {
    return new Promise((resolve, reject) => {
      const newMsg = displayMsg(role, "", round);
      const messages = [...this.data.messages, newMsg];
      const msgIndex = messages.length - 1;
      this.setData({
        messages,
        streaming: true,
        waitingFirstChunk: true,
        currentRole: role,
      });
      // P0 修复（性能）：原实现每次 onChunk 都 `[...messages]` 全量 setData，
      // L3 模式每秒约 16 次跨线程通信，长对话累积卡顿。改用组件局部更新路径
      // renderMessages[lastIdx].content，仅下发增量字符串（与 socrates/dual 对齐）
      const chat = this.selectComponent("#chat");

      streamText({
        model: config.model.chat,
        messages: apiMessages,
        mode: "L3",
        sessionId: this.sessionId || "",
        onChunk: (delta) => {
          if (chat) {
            chat.appendChunk(delta);
          } else {
            // P1 性能优化：path-based 单条差量推送
            const cur = this.data.messages[msgIndex];
            this.setData({
              [`messages[${msgIndex}]`]: displayMsg(role, (cur && cur.content || "") + delta, round)
            });
          }
          if (this.data.waitingFirstChunk) {
            this.setData({ waitingFirstChunk: false });
          }
        },
        // 重试时 ai-stream 会从头重发内容：先清空气泡旧文本，避免新旧拼接
        onChunkReset: () => {
          // P1 性能优化：path-based 单条更新（合并其他字段一次调用）
          this.setData({
            [`messages[${msgIndex}]`]: displayMsg(role, "", round),
            waitingFirstChunk: false
          });
          if (chat) {
            const resetMessages = [...this.data.messages];
            resetMessages[msgIndex] = displayMsg(role, "", round);
            chat.buildRenderMessages(resetMessages);
          }
        },
        onStreamEnd: async ({ fullText, finishReason }) => {
          const safe = finishReason === "sensitive";
          let finalText = safe ? SENSITIVE_FALLBACK : fullText;

          // P1 修复（输出二次审核）：finish_reason 非 sensitive 时再做一次 msgSecCheck
          // 修复（2026-08-25）：跳过 eventStream 后 finish_reason 已失效，msgSecCheck
          // 成为最后一道真防线——degraded 时也必须 fail-close（合规优先于体验）。
          if (!safe && finalText) {
            try {
              const outCheck = await msgSecCheck(finalText, 2);
              if (!outCheck.pass) {
                finalText = SENSITIVE_FALLBACK;
              }
            } catch (e) {
              console.warn(`[debate] ${role} output second-check failed; fail-close:`, e && e.message);
              finalText = SENSITIVE_FALLBACK;
            }
          }

          // P1 性能优化：path-based 单条更新 + 合并状态字段一次调用
          this.setData({
            [`messages[${msgIndex}]`]: displayMsg(role, finalText, round),
            streaming: false,
            waitingFirstChunk: false
          });
          await this.persistMessage(role, finalText, round);
          resolve(finalText);
        },
        onError: (err) => {
          console.error("[debate] " + role + " stream error:", err);
          // 失败时移除失败气泡（避免重试时本轮出现两条相同角色的气泡）
          const updated = [...this.data.messages];
          updated.splice(msgIndex, 1);
          this.setData({ messages: updated, streaming: false, waitingFirstChunk: false });
          wx.showToast({ title: "AI 服务无响应，请稍后重试", icon: "none", duration: 2500 });
          reject(err);
        },
      });
    });
  },

  async persistMessage(role, content, round) {
    // 不落库模式（测试旁路降级 / 会话不存在）：静默跳过
    if (!this.sessionId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "append", sessionId: this.sessionId, role, content, round },
      });
      if (!res.result || res.result.code !== 0) {
        console.error("[debate] persist rejected:", (res.result && res.result.msg) || "unknown error");
      }
    } catch (e) {
      console.error("[debate] persist failed:", e);
    }
  },

  async continueNextRound() {
    if (this.data.round >= MAX_ROUNDS || this.data.streaming) return;
    try {
      await this.runRound(Number(this.data.round) + 1);
    } catch (e) {
      // runRound 内部某角色 streamOne 失败：失败气泡已替换为"发言失败"占位，
      // 此处兜底防止未处理的 Promise rejection。
      // 同时清理本轮失败气泡，避免重试时与新一轮气泡重叠。
      console.error("[debate] continueNextRound failed:", e);
      const messages = [...this.data.messages];
      // 移除最后一条标记为"发言失败"的气泡（避免视觉错乱）
      // 同时把当前轮已加入的其他角色气泡保留，以便用户感知上下文
      this.setData({ messages, streaming: false, waitingFirstChunk: false });
      wx.showToast({ title: "网络异常，本轮已中断，请重试", icon: "none", duration: 2000 });
    }
  },

  onVote(e) {
    if (this.data.hasVotedThisRound || this.data.round === 0) return;
    const side = e.currentTarget.dataset.side;
    if (side !== "affirmative" && side !== "negative") return;

    const voteCounts = { ...this.data.voteCounts };
    voteCounts[side] += 1;
    this.setData({ voteCounts, hasVotedThisRound: true });

    wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: {
        action: "trackVote",
        sessionId: this.sessionId,
        round: this.data.round,
        side,
      },
    }).catch((e) => console.error("[debate] vote track failed:", e));

    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
  },

  promptReport() {
    // 不入库降级模式（测试旁路下 create 被旧版云函数拒绝）：无会话可生成报告
    if (!this.sessionId) {
      wx.showModal({
        title: "无法生成报告",
        content: "本次辩论未在云端保存（测试降级模式），请先部署新版 sessionStore 云函数后再试。",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }
    wx.showModal({
      title: "辩论结束",
      content: "4 轮辩论已完成，去看看思辨报告吧。",
      confirmText: "查看报告",
      cancelText: "再看看",
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: "/pages/report/index?sessionId=" + this.sessionId,
          });
        }
      },
    });
  },

  onResetTopic() {
    if (this.data.streaming) return;
    this.setData({
      phase: "input",
      topic: "",
      messages: [],
      round: 0,
      hasVotedThisRound: false,
      voteCounts: { affirmative: 0, negative: 0 },
    });
    this.sessionId = null;
    this.sessionSummary = "";
    this.shareToken = "";
  },

  /** 退出辩论，返回首页 */
  onExitDebate() {
    // P1 修复：可访问性 + 反馈——加振动提示用户已触发按钮（原纯图标无文字无反馈）
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    wx.showModal({
      title: "退出辩论",
      content: "确定要退出本次辩论吗？",
      confirmColor: "#FB7185",
      success: (res) => {
        if (res.confirm) {
          this.onResetTopic();
          wx.navigateBack({ delta: 1 });
        }
      },
    });
  },

  /** 邀请好友围观（按钮入口；实际转发走 onShareAppMessage） */
  onInviteWatch() {
    if (!this.sessionId) return;
    wx.showToast({ title: "点击右上角 ··· 转发", icon: "none", duration: 2000 });
  },

  /** L3 辩论分享：本人带 shareToken（好友进入只读围观），无 token 兜底回首页 */
  onShareAppMessage() {
    const topic = this.data.topic || "AI 三方辩论";
    if (this.shareToken) {
      return {
        title: `围观这场辩论：${topic.slice(0, 20)}`,
        path: `/pages/report/index?token=${this.shareToken}`,
      };
    }
    return {
      title: "AI 思辨场 — 三方辩论围观",
      path: "/pages/index/index",
    };
  },

  /** 朋友圈分享（同上） */
  onShareTimeline() {
    return {
      title: `围观这场辩论：${(this.data.topic || "").slice(0, 20)}`,
      query: this.shareToken ? `token=${this.shareToken}` : "",
    };
  },
});

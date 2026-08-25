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
        data: { action: "list", limit: 6 },
      });
      const list = (res.result && res.result.data && res.result.data.topics) || [];
      this.setData({ topicCandidates: list, topicLoading: false });
    } catch (e) {
      console.error("[debate] load topics failed:", e);
      this.setData({ topicCandidates: [], topicLoading: false });
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

  onTopicInput(e) {
    const val = e && e.detail ? e.detail.value : "";
    this.setData({ topic: val });
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
        // 校验服务不可用时保守拒绝（避免非白名单流过）
        console.warn("[debate] topic validate failed:", e);
        wx.showToast({ title: "辩题校验失败，请从辩题库选择", icon: "none", duration: 2000 });
        return;
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

      streamText({
        model: config.model.chat,
        messages: apiMessages,
        mode: "L3",
        onChunk: (delta) => {
          const updated = [...this.data.messages];
          updated[msgIndex] = displayMsg(role, (updated[msgIndex].content || "") + delta, round);
          this.setData({ messages: updated, waitingFirstChunk: false });
        },
        // 重试时 ai-stream 会从头重发内容：先清空气泡旧文本，避免新旧拼接
        onChunkReset: () => {
          const resetMessages = [...this.data.messages];
          resetMessages[msgIndex] = displayMsg(role, "", round);
          this.setData({ messages: resetMessages, waitingFirstChunk: false });
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

          const updated = [...this.data.messages];
          updated[msgIndex] = displayMsg(role, finalText, round);
          this.setData({ messages: updated, streaming: false, waitingFirstChunk: false });
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
      await this.runRound(this.data.round + 1);
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

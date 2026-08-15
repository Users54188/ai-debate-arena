/**
 * L2 双人共修 — 用户 × 专家 × 苏格拉底 交替对话
 *
 * 流程：进入页面 → 校验 L2 配额（≤2 次/日）→ 用户输入 → msgSecCheck
 *       → 专家 router 匹配话题 → 创建会话（mode="L2"）
 *       → 轮次编排：用户 → 专家讲解 → 苏格拉底追问 → 用户 → ...
 *       → 6 用户轮（12 条消息）→ 跳转报告页
 *
 * 状态机由页面侧控制（不依赖云函数编排），实时路径不经云函数。
 * 复用 sessionStore.append（已有归属校验 + 原子追加 + 裁剪）。
 */

const { streamText } = require("../../utils/ai-stream");
const { msgSecCheck } = require("../../utils/security");
const { prompts } = require("../../utils/prompts");
const { route } = require("../../utils/expert-router");
const config = require("../../config");

const MAX_USER_ROUNDS = 6; // L2 封顶：6 用户轮 × 2 角色 = 12 条消息
const SENSITIVE_FALLBACK = "这个话题不太适合展开，我们换一个思辨话题吧。";

function displayMsg(role, content) {
  return { role, content };
}

function recentToApi(recent) {
  return (recent || []).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

Page({
  data: {
    messages: [],
    inputText: "",
    streaming: false,
    waitingFirstChunk: false,
    phase: "", // "expert" | "socrates" | ""
    round: 0,
    quotaExhausted: false,
    roundLimitReached: false,
  },

  onLoad() {
    this.sessionId = null;
    this.sessionSummary = "";
    this.expertPrompt = null;
    this.checkQuota();
  },

  onShow() {
    if (!this.data.streaming) this.checkQuota();
  },

  async checkQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.getQuota,
        data: { mode: "L2" },
      });
      const q = (res.result && res.result.data) || {};
      const exhausted = !q.available && q.used >= q.limit;
      if (exhausted !== this.data.quotaExhausted) {
        this.setData({ quotaExhausted: exhausted });
      }
    } catch (e) {
      console.error("[dual] quota check failed:", e);
    }
  },

  async ensureSession() {
    if (this.sessionId) return this.sessionId;
    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "create", mode: "L2" },
    });
    const data = (res.result && res.result.data) || {};
    if (!data.sessionId) {
      throw new Error("session create failed: " + ((res.result && res.result.msg) || "unknown"));
    }
    this.sessionId = data.sessionId;
    return this.sessionId;
  },

  async loadSessionContext() {
    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "get", sessionId: this.sessionId },
    });
    const session = (res.result && res.result.data && res.result.data.session) || {};
    this.sessionSummary = session.summary || "";
    const round = session.round || 0;
    if (round >= MAX_USER_ROUNDS) {
      this.setData({ roundLimitReached: true, round: round });
      return null;
    }
    this.setData({ round: round });
    return session.recent || [];
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.inputText.trim();
    if (!text || this.data.streaming || this.data.roundLimitReached) return;
    if (this.data.quotaExhausted) return;
    await this.checkQuota();
    if (this.data.quotaExhausted) return;

    const checkResult = await msgSecCheck(text, 1);
    if (!checkResult.pass) {
      wx.showToast({
        title: checkResult.degraded ? "网络繁忙，请稍后重试" : "内容包含违规信息，请修改后重试",
        icon: "none", duration: 2000,
      });
      return;
    }

    const newRound = this.data.round + 1;
    if (newRound > MAX_USER_ROUNDS) return;

    // 首轮匹配专家类型
    if (!this.expertPrompt) {
      const expert = route(text);
      this.expertPrompt = expert.prompt;
    }

    const messages = [...this.data.messages, displayMsg("user", text)];
    const userIdx = messages.length - 1;

    try {
      await this.ensureSession();
      const recent = await this.loadSessionContext();
      if (recent === null) return;

      // 显示用户气泡 + 专家占位气泡
      this.setData({
        messages: [...messages, displayMsg("expert", "")],
        inputText: "",
        streaming: true,
        waitingFirstChunk: true,
        round: newRound,
        phase: "expert",
      });
      const expertIdx = this.data.messages.length - 1;

      await this.persistMessage("user", text, newRound);

      // 阶段一：专家讲解
      const expertText = await this.doStream({
        role: "expert",
        msgIndex: expertIdx,
        apiMessages: [
          { role: "system", content: this.expertPrompt },
          ...(this.sessionSummary ? [{ role: "system", content: `更早的对话摘要：${this.sessionSummary}` }] : []),
          ...recentToApi(recent),
          { role: "user", content: text },
        ],
      });
      await this.persistMessage("assistant", expertText, newRound);

      // 阶段二：苏格拉底追问（能看到专家上一轮原话）
      const updatedMessages = [...this.data.messages, displayMsg("socrates", "")];
      this.setData({ messages: updatedMessages, waitingFirstChunk: true, phase: "socrates" });
      const socIdx = updatedMessages.length - 1;

      const socratesText = await this.doStream({
        role: "socrates",
        msgIndex: socIdx,
        apiMessages: [
          { role: "system", content: prompts.socrates },
          ...(this.sessionSummary ? [{ role: "system", content: `更早的对话摘要：${this.sessionSummary}` }] : []),
          ...recentToApi(recent),
          { role: "user", content: text },
          { role: "assistant", content: expertText },
          { role: "user", content: "专家刚才讲解了上面的内容。请就专家的讲解逻辑或用户原来的观点，追问一个具体的问题。" },
        ],
      });
      await this.persistMessage("assistant", socratesText, newRound);

      this.setData({ streaming: false, waitingFirstChunk: false, phase: "" });

      if (newRound >= MAX_USER_ROUNDS) {
        this.setData({ roundLimitReached: true });
        this.promptReport();
      }
    } catch (e) {
      console.error("[dual] send failed:", e);
      if (this.data.streaming) {
        const restored = this.data.messages.slice();
        // 失败时回滚本轮新增气泡：expert 阶段只多了 user+expert 共 2 条；
        // socrates 阶段多了 user+expert+socrates 共 3 条
        const trimCount = this.data.phase === "socrates" ? 3 : 2;
        restored.splice(userIdx, trimCount);
        this.setData({ messages: restored, inputText: text });
      } else {
        this.setData({ inputText: text });
      }
      this.setData({ streaming: false, waitingFirstChunk: false, phase: "" });
      wx.showToast({ title: "网络异常，请稍后重试", icon: "none", duration: 2000 });
    }
  },

  /** 单次流式调用（Promise 化，串行编排用） */
  doStream({ role, msgIndex, apiMessages }) {
    const self = this;
    return new Promise((resolve, reject) => {
      let fullText = "";
      streamText({
        model: config.model.chat,
        messages: apiMessages,
        mode: "L2",
        onChunk(delta) {
          fullText += delta;
          const updated = [...self.data.messages];
          updated[msgIndex] = displayMsg(role, fullText);
          self.setData({ messages: updated, waitingFirstChunk: false });
        },
        onStreamEnd({ fullText: final, finishReason }) {
          const safe = finishReason === "sensitive";
          let result = safe ? SENSITIVE_FALLBACK : final;

          // P1 修复（输出二次审核）：finish_reason 非 sensitive 时再做一次 msgSecCheck
          // degraded（审核服务异常）时不撤回，避免审核故障卡死对话
          const finalize = () => {
            const updated = [...self.data.messages];
            updated[msgIndex] = displayMsg(role, result);
            self.setData({ messages: updated });
            resolve(result);
          };

          if (!safe && result) {
            msgSecCheck(result, 2)
              .then((outCheck) => {
                if (!outCheck.pass && !outCheck.degraded) {
                  result = SENSITIVE_FALLBACK;
                }
                finalize();
              })
              .catch((e) => {
                console.warn(`[dual] ${role} output second-check failed:`, e);
                finalize();
              });
          } else {
            finalize();
          }
        },
        onError(err) {
          console.error(`[dual] ${role} stream error:`, err);
          const updated = [...self.data.messages];
          updated[msgIndex] = displayMsg(role, "抱歉，出了点问题。请稍后重试。");
          self.setData({ messages: updated });
          reject(err);
        },
      });
    });
  },

  async persistMessage(role, content, round) {
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "append", sessionId: this.sessionId, role, content, round },
      });
      if (!res.result || res.result.code !== 0) {
        console.error("[dual] persist rejected:", (res.result && res.result.msg) || "unknown error");
      }
    } catch (e) {
      console.error("[dual] persist failed:", e);
    }
  },

  promptReport() {
    wx.showModal({
      title: "共修完成",
      content: "已达 6 轮上限，去看看你的思辨报告吧。",
      confirmText: "查看报告",
      cancelText: "再看看",
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: `/pages/report/index?sessionId=${this.sessionId || ""}`,
          });
        }
      },
    });
  },
});
/**
 * socrates 页 — L1 苏格拉底追问 (W1 流式最小链路)
 *
 * 流程：输入 → msgSecCheck → 流式调用 hy3-preview → chat-stream 渲染 → usage 落库
 *
 * 修复记录（W1 验收）：
 * - 模型 API 只接受 system/user/assistant：组装请求时将 socrates 映射为 assistant
 * - finish_reason=sensitive 时撤回生成内容并显示兜底文案
 * - waitingFirstChunk：首帧到达前才显示"思考中"占位
 */

const { streamText } = require("../../utils/ai-stream");
const { msgSecCheck } = require("../../utils/security");
const { prompts } = require("../../utils/prompts");
const config = require("../../config");

const SENSITIVE_FALLBACK = "这个话题不太适合展开，我们换一个思辨话题吧。";

/** 展示用消息（role 保留业务角色，供组件渲染头像/配色） */
function displayMsg(role, content) {
  return { role, content };
}

/** API 用消息（role 映射为模型可接受的 system/user/assistant） */
function toApiMessages(displayMessages) {
  return displayMessages.map((m) => ({
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
    round: 0,
    quotaExhausted: false,
    roundLimitReached: false,
  },

  onLoad() {
    this.checkQuota();
  },

  onShow() {
    // 从其他页返回时刷新配额状态
    if (!this.data.streaming) {
      this.checkQuota();
    }
  },

  async checkQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.getQuota,
        data: { mode: "L1" },
      });
      const q = (res.result && res.result.data) || {};
      const exhausted = !q.available && q.used >= q.limit;
      if (exhausted !== this.data.quotaExhausted) {
        this.setData({ quotaExhausted: exhausted });
      }
    } catch (e) {
      console.error("[socrates] quota check failed:", e);
      // 查询失败不阻塞使用
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.inputText.trim();
    if (!text || this.data.streaming) return;

    // 配额检查（fail-open：查询失败时放行）
    if (this.data.quotaExhausted) return;
    await this.checkQuota();
    if (this.data.quotaExhausted) return;

    // 输入安全检查（fail-close：审核服务异常时拒绝发送）
    const checkResult = await msgSecCheck(text, 1);
    if (!checkResult.pass) {
      wx.showToast({
        title: checkResult.degraded ? "网络繁忙，请稍后重试" : "内容包含违规信息，请修改后重试",
        icon: "none",
        duration: 2000,
      });
      return;
    }

    const messages = [...this.data.messages, displayMsg("user", text)];
    const newRound = this.data.round + 1;
    const msgIndex = messages.length; // 流式气泡的位置

    this.setData({
      messages: [...messages, displayMsg("socrates", "")],
      inputText: "",
      streaming: true,
      waitingFirstChunk: true,
      round: newRound,
    });

    // 组装 API context：system + 历史（role 已映射）+ 本轮用户输入
    const apiMessages = [
      { role: "system", content: prompts.socrates },
      ...toApiMessages(messages),
    ];

    let streamingContent = "";
    const self = this;

    await streamText({
      model: config.model.chat,
      messages: apiMessages,
      mode: "L1",
      onChunk(delta) {
        streamingContent += delta;
        const updated = [...self.data.messages];
        updated[msgIndex] = displayMsg("socrates", streamingContent);
        self.setData({ messages: updated, waitingFirstChunk: false });
      },
      onStreamEnd({ fullText, finishReason }) {
        // 输出审核未通过：撤回内容，替换兜底文案
        const safe = finishReason === "sensitive";
        const finalText = safe ? SENSITIVE_FALLBACK : fullText;
        const finalMessages = [...self.data.messages];
        finalMessages[msgIndex] = displayMsg("socrates", finalText);

        self.setData({
          messages: finalMessages,
          streaming: false,
          waitingFirstChunk: false,
        });

        if (newRound >= config.maxRounds) {
          self.setData({ roundLimitReached: true });
        }
      },
      onError(err) {
        console.error("[socrates] stream error:", err);
        const errorMessages = [...self.data.messages];
        errorMessages[msgIndex] = displayMsg("socrates", "抱歉，出了点问题。请稍后重试。");
        self.setData({
          messages: errorMessages,
          streaming: false,
          waitingFirstChunk: false,
        });
      },
    });
  },
});

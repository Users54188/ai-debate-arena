/**
 * socrates 页 — L1 苏格拉底追问 (W1 流式最小链路)
 *
 * 流程：输入 → msgSecCheck → 流式调用 hy3-preview → chat-stream 渲染
 */

const { streamText } = require("../../utils/ai-stream");
const { msgSecCheck } = require("../../utils/security");
const { prompts } = require("../../utils/prompts");
const config = require("../../config");

Page({
  data: {
    messages: [],
    inputText: "",
    streaming: false,
    round: 0,
    quotaExhausted: false,
    roundLimitReached: false,
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.inputText.trim();
    if (!text || this.data.streaming) return;

    // 安全检查
    const checkResult = await msgSecCheck(text, 1);
    if (!checkResult.pass) {
      wx.showToast({
        title: "内容包含违规信息，请修改后重试",
        icon: "none",
        duration: 2000,
      });
      return;
    }

    const userMsg = { role: "user", content: text };
    const messages = [...this.data.messages, userMsg];
    const newRound = this.data.round + 1;

    this.setData({
      messages,
      inputText: "",
      streaming: true,
      round: newRound,
    });

    // 组装 context
    const systemMsg = { role: "system", content: prompts.socrates };
    const apiMessages = [systemMsg, ...messages];

    // 流式调用
    let streamingContent = "";
    const streamingMsg = { role: "socrates", content: "" };
    const msgIndex = messages.length;
    this.setData({
      messages: [...messages, streamingMsg],
    });

    await streamText({
      model: config.model.chat,
      messages: apiMessages,
      mode: "L1",
      onChunk(accumulated) {
        streamingContent += accumulated;
        const updated = [...this.data.messages];
        updated[msgIndex] = { role: "socrates", content: streamingContent };
        this.setData({ messages: updated });
      }.bind(this),
      onStreamEnd({ fullText, usage }) {
        const finalMessages = [...this.data.messages];
        finalMessages[msgIndex] = { role: "socrates", content: fullText };
        this.setData({
          messages: finalMessages,
          streaming: false,
        });

        // 10 轮上限检查
        if (newRound >= config.maxRounds) {
          this.setData({ roundLimitReached: true });
        }

        // W1 临时：直接把 usage 展示到 console（W2 接入 token_usage 表）
        console.log("[usage]", usage);
      }.bind(this),
      onError(err) {
        console.error("[socrates] stream error:", err);
        const errorMessages = [...this.data.messages];
        errorMessages[msgIndex] = {
          role: "socrates",
          content: "抱歉，出了点问题。请稍后重试。",
        };
        this.setData({
          messages: errorMessages,
          streaming: false,
        });
      }.bind(this),
    });
  },

  onStreamEnd(e) {
    // 可选：从组件事件接收 usage
    console.log("[chat-stream] onStreamEnd", e.detail);
  },
});

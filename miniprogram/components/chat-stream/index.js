/**
 * chat-stream 组件 — 通用对话流渲染
 * W1 支持单角色（苏格拉底）；后续扩展多角色。
 *
 * Properties:
 *   messages: Array<{ role: 'user'|'socrates'|'expert'|'affirmative'|'negative'|'judge', content: string }>
 *   streaming: boolean — 是否处于流式接收中
 *   waitingFirstChunk: boolean — 首帧未到达时显示"思考中"占位
 *   showAiLabel: boolean — 是否显示 AI 生成标识
 *
 * 修复记录（W1 验收）：
 * - WXML 不支持调用组件方法：roleText/bubbleCls 在 observers 中预计算为 renderMessages
 */

const ROLE_LABELS = {
  user: "我",
  socrates: "苏格拉底",
  expert: "专家",
  affirmative: "正方",
  negative: "反方",
  judge: "裁判",
};

const BUBBLE_CLASSES = {
  user: "bubble-user",
  socrates: "bubble-socrates",
  expert: "bubble-expert",
  affirmative: "bubble-affirmative",
  negative: "bubble-negative",
  judge: "bubble-judge",
};

Component({
  properties: {
    messages: { type: Array, value: [] },
    streaming: { type: Boolean, value: false },
    waitingFirstChunk: { type: Boolean, value: false },
    waitingText: { type: String, value: "思考中" },
    showAiLabel: { type: Boolean, value: true },
  },

  data: {
    renderMessages: [],
    scrollTop: 0,
  },

  observers: {
    messages(list) {
      this.buildRenderMessages(list);
      this.scrollToBottom();
    },
    "streaming, waitingFirstChunk"() {
      this.scrollToBottom();
    },
  },

  methods: {
    buildRenderMessages(list) {
      const renderMessages = (list || []).map((m) => ({
        role: m.role,
        content: m.content,
        isUser: m.role === "user",
        roleText: ROLE_LABELS[m.role] || m.role,
        bubbleCls: BUBBLE_CLASSES[m.role] || "bubble-default",
      }));
      this.setData({ renderMessages });
    },

    scrollToBottom() {
      wx.nextTick(() => {
        wx.createSelectorQuery()
          .in(this)
          .select("#chat-scroll-view")
          .boundingClientRect()
          .select("#chat-bottom-anchor")
          .boundingClientRect()
          .exec((res) => {
            if (res[0] && res[1]) {
              const scrollHeight = res[0].height;
              const anchorTop = res[1].top;
              this.setData({
                scrollTop: this.data.scrollTop + anchorTop - scrollHeight,
              });
            }
          });
      });
    },
  },
});

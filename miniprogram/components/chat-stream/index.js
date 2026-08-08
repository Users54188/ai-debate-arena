/**
 * chat-stream 组件 — 通用对话流渲染
 * W1 支持单角色（苏格拉底）；后续扩展多角色。
 *
 * Properties:
 *   messages: Array<{ role: 'user'|'socrates'|'expert'|'affirmative'|'negative'|'judge', content: string }>
 *   streaming: boolean — 是否处于流式接收中
 *   showSensitive: boolean — 触发敏感词撤回后展示兜底文案
 *
 * Events:
 *   onStreamEnd: { usage }
 */

Component({
  properties: {
    messages: { type: Array, value: [] },
    streaming: { type: Boolean, value: false },
    showAiLabel: { type: Boolean, value: true }, // AI 生成标识
  },

  data: {
    scrollTop: 0,
  },

  observers: {
    "messages, streaming"() {
      // 新消息时自动滚底
      this.scrollToBottom();
    },
  },

  methods: {
    scrollToBottom() {
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
    },

    /** 角色标签文案 */
    roleLabel(role) {
      const map = {
        user: "我",
        socrates: "苏格拉底",
        expert: "专家",
        affirmative: "正方",
        negative: "反方",
        judge: "裁判",
      };
      return map[role] || role;
    },

    /** 角色气泡色类 */
    bubbleClass(role) {
      if (role === "user") return "bubble-user";
      const map = {
        socrates: "bubble-socrates",
        expert: "bubble-expert",
        affirmative: "bubble-affirmative",
        negative: "bubble-negative",
        judge: "bubble-judge",
      };
      return map[role] || "bubble-default";
    },
  },
});

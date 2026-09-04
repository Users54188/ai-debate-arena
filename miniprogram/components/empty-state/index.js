/**
 * empty-state 组件 — 统一的空状态/错误态/loading 占位
 *
 * 使用：
 *   <empty-state wx:if="{{empty}}" mode="empty" title="还没有思辨记录" cta="去试试" bind:tap="onCta" />
 *   <empty-state wx:if="{{loadError}}" mode="error" title="{{loadError}}" cta="重试" bind:tap="onRetry" />
 *   <empty-state wx:if="{{loading}}" mode="loading" />
 *
 * mode: "loading" | "empty" | "error"
 */

Component({
  properties: {
    mode: { type: String, value: "empty" },
    title: { type: String, value: "" },
    desc: { type: String, value: "" },
    cta: { type: String, value: "" },
  },

  data: {
    defaultMeta: {
      loading: { emoji: "⏳", defaultTitle: "加载中..." },
      empty: { emoji: "📭", defaultTitle: "暂无数据" },
      error: { emoji: "⚠️", defaultTitle: "出错了" },
    },
  },

  methods: {
    onCta() {
      this.triggerEvent("tap");
    },
  },
});

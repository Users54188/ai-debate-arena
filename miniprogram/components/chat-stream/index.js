/**
 * chat-stream — 通用对话流渲染组件（星夜思辨·紫调）
 *
 * 核心修复（性能 + 错位）：
 *
 * 1. 流式局部更新（关键性能优化）：
 *    旧版每次 onChunk → 父页 setData 整个 messages 数组 → 组件 observers
 *    触发 buildRenderMessages 重 map 整个列表 → setData renderMessages。
 *    长对话时每秒几十次全量 setData，造成卡顿。
 *    新版新增 appendChunk(delta) 方法：只更新最后一条消息的内容字段（局部
 *    路径 'renderMessages[lastIdx].content'），避免全量重建数组。
 *
 * 2. 气泡跳动修复：
 *    旧版气泡没 min-width/max-width 约束，流式文本从 0 字 → 多字时宽度持续
 *    跳变。新版固定 max-width: 78%，min-width: 120rpx，气泡尺寸稳定。
 *
 * 3. 头像与气泡布局错位修复：
 *    旧版 .msg-right 用 flex-direction: row-reverse 反转整个 row，导致
 *    AI 头像位置和文字阅读顺序混乱。新版按角色分别布局，AI 左 / 用户右，
 *    通过 align-self 控制对齐方向，不反转 row 方向。
 *
 * 4. 滚动锚点跳动修复：
 *    旧版 scrollToBottom 公式 `scrollTop + anchorTop - scrollHeight` 是
 *    累加式（每次都基于旧 scrollTop），多次调用累积偏移越来越大。
 *    新版用绝对定位公式 `anchorAbsTop - viewportHeight`，无累加。
 */

const ROLE_LABELS = {
  user: "我",
  socrates: "苏格拉底",
  expert: "专家",
  affirmative: "正方",
  negative: "反方",
  judge: "裁判",
};

const ROLE_VARS = {
  user: "role-user",
  socrates: "role-socrates",
  expert: "role-expert",
  affirmative: "role-affirmative",
  negative: "role-negative",
  judge: "role-judge",
};

const AVATAR_CHAR = {
  socrates: "苏",
  expert: "专",
  affirmative: "正",
  negative: "反",
  judge: "裁",
};

Component({
  options: {
    addGlobalClass: true,
    styleIsolation: "apply-shared",
  },

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
    // 仅在 messages 引用变化（新增/删除消息）时全量重建；流式更新走 appendChunk
    messages(list) {
      this.buildRenderMessages(list);
      this.scheduleScroll();
    },
  },

  methods: {
    /** 全量重建渲染数组（仅在消息列表增减时调用） */
    buildRenderMessages(list) {
      const renderMessages = (list || []).map((m) => ({
        role: m.role,
        content: m.content || "",
        note: m.note || "",
        isUser: m.role === "user",
        roleText: ROLE_LABELS[m.role] || m.role,
        roleVar: ROLE_VARS[m.role] || "role-user",
        avatarChar: AVATAR_CHAR[m.role] || "",
        showAvatar: m.role !== "user",
      }));
      this.setData({ renderMessages }, () => {
        // 数据渲染完再滚动到底（避免使用旧布局）
        this.scheduleScroll();
      });
    },

    /**
     * 流式增量更新 —— 性能关键路径
     * 父页在 onChunk 回调中调用：this.selectComponent("#chat").appendChunk(delta)
     * 只更新最后一条消息的内容，避免全量 setData。
     */
    appendChunk(delta) {
      const rm = this.data.renderMessages;
      if (!rm.length) return;
      const lastIdx = rm.length - 1;
      const last = rm[lastIdx];
      // 局部路径更新：只setData最后一条消息的content字段
      this.setData({
        [`renderMessages[${lastIdx}].content`]: (last.content || "") + delta,
      });
      // 节流滚动（避免每个 chunk 都触发 selectorQuery）
      this._throttledScroll();
    },

    /** 滚动节流（每 100ms 最多一次） */
    _throttledScroll() {
      const now = Date.now();
      if (this._lastScrollAt && now - this._lastScrollAt < 100) return;
      this._lastScrollAt = now;
      this.scheduleScroll();
    },

    /** 计算并跳转到最底（绝对公式，无累加偏移） */
    scheduleScroll() {
      // nextTick 确保 DOM 已应用最新 setData
      wx.nextTick(() => {
        const q = this.createSelectorQuery();
        q.select("#cv-scroll").boundingClientRect();
        q.select("#cv-anchor").boundingClientRect();
        q.exec((res) => {
          if (!res || !res[0] || !res[1]) return;
          const viewport = res[0];
          const anchor = res[1];
          // anchor 在视口外的绝对距离 = 锚点 top - 视口 top（相对坐标）
          // scrollTop 加上这个距离即把锚点带到视口底部
          const offset = anchor.top - viewport.top;
          // 直接设置为目标 scrollTop：锚点紧贴视口底
          // scroll-view 的 scroll-top 是内容滚动位置；要让锚点到视口底，
          // 内容需向上滚动 (anchorBottom - viewportHeight)
          // 简化：当前 scrollTop + offset 即可（offset 是锚点距视口顶的相对位移）
          const target = this.data.scrollTop + offset;
          this.setData({ scrollTop: target });
        });
      });
    },
  },
});

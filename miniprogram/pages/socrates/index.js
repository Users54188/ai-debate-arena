/**
 * socrates 页 — L1 苏格拉底追问（W2 完整对话状态机）
 *
 * 流程：进入页面 → 校验配额 → 用户输入 → msgSecCheck → 创建/读取会话
 *       → 组装上下文（system + 滚动摘要 + recent 8 轮 + 用户消息）→ 流式调用
 *       → 回复完成 → sessionStore 落库 → 等待下一轮
 *
 * W2 新增：
 * - sessionStore create/append 落库，getQuota 配额定额按 sessions 表统计生效
 * - 第 9 轮起由 sessionStore 触发滚动摘要（recent 只保留最近 8 轮）
 * - 达到 10 轮上限：停止追问，跳转报告页占位（W3 实现）
 *
 * 修复记录（W1 验收）：
 * - 模型 API 只接受 system/user/assistant：组装请求时将业务角色映射为 assistant
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

/** 服务端 recent 消息 → API messages（role 映射为模型可接受的 user/assistant） */
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
    round: 0,
    quotaExhausted: false,
    roundLimitReached: false,
  },

  onLoad() {
    this.sessionId = null;
    this.sessionSummary = "";
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

  /** 首轮时创建会话（配额按 sessions 表 openid+mode+当日统计） */
  async ensureSession() {
    if (this.sessionId) return this.sessionId;

    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "create", mode: "L1" },
    });
    const data = (res.result && res.result.data) || {};
    if (!data.sessionId) {
      throw new Error("session create failed: " + ((res.result && res.result.msg) || "unknown"));
    }
    this.sessionId = data.sessionId;
    return this.sessionId;
  },

  /** 从云端恢复会话上下文（recent 8 轮 + 滚动摘要），并同步轮数 */
  async loadSessionContext() {
    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "get", sessionId: this.sessionId },
    });
    const session = (res.result && res.result.data && res.result.data.session) || {};
    this.sessionSummary = session.summary || "";
    const round = session.round || 0;

    // 云端已完成 10 轮（例如上次会话已结束）→ 直接封顶
    if (round >= config.maxRounds) {
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

    const newRound = this.data.round + 1;
    if (newRound > config.maxRounds) return;

    const messages = [...this.data.messages, displayMsg("user", text)];
    const msgIndex = messages.length; // 流式气泡的位置

    try {
      // 创建/恢复会话（云端裁剪与摘要逻辑在 append 内）
      await this.ensureSession();
      const recent = await this.loadSessionContext();
      if (recent === null) return; // 已满 10 轮

      this.setData({
        messages: [...messages, displayMsg("socrates", "")],
        inputText: "",
        streaming: true,
        waitingFirstChunk: true,
        round: newRound,
      });

      // 用户消息先行落库（保证云端上下文与展示一致）
      await this.persistMessage("user", text, newRound);

      // 组装 API context：system + 滚动摘要 + 历史（role 已映射）+ 本轮用户输入
      const apiMessages = [
        { role: "system", content: prompts.socrates },
        ...(this.sessionSummary
          ? [{ role: "system", content: `更早的对话摘要：${this.sessionSummary}` }]
          : []),
        ...recentToApi(recent),
        { role: "user", content: text },
      ];

      await this.runStream(apiMessages, msgIndex, newRound);
    } catch (e) {
      console.error("[socrates] send failed:", e);
      // 清洗半成品状态，允许用户重试
      this.setData({ streaming: false, waitingFirstChunk: false });
      wx.showToast({
        title: "网络异常，请稍后重试",
        icon: "none",
        duration: 2000,
      });
    }
  },

  /** 落库单条消息（user 在流式前、assistant 在流式后；入参 role 为 API 角色） */
  async persistMessage(role, content, round) {
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "append", sessionId: this.sessionId, role, content, round },
      });
      // 云函数以 { code, msg } 返回业务结果，抛异常只是兜底，必须检查 code
      if (!res.result || res.result.code !== 0) {
        console.error(
          "[socrates] persist rejected:",
          (res.result && res.result.msg) || "unknown error"
        );
      }
    } catch (e) {
      console.error("[socrates] persist failed:", e);
      // 落库失败不阻断当轮对话；append 只追加不合并，缺失消息不会自动补齐
    }
  },

  async runStream(apiMessages, msgIndex, newRound) {
    const self = this;
    let streamingContent = "";

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
      onStreamEnd: async ({ fullText, finishReason }) => {
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

        // 苏格拉底回复落库（API 角色 assistant；sessionStore append 只接受 user|assistant）
        await self.persistMessage("assistant", finalText, newRound);

        if (newRound >= config.maxRounds) {
          self.setData({ roundLimitReached: true });
          self.promptReport();
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

  /** 10 轮结束：引导进入报告环节（报告页 W3 实现，本周占位跳转） */
  promptReport() {
    wx.showModal({
      title: "思辨完成",
      content: "已达 10 轮上限，去看看你的思辨报告吧。",
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
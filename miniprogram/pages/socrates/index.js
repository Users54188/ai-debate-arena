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

/** AI 收尾判定标记（prompt 约定：思辨充分时模型在回复末尾另起一行输出 [[END]]） */
const END_MARK_RE = /\[\[\s*end\s*\]\]/i;

/** 剥离收尾标记（容错空格/换行），返回干净文本用于渲染与落库 */
function stripEndMark(text) {
  return String(text || "").replace(/\n*\s*\[\[\s*end\s*\]\]\s*/gi, "").trim();
}

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
    aiEndSuggested: false, // AI 收尾判定：认为思辨已充分（软信号，可继续追问）
    loading: true,
  },

  onLoad() {
    try {
      this.sessionId = null;
      this.sessionSummary = "";
      this.checkQuota();
      this.setData({ loading: false });
    } catch (e) {
      console.error("[socrates] onLoad failed:", e);
      this.setData({ loading: false });
    }
  },

  onShow() {
    // 从其他页返回时刷新配额状态
    if (!this.data.streaming) {
      this.checkQuota();
    }
  },

  async checkQuota() {
    // 测试期旁路：配额放开（config.quotaBypass）时跳过查询，避免当日历史会话数
    // 达到旧版云函数的 new 档上限后，sendMessage 被静默拦截（表现为"N 轮后点不动"）
    if (config.quotaBypass) return;
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.getQuota,
        data: { mode: "L1" },
      });
      const q = (res.result && res.result.data) || {};
      const exhausted = !q.available && q.used >= q.limit;
      const wasExhausted = this.data.quotaExhausted;
      if (exhausted !== wasExhausted) {
        this.setData({ quotaExhausted: exhausted });
        // 配额刚变成耗尽时主动提示，避免用户不知道为什么按钮点不动
        if (exhausted) {
          wx.showToast({ title: "今日 L1 会话次数已用完，明日再会", icon: "none", duration: 2500 });
        }
      }
    } catch (e) {
      console.error("[socrates] quota check failed:", e);
    }
  },

  /** 首轮时创建会话（配额按 sessions 表 openid+mode+当日统计） */
  async ensureSession() {
    if (this.sessionId) return this.sessionId;

    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "create", mode: "L1" },
    });
    const result = res.result || {};
    const data = result.data || {};
    if (!data.sessionId) {
      // 区分配额耗尽（code:-2）与其他错误，让前端提示更准确
      if (result.code === -2) {
        // 测试期旁路：云端尚未部署 QUOTA_BYPASS 版云函数时，
        // 降级为"不落库继续对话"，保证测试不中断
        if (config.quotaBypass) {
          this.sessionId = "";
          wx.showToast({ title: "测试模式：本次对话暂不入库", icon: "none", duration: 2000 });
          return "";
        }
        this.setData({ quotaExhausted: true });
        const err = new Error("quota_exhausted");
        err.code = -2;
        err.userMsg = "今日 L1 会话次数已用完，明日再会";
        throw err;
      }
      throw new Error("session create failed: " + (result.msg || "unknown"));
    }
    this.sessionId = data.sessionId;
    return this.sessionId;
  },

  /** 从云端恢复会话上下文（recent 8 轮 + 滚动摘要），并同步轮数 */
  async loadSessionContext() {
    // 测试旁路降级（sessionId 为空 = 不落库模式）：跳过云端读取
    if (!this.sessionId) return [];
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
    // 防御性检查：配额耗尽时按钮虽然已 disabled，但仍显式提示
    // （与 dual / debate 行为一致，避免用户不知道为什么没反应）
    if (this.data.quotaExhausted) {
      wx.showToast({ title: "今日 L1 会话次数已用完，明日再会", icon: "none", duration: 2500 });
      return;
    }

    const newRound = this.data.round + 1;
    if (newRound > config.maxRounds) return;

    // 用户无视 AI 的收尾建议继续追问：清除建议态
    if (this.data.aiEndSuggested) this.setData({ aiEndSuggested: false });

    // 优化：点击立即上屏用户消息 + 思考态，避免串行云调用期间"假死"
    const msgIndex = this.data.messages.length + 1; // 苏格拉底流式气泡的位置
    this.setData({
      messages: [...this.data.messages, displayMsg("user", text), displayMsg("socrates", "")],
      inputText: "",
      streaming: true,
      waitingFirstChunk: true,
      round: newRound,
    });

    try {
      // 安全审核与会话创建并行，缩短首屏延迟
      const [checkResult, sessionId] = await Promise.all([
        msgSecCheck(text, 1),
        this.ensureSession(),
      ]);

      // 审核不通过：撤回本轮气泡并提示（fail-close）
      if (!checkResult.pass) {
        const restored = this.data.messages.slice();
        restored.splice(msgIndex - 1, 2);
        this.setData({ messages: restored, inputText: text, streaming: false, waitingFirstChunk: false });
        wx.showToast({
          title: checkResult.degraded ? "网络繁忙，请稍后重试" : "内容包含违规信息，请修改后重试",
          icon: "none",
          duration: 2000,
        });
        return;
      }

      const recent = await this.loadSessionContext();
      if (recent === null) {
        this.setData({ streaming: false, waitingFirstChunk: false });
        return; // 已满上限
      }

      // 用户消息落库与流式生成并行（落库不阻塞首字渲染）
      this.persistMessage("user", text, newRound);

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
      // 清除本轮已 push 的用户气泡与空回复气泡，恢复输入框
      const restored = this.data.messages.slice();
      restored.splice(msgIndex - 1, 2);
      this.setData({ messages: restored, inputText: text, streaming: false, waitingFirstChunk: false });
      // 配额耗尽时显示明确提示，避免误报为"网络异常"
      const title = e && e.code === -2 && e.userMsg
        ? e.userMsg
        : "网络异常，请稍后重试";
      wx.showToast({ title, icon: "none", duration: 2500 });
    }
  },

  /** 落库单条消息（user 在流式前、assistant 在流式后；入参 role 为 API 角色） */
  async persistMessage(role, content, round) {
    // 不落库模式（测试旁路降级 / 会话不存在）：静默跳过
    if (!this.sessionId) return;
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
    let streamingContent = ""; // 模型原始输出（可能含 [[END]] 收尾标记）
    let renderedLen = 0;       // 已渲染到气泡的长度（标记扣留后）
    const chat = self.selectComponent("#chat");

    // 流式防闪现：[[END]] 标记可能分片到达，从最后一个 "[" 起扣留不下发；
    // 若最终不是标记，流结束时补发剩余部分
    const HOLD_WINDOW = 10;
    const flushSafe = () => {
      let safeLen = streamingContent.length;
      if (safeLen > renderedLen) {
        const windowStart = Math.max(renderedLen, safeLen - HOLD_WINDOW);
        const braceIdx = streamingContent.lastIndexOf("[", safeLen - 1);
        if (braceIdx >= windowStart) safeLen = braceIdx;
      }
      if (safeLen > renderedLen) {
        const delta = streamingContent.slice(renderedLen, safeLen);
        renderedLen = safeLen;
        if (chat) {
          chat.appendChunk(delta);
        } else {
          const updated = [...self.data.messages];
          updated[msgIndex] = displayMsg("socrates", streamingContent.slice(0, renderedLen));
          self.setData({ messages: updated });
        }
      }
    };

    await streamText({
      model: config.model.chat,
      messages: apiMessages,
      mode: "L1",
      onChunk(delta) {
        streamingContent += delta;
        flushSafe();
        if (self.data.waitingFirstChunk) {
          self.setData({ waitingFirstChunk: false });
        }
      },
      onStreamEnd: async ({ fullText, finishReason }) => {
        // AI 收尾判定：剥离 [[END]] 标记并置建议态——多重判定之一，
        // 属软信号：只提示"可结束"，不锁定输入，用户仍可继续追问
        let aiSuggested = false;
        const safe = finishReason === "sensitive";
        let finalText = safe ? SENSITIVE_FALLBACK : fullText;

        if (!safe && END_MARK_RE.test(finalText)) {
          aiSuggested = true;
          finalText = stripEndMark(finalText);
        }

        // P1 修复（输出二次审核）：finish_reason 非 sensitive 时也再做一次 msgSecCheck
        // 防 finish_reason 漏报；degraded（审核服务异常）时不撤回（fail-open，
        // 已经过第一道 sensitive 检测，不应让审核服务故障卡死用户）
        if (!safe && finalText) {
          try {
            const outCheck = await msgSecCheck(finalText, 2);
            if (!outCheck.pass && !outCheck.degraded) {
              finalText = SENSITIVE_FALLBACK;
            }
          } catch (e) {
            console.warn("[socrates] output second-check failed:", e);
          }
        }

        const finalMessages = [...self.data.messages];
        finalMessages[msgIndex] = displayMsg("socrates", finalText);

        self.setData({
          messages: finalMessages,
          streaming: false,
          waitingFirstChunk: false,
          aiEndSuggested: aiSuggested,
        });

        // 苏格拉底回复落库（API 角色 assistant；sessionStore append 只接受 user|assistant）；
        // 落库剥离标记后的干净文本，避免报告/下一轮上下文被标记污染
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

  /** 用户主动结束（多重判定之二）：确认后锁定输入并引导生成报告 */
  onManualEnd() {
    if (this.data.roundLimitReached || this.data.streaming) return;
    if (!this.data.messages.length) return;
    wx.showModal({
      title: "结束思辨",
      content: "确定现在结束并生成思辨报告吗？",
      confirmText: "结束",
      cancelText: "继续聊",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ roundLimitReached: true, aiEndSuggested: false });
        this.promptReport();
      },
    });
  },

  /** 思辨结束：引导进入报告页（三重判定共用出口；sessionId 为空时报告页显示"会话不存在"防御） */
  promptReport() {
    wx.showModal({
      title: "思辨完成",
      content: "去看看你的思辨报告吧。",
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
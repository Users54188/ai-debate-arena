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

  /** 调试日志：仅输出到 Console（保留调用点便于将来排查） */
  _dLog(msg, level) {
    const lv = level || "info";
    if (lv === "error") console.error(msg);
    else if (lv === "warn") console.warn(msg);
    else console.log(msg);
  },

  onLoad() {
    this._dLog("onLoad entered", "step");
    try {
      this.sessionId = null;
      this.sessionSummary = "";
      this._dLog("onLoad calling checkQuota, quotaBypass=" + config.quotaBypass, "step");
      this.checkQuota();
      this.setData({ loading: false });
      this._dLog("onLoad done, loading=false", "step");
    } catch (e) {
      this._dLog("onLoad FAILED: " + (e && e.message), "error");
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
    if (config.quotaBypass) {
      this._dLog("checkQuota: quotaBypass=true, 跳过", "info");
      return;
    }
    this._dLog("checkQuota: 调用 getQuota 云函数", "step");
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.getQuota,
        data: { mode: "L1" },
      });
      const q = (res.result && res.result.data) || {};
      this._dLog("checkQuota 返回: used=" + q.used + " limit=" + q.limit + " available=" + q.available, "info");
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
      this._dLog("checkQuota 失败: " + ((e && e.message) || e), "error");
    }
  },

  /** 首轮时创建会话（配额按 sessions 表 openid+mode+当日统计） */
  async ensureSession() {
    if (this.sessionId) {
      this._dLog("ensureSession: 已有 sessionId=" + this.sessionId, "info");
      return this.sessionId;
    }
    this._dLog("ensureSession: 调用 sessionStore.create", "step");

    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "create", mode: "L1" },
    });
    const result = res.result || {};
    const data = result.data || {};
    this._dLog("ensureSession 返回 code=" + result.code + " sessionId=" + (data.sessionId || "空"), "info");
    if (!data.sessionId) {
      // 区分配额耗尽（code:-2）与其他错误，让前端提示更准确
      if (result.code === -2) {
        // 测试期旁路：云端尚未部署 QUOTA_BYPASS 版云函数时，
        // 降级为"不落库继续对话"，保证测试不中断
        if (config.quotaBypass) {
          this._dLog("ensureSession: code=-2 + quotaBypass,降级为空 sessionId", "warn");
          this.sessionId = "";
          wx.showToast({ title: "测试模式：本次对话暂不入库", icon: "none", duration: 2000 });
          return "";
        }
        this._dLog("ensureSession: 配额耗尽,抛错", "error");
        this.setData({ quotaExhausted: true });
        const err = new Error("quota_exhausted");
        err.code = -2;
        err.userMsg = "今日 L1 会话次数已用完，明日再会";
        throw err;
      }
      this._dLog("ensureSession: 创建失败,抛错: " + (result.msg || "unknown"), "error");
      throw new Error("session create failed: " + (result.msg || "unknown"));
    }
    this.sessionId = data.sessionId;
    this._dLog("ensureSession 成功, sessionId=" + this.sessionId, "info");
    return this.sessionId;
  },

  /** 从云端恢复会话上下文（recent 8 轮 + 滚动摘要），并同步轮数 */
  async loadSessionContext() {
    // 测试旁路降级（sessionId 为空 = 不落库模式）：跳过云端读取
    if (!this.sessionId) {
      this._dLog("loadSessionContext: sessionId 空,返回空数组", "info");
      return [];
    }
    this._dLog("loadSessionContext: 调用 sessionStore.get", "step");
    const res = await wx.cloud.callFunction({
      name: config.cloudFunctions.sessionStore,
      data: { action: "get", sessionId: this.sessionId },
    });
    const session = (res.result && res.result.data && res.result.data.session) || {};
    this.sessionSummary = session.summary || "";
    const round = Number(session.round) || 0;
    this._dLog("loadSessionContext 返回: round=" + round + " recent=" + ((session.recent || []).length) + "条 status=" + (session.status || "空"), "info");

    // 云端已完成 10 轮（例如上次会话已结束）→ 直接封顶
    if (round >= config.maxRounds) {
      this._dLog("loadSessionContext: round(" + round + ") >= maxRounds(" + config.maxRounds + "),封顶", "warn");
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
    this._dLog("sendMessage 入口 text=" + (text ? "Y" : "N") + " streaming=" + this.data.streaming + " roundLimit=" + this.data.roundLimitReached + " round=" + this.data.round, "step");
    if (!text || this.data.streaming || this.data.roundLimitReached) {
      // 诊断日志：定位"点击无反应"的具体拦截点（streaming 卡死时此处会持续命中）
      this._dLog("BLOCKED: text=" + (!text ? "空" : "Y") + " streaming=" + this.data.streaming + " roundLimit=" + this.data.roundLimitReached, "warn");
      return;
    }
    // 防御性检查：配额耗尽时按钮虽然已 disabled，但仍显式提示
    // （与 dual / debate 行为一致，避免用户不知道为什么没反应）
    if (this.data.quotaExhausted) {
      this._dLog("BLOCKED: quotaExhausted", "warn");
      wx.showToast({ title: "今日 L1 会话次数已用完，明日再会", icon: "none", duration: 2500 });
      return;
    }

    const newRound = Number(this.data.round) + 1;
    this._dLog("newRound=" + newRound + " maxRounds=" + config.maxRounds, "info");
    if (newRound > config.maxRounds) {
      this._dLog("BLOCKED: newRound > maxRounds", "warn");
      return;
    }

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
    this._dLog("UI 更新完成,准备 msgSecCheck + ensureSession 并行", "step");

    try {
      // 安全审核与会话创建并行，缩短首屏延迟
      // 注意：刻意不用数组解构（const [a, b] = ...）——SWC 编译产物会引用
      // @swc/runtime/_array_with_holes 辅助模块，在灰度基础库/热重载缓存损坏的
      // 工具组合下该模块缺失，导致整页 JS 加载失败（点击全部无反应）
      const parallelResults = await Promise.all([
        msgSecCheck(text, 1),
        this.ensureSession(),
      ]);
      const checkResult = parallelResults[0];
      this._dLog("并行调用完成,checkResult.pass=" + checkResult.pass + " degraded=" + checkResult.degraded + " sessionId=" + (this.sessionId || "空"), "info");

      // 审核不通过：撤回本轮气泡并提示（fail-close）
      if (!checkResult.pass) {
        this._dLog("审核不通过,撤回气泡", "warn");
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

      this._dLog("调用 loadSessionContext", "step");
      const recent = await this.loadSessionContext();
      this._dLog("loadSessionContext 返回 recent=" + (recent === null ? "null(满上限)" : Array.isArray(recent) ? recent.length + "条" : "其他"), "info");
      if (recent === null) {
        this.setData({ streaming: false, waitingFirstChunk: false });
        this._dLog("recent=null,已满上限,退出", "warn");
        return; // 已满上限
      }

      // 用户消息落库与流式生成并行（落库不阻塞首字渲染）
      this._dLog("调用 persistMessage(user)", "step");
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
      this._dLog("组装 apiMessages 完成,共 " + apiMessages.length + " 条,准备 runStream", "step");

      await this.runStream(apiMessages, msgIndex, newRound);
    } catch (e) {
      this._dLog("sendMessage 异常: " + ((e && e.message) || e) + " code=" + (e && e.code), "error");
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
    self._dLog("runStream 入口 newRound=" + newRound + " chat=" + (chat ? "Y" : "N"), "step");

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

    self._dLog("调用 streamText", "step");
    await streamText({
      model: config.model.chat,
      messages: apiMessages,
      mode: "L1",
      onChunk(delta) {
        streamingContent += delta;
        flushSafe();
        if (self.data.waitingFirstChunk) {
          self._dLog("首帧到达 len=" + streamingContent.length, "info");
          self.setData({ waitingFirstChunk: false });
        }
      },
      // 重试时 ai-stream 会从头重发内容：先清空气泡旧文本，避免新旧拼接
      onChunkReset() {
        self._dLog("onChunkReset: 重试,清空气泡", "warn");
        streamingContent = "";
        renderedLen = 0;
        const resetMessages = [...self.data.messages];
        resetMessages[msgIndex] = displayMsg("socrates", "");
        self.setData({ messages: resetMessages });
        if (chat) chat.buildRenderMessages(resetMessages);
      },
      onStreamEnd: async ({ fullText, finishReason }) => {
        self._dLog("onStreamEnd: finishReason=" + finishReason + " textLen=" + (fullText || "").length, "step");
        // AI 收尾判定：剥离 [[END]] 标记并置建议态——多重判定之一，
        // 属软信号：只提示"可结束"，不锁定输入，用户仍可继续追问
        let aiSuggested = false;
        const safe = finishReason === "sensitive";
        let finalText = safe ? SENSITIVE_FALLBACK : fullText;

        if (!safe && END_MARK_RE.test(finalText)) {
          aiSuggested = true;
          finalText = stripEndMark(finalText);
          self._dLog("检出 [[END]] 收尾标记", "info");
        }

        // P1 修复（输出二次审核）：finish_reason 非 sensitive 时也再做一次 msgSecCheck
        // 修复（2026-08-25）：跳过 eventStream 后 finish_reason 已失效（仅启发式兜底），
        // msgSecCheck 成为最后一道真防线——degraded（审核服务异常）时也必须 fail-close，
        // 否则违规内容会在审核故障窗口期内无任何阻挡漏给用户。
        // 代价：审核服务偶发抖动时用户看到兜底文案而非真回复——合规优先。
        if (!safe && finalText) {
          try {
            self._dLog("调用输出二次审核 msgSecCheck", "step");
            const outCheck = await msgSecCheck(finalText, 2);
            self._dLog("二次审核结果 pass=" + outCheck.pass + " degraded=" + outCheck.degraded, "info");
            if (!outCheck.pass) {
              self._dLog("二次审核不通过,替换为兜底文案", "warn");
              finalText = SENSITIVE_FALLBACK;
            }
          } catch (e) {
            // 异常（含网络层失败）：同样 fail-close，避免任何意外漏过
            self._dLog("二次审核异常 fail-close: " + ((e && e.message) || e), "error");
            finalText = SENSITIVE_FALLBACK;
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
        self._dLog("UI 更新完毕 streaming=false round=" + newRound, "info");

        // 苏格拉底回复落库（API 角色 assistant；sessionStore append 只接受 user|assistant）；
        // 落库剥离标记后的干净文本，避免报告/下一轮上下文被标记污染
        self._dLog("调用 persistMessage(assistant)", "step");
        await self.persistMessage("assistant", finalText, newRound);

        if (newRound >= config.maxRounds) {
          self._dLog("达到 maxRounds 上限,置 roundLimitReached", "warn");
          self.setData({ roundLimitReached: true });
          self.promptReport();
        } else {
          self._dLog("本轮回合结束,等待下一轮", "info");
        }
      },
      onError(err) {
        self._dLog("onError: " + ((err && err.msg) || (err && err.message) || err), "error");
        const errorMessages = [...self.data.messages];
        errorMessages[msgIndex] = displayMsg("socrates", "抱歉，出了点问题。请稍后重试。");
        self.setData({
          messages: errorMessages,
          streaming: false,
          waitingFirstChunk: false,
        });
        // 明确的失败反馈：避免用户只看到气泡文案变化而误以为"点击无反应"
        wx.showToast({ title: "AI 服务无响应，请稍后重试", icon: "none", duration: 2500 });
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

  /** 思辨结束：引导进入报告页（三重判定共用出口） */
  promptReport() {
    // 不入库降级模式（测试旁路下 create 被旧版云函数拒绝）：无会话可生成报告
    if (!this.sessionId) {
      wx.showModal({
        title: "无法生成报告",
        content: "本次对话未在云端保存（测试降级模式），请先部署新版 sessionStore 云函数后再试。",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }
    wx.showModal({
      title: "思辨完成",
      content: "去看看你的思辨报告吧。",
      confirmText: "查看报告",
      cancelText: "再看看",
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: `/pages/report/index?sessionId=${this.sessionId}`,
          });
        }
      },
    });
  },
});
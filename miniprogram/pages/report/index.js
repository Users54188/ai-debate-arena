/**
 * report 页 — L1 思辨报告（W3）
 *
 * 流程：onLoad 取 sessionId → 调 generateReport（幂等，重复进入不重复生成）
 *       → 归属校验通过后拉取 transcript（sessionStore.get withTranscript）
 *       → 渲染评分环/策略条/谬误列表/逻辑链/报告正文/对话回溯
 *
 * 分享（P1 修复）：分享链接只带 shareToken（由 generateReport 返回），不再携带
 *       sessionId。好友经分享进入时按 token 只读拉取已生成报告（不触发生成、
 *       拿不到 transcript），transcript 回溯区显示"分享视图不展示对话原文"。
 *
 * 降级与容错：
 * - generateReport code:-1 → 显示错误态 + 重试按钮，不白屏
 * - 报告 degraded=true → 轻提示"本次分析部分降级"
 * - sessionId 为空 → 显示"会话不存在"
 *
 * 分享：onShareAppMessage 标题带动态分数；海报按钮占位（W6 实现）
 */

const config = require("../../config");

const STRATEGIES = [
  { key: "预设", label: "预设前提" },
  { key: "证据", label: "证据追问" },
  { key: "边界", label: "边界探索" },
  { key: "后果", label: "后果追问" },
  { key: "定义", label: "定义澄清" },
];

Page({
  data: {
    sessionId: "",
    shareToken: "",
    isShareView: false,
    isL2: false,
    loading: true,
    loadError: "",
    notFound: false,
    report: null,
    transcript: [],
    scrollTarget: "",
    highlightIndex: -1,
    strategyRows: [],
    fallacyItems: [],
    shareTitle: "",
    poster: { show: false, ready: false },
  },

  onLoad(options) {
    const sessionId = (options && options.sessionId) || "";
    const shareToken = (options && options.token) || "";
    this.setData({ sessionId, shareToken, isShareView: !!shareToken });
    if (!sessionId && !shareToken) {
      this.setData({ loading: false, notFound: true, loadError: "会话不存在" });
      return;
    }
    this.loadReport();
  },

  /** 拉取报告（幂等）+ 对话回溯原文 */
  async loadReport() {
    const { sessionId, shareToken, isShareView } = this.data;
    if (!sessionId && !shareToken) return;
    this.setData({ loading: true, loadError: "" });

    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.generateReport,
        data: isShareView ? { shareToken } : { sessionId },
      });
      const result = res.result || {};
      if (result.code !== 0) {
        // 云函数业务失败 → 显示错误 + 重试（不白屏）；归属校验失败（他人 sessionId）重试无益但无害
        this.setData({ loading: false, loadError: result.msg || "报告生成失败" });
        return;
      }

      const report = (result.data && result.data.report) || null;
      if (!report) {
        this.setData({ loading: false, loadError: "报告数据为空" });
        return;
      }

      // 归属已由 generateReport 校验；分享视图不拉取 transcript（token 只读，拿不到原文）
      let transcript = [];
      if (!isShareView) {
        this.setData({
          shareToken: (result.data && result.data.shareToken) || this.data.shareToken,
        });
        transcript = await this.fetchTranscript(sessionId);
      }
      const roundCount = transcript.reduce(
        (max, m) => Math.max(max, m.round || 0),
        0
      );

      this.setData({
        report,
        transcript,
        loading: false,
        isL2: (report.mode || "L1") === "L2",
        strategyRows: this.buildStrategyRows(report),
        fallacyItems: this.buildFallacyItems(report, transcript),
        shareTitle: this.buildShareTitle(report, roundCount),
      });

      // 渲染完成后绘制评分环；L2 额外绘制双维度雷达图
      this.nextTick(() => {
        this.drawScoreRing(report.score || 0);
        if ((report.mode || "L1") === "L2") {
          this.drawRadarChart(report);
        }
      });
    } catch (e) {
      console.error("[report] load failed:", e);
      this.setData({ loading: false, loadError: "网络异常，请稍后重试" });
    }
  },

  /** 获取对话回溯原文（sessionStore.get withTranscript） */
  async fetchTranscript(sessionId) {
    try {
      const res = await wx.cloud.callFunction({
        name: config.cloudFunctions.sessionStore,
        data: { action: "get", sessionId, withTranscript: true },
      });
      const session = (res.result && res.result.data && res.result.data.session) || {};
      return Array.isArray(session.transcript) ? session.transcript : [];
    } catch (e) {
      console.error("[report] fetch transcript failed:", e);
      return [];
    }
  },

  /** 深度分 → 5 条策略条形图数据 */
  buildStrategyRows(report) {
    const tags = Array.isArray(report.strategyTags) ? report.strategyTags : [];
    const covered = new Set(tags.map((t) => t && t.type));
    return STRATEGIES.map((s) => ({
      ...s,
      covered: covered.has(s.key),
      pct: covered.has(s.key) ? 100 : 0,
    }));
  },

  /** 谬误列表（附加可定位到对话回溯的索引） */
  buildFallacyItems(report, transcript) {
    const fallacies = Array.isArray(report.fallacies) ? report.fallacies : [];
    return fallacies.map((f) => {
      // 找到对应轮次的用户原话索引（用于点击定位）
      const round = f.round || 0;
      const idx = transcript.findIndex(
        (m) => m.role === "user" && m.round === round
      );
      return { ...f, transcriptIndex: idx >= 0 ? idx : -1 };
    });
  },

  buildShareTitle(report, roundCount) {
    const score = (report && report.score) || 0;
    const rounds = roundCount || 10;
    const mode = (report && report.mode) || "L1";
    return mode === "L2"
      ? `共修 ${rounds} 轮，综合思辨 ${score} 分`
      : `我和苏格拉底辩了 ${rounds} 轮，拿到 ${score} 分`;
  },

  /** 评分环（Canvas 2D 自绘：底环 + 进度弧 + 分数文字） */
  drawScoreRing(score) {
    const query = wx.createSelectorQuery();
    query
      .select("#scoreRing")
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext("2d");
        const dpr = wx.getWindowInfo().pixelRatio;
        const width = res[0].width;
        const height = res[0].height;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) / 2 - 8;
        const lineWidth = 10;
        const start = -Math.PI / 2;
        const ratio = Math.max(0, Math.min(1, (score || 0) / 100));
        const end = start + ratio * Math.PI * 2;

        // 底环
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "#E5E7EB";
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        // 进度弧
        if (ratio > 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius, start, end);
          ctx.strokeStyle = "#4F46E5";
          ctx.lineWidth = lineWidth;
          ctx.lineCap = "round";
          ctx.stroke();
        }

        // 分数
        ctx.fillStyle = "#1F2937";
        ctx.font = "bold 28px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(Math.round(score || 0)), cx, cy);
      });
  },

  /** L2 双维度雷达图（Canvas 2D：知识掌握分 vs 思辨深度分） */
  drawRadarChart(report) {
    const query = wx.createSelectorQuery();
    query
      .select("#radarChart")
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext("2d");
        const dpr = wx.getWindowInfo().pixelRatio;
        const width = res[0].width;
        const height = res[0].height;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) / 2 - 16;
        const knowledge = Math.max(0, Math.min(100, report.knowledgeScore || 0));
        const thinkDepth = Math.max(0, Math.min(100, report['思辨深度分'] || report.score || 0));
        const a = Math.PI / 4; // 45°

        // 两轴终点（知识掌握 45°右上，思辨深度 45°右下）
        const kx = cx + radius * Math.cos(a);
        const ky = cy - radius * Math.sin(a);
        const tx = cx + radius * Math.cos(-a);
        const ty = cy - radius * Math.sin(-a);

        // 底图：半透明圆环
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "#E5E7EB";
        ctx.lineWidth = 1;
        ctx.stroke();

        // 轴线和标签
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#6B7280";
        for (const pt of [{ x: kx, y: ky, label: "知识掌握" }, { x: tx, y: ty, label: "思辨深度" }]) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(pt.x, pt.y);
          ctx.strokeStyle = "#D1D5DB";
          ctx.lineWidth = 1;
          ctx.stroke();
          // 标签在终点外
          const lx = pt.x + (pt.x - cx) / radius * 20;
          const ly = pt.y + (pt.y - cy) / radius * 20;
          ctx.fillText(pt.label, lx, ly + 4);
        }

        // 数据点
        const kRad = radius * (knowledge / 100);
        const tRad = radius * (thinkDepth / 100);
        const dkx = cx + kRad * Math.cos(a);
        const dky = cy - kRad * Math.sin(a);
        const dtx = cx + tRad * Math.cos(-a);
        const dty = cy - tRad * Math.sin(-a);

        // 半透明填充区域（从中心到两个数据点的弧面）
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(dkx, dky);
        ctx.arc(cx, cy, Math.max(kRad, tRad), -a, a);
        ctx.lineTo(dtx, dty);
        ctx.closePath();
        ctx.fillStyle = "rgba(79, 70, 229, 0.12)";
        ctx.fill();

        // 数据点标记
        const dots = [
          { x: dkx, y: dky, color: "#0EA5E9" },
          { x: dtx, y: dty, color: "#8B5CF6" },
        ];
        for (const d of dots) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = d.color;
          ctx.fill();
        }
      });
  },

  /** 点击谬误条目 → 对话回溯区滚动定位并高亮原话 */
  onFallacyTap(e) {
    const idx = e.currentTarget.dataset.index;
    const item = this.data.fallacyItems[idx];
    if (!item || item.transcriptIndex < 0) return;

    this.setData({
      scrollTarget: `msg-${item.transcriptIndex}`,
      highlightIndex: item.transcriptIndex,
    });
    // 1.6s 后清除高亮（避免遮挡后续阅读）
    setTimeout(() => {
      if (this.data.highlightIndex === item.transcriptIndex) {
        this.setData({ highlightIndex: -1 });
      }
    }, 1600);
  },

  /** 重试 */
  onRetry() {
    this.setData({ loadError: "" });
    this.loadReport();
  },

  /** empty-state CTA 统一入口：notFound 走回首页，其余重试 */
  onStateCta() {
    if (this.data.notFound) {
      wx.switchTab({ url: "/pages/index/index" });
    } else {
      this.onRetry();
    }
  },

  /** 生成分享海报（Canvas 2d：背景图 + 分数 + 模式 + 报告摘要） */
  async onPoster() {
    const report = this.data.report;
    if (!report) return;
    this.setData({ poster: { show: true, ready: false } });
    this.nextTick(async () => {
      try {
        const query = wx.createSelectorQuery();
        const node = await new Promise((resolve, reject) => {
          query
            .select("#posterCanvas")
            .fields({ node: true, size: true })
            .exec((res) => {
              if (res && res[0] && res[0].node) resolve(res[0]);
              else reject(new Error("poster canvas not found"));
            });
        });
        const canvas = node.node;
        const ctx = canvas.getContext("2d");
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        canvas.width = node.width * dpr;
        canvas.height = node.height * dpr;
        ctx.scale(dpr, dpr);
        const W = node.width;
        const H = node.height;

        // 背景（美工 poster-bg.jpeg；加载失败退化为渐变）
        const bg = await this.loadImage("/images/poster-bg.jpeg");
        ctx.drawImage(bg, 0, 0, W, H);

        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.fillRect(0, H * 0.30, W, H * 0.70);

        ctx.textAlign = "center";
        ctx.fillStyle = "#4F46E5";
        ctx.font = "bold 34px sans-serif";
        ctx.fillText("AI 思辨场", W / 2, H * 0.36);
        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#6B7280";
        ctx.fillText((this.data.isL2 ? "双人共修" : (report.mode === "L3" ? "辩论场" : "苏格拉底追问")) + " · 思辨报告", W / 2, H * 0.36 + 30);

        ctx.fillStyle = "#111827";
        ctx.font = "bold 56px sans-serif";
        ctx.fillText(String(report.score || 0), W / 2, H * 0.50);
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#9CA3AF";
        ctx.fillText("思辨得分", W / 2, H * 0.50 + 26);

        const text = report.reportText || "";
        ctx.font = "15px sans-serif";
        ctx.fillStyle = "#374151";
        const maxWidth = W - 48;
        const lines = this.wrapText(ctx, text, maxWidth, 5);
        let y = H * 0.58;
        for (const line of lines) {
          ctx.fillText(line, W / 2, y);
          y += 22;
        }

        ctx.fillStyle = "#9CA3AF";
        ctx.font = "12px sans-serif";
        ctx.fillText("长按识别或打开小程序查看完整报告", W / 2, H * 0.92);

        this.posterCanvas = canvas;
        this.setData({ "poster.ready": true });
      } catch (e) {
        console.error("[report] poster draw failed:", e);
        this.setData({ poster: { show: false, ready: false } });
        wx.showToast({ title: "海报生成失败", icon: "none" });
      }
    });
  },

  /** 加载本地图片（返回 canvas 可绘制的对象） */
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = wx.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = src;
    });
  },

  /** 文本换行（单行超宽截断） */
  wrapText(ctx, text, maxWidth, maxLines) {
    const chars = String(text || "").split("");
    const lines = [];
    let cur = "";
    for (const c of chars) {
      if (ctx.measureText(cur + c).width > maxWidth) {
        lines.push(cur);
        cur = c;
        if (lines.length >= maxLines - 1) break;
      } else {
        cur += c;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, maxLines);
  },

  onPosterClose() {
    this.setData({ "poster.show": false });
  },

  noop() {},

  /** 保存海报到相册（授权失败引导设置） */
  onPosterSave() {
    const canvas = this.posterCanvas;
    if (!canvas) {
      wx.showToast({ title: "海报未就绪", icon: "none" });
      return;
    }
    wx.canvasToTempFilePath({
      canvas,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
          fail: (err) => {
            if (err && err.errMsg && err.errMsg.includes("auth")) {
              wx.showModal({
                title: "需要相册权限",
                content: "请在设置中开启保存到相册权限",
                confirmText: "去设置",
                success: (r) => {
                  if (r.confirm) wx.openSetting();
                },
              });
            } else {
              wx.showToast({ title: "保存失败", icon: "none" });
            }
          },
        });
      },
      fail: () => wx.showToast({ title: "导出失败", icon: "none" }),
    });
  },

  /** 分享（P1 修复：只带 shareToken，不携带 sessionId；无 token 时兜底不补 sessionId） */
  onShareAppMessage() {
    const { shareToken } = this.data;
    return {
      title: this.data.shareTitle || "我的思辨报告",
      // 分享链接只读（token 路径不触发生成、无 transcript）；token 不存在时引导进入首页
      path: shareToken
        ? `/pages/report/index?token=${shareToken}`
        : "/pages/index/index",
    };
  },

  nextTick(fn) {
    setTimeout(fn, 50);
  },
});

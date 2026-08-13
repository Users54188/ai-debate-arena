/**
 * profile 页 — 我的（W6）
 *
 * 流程：onShow 聚合本人 reports 表 → 展示统计：完成场次/累计得分/段位
 *       段位按最高报告分计算（青铜→白银→黄金→…），纯前端计算
 *
 * 合规：页面常驻 "AI 生成内容仅供参考" 说明（生成式 AI 服务备案提示）
 */

Page({
  data: {
    stats: {
      count: 0,
      totalScore: 0,
      bestScore: 0,
      avgScore: 0,
      bestMode: "L1",
    },
    rank: {
      name: "青铜 I",
      next: "白银 III",
      progress: 0,
    },
    loading: true,
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const res = await db
        .collection("reports")
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();
      const reports = res.data || [];
      let total = 0;
      let best = 0;
      let bestMode = "L1";
      for (const r of reports) {
        const score = r.score || 0;
        total += score;
        if (score > best) {
          best = score;
          bestMode = r.mode || "L1";
        }
      }
      const count = reports.length;
      const avg = count > 0 ? Math.round(total / count) : 0;
      this.setData({
        stats: { count, totalScore: total, bestScore: best, avgScore: avg, bestMode },
        rank: this.calcRank(best),
        loading: false,
      });
    } catch (e) {
      console.error("[profile] load failed:", e);
      this.setData({ loading: false });
    }
  },

  /** 段位：按最佳分数映射（纯计算，无网络调用） */
  calcRank(best) {
    if (best >= 90) return { name: "王者", next: "已是最高段位", progress: 100 };
    if (best >= 75) return { name: "黄金 I", next: "王者", progress: Math.round(((best - 75) / 15) * 100) };
    if (best >= 60) return { name: "白银 III", next: "黄金 I", progress: Math.round(((best - 60) / 15) * 100) };
    if (best >= 45) return { name: "白银 II", next: "白银 III", progress: Math.round(((best - 45) / 15) * 100) };
    if (best >= 30) return { name: "白银 I", next: "白银 II", progress: Math.round(((best - 30) / 15) * 100) };
    return { name: "青铜 I", next: "白银 I", progress: best > 0 ? Math.round((best / 30) * 100) : 0 };
  },

  goHistory() {
    wx.switchTab({ url: "/pages/history/index" });
  },

  goRanking() {
    wx.navigateTo({ url: "/pages/ranking/index" });
  },

  showAbout() {
    wx.showModal({
      title: "关于思辨场",
      content: "AI 思辨场是一款即时推理式对话应用。所有 AI 生成内容仅供参考，请理性看待。",
      showCancel: false,
    });
  },
});
/**
 * ranking 页 — 段位排行（W6）
 *
 * 单用户小程序：排行数据来自本人 reports 表（最佳得分排名）。
 * 展示：我的段位 + 各模式最佳得分对比（L1/L2/L3 纵向成长曲线）。
 *
 * 数据来源：前端直查本人 reports 表聚合。
 */

const MODE_LABEL = { L1: "苏格拉底追问", L2: "双人共修", L3: "辩论场" };

Page({
  data: {
    loading: true,
    empty: false,
    rank: { name: "青铜 I", next: "白银 I", progress: 0 },
    rows: [],
  },

  onShow() {
    this.loadRanking();
  },

  async loadRanking() {
    this.setData({ loading: true, empty: false });
    try {
      const db = wx.cloud.database();
      const res = await db
        .collection("reports")
        .orderBy("score", "desc")
        .limit(50)
        .get();
      const reports = res.data || [];

      // 按模式取最佳
      const bestByMode = {};
      for (const r of reports) {
        const m = r.mode || "L1";
        const s = r.score || 0;
        if (!bestByMode[m] || s > bestByMode[m].score) {
          bestByMode[m] = { mode: m, score: s, time: r.createdAt || "" };
        }
      }
      const bestOverall = reports.length ? reports.reduce((mx, r) => Math.max(mx, r.score || 0), 0) : 0;

      const rows = ["L1", "L2", "L3"]
        .filter((m) => bestByMode[m])
        .map((m) => {
          const b = bestByMode[m];
          return {
            mode: m,
            modeLabel: MODE_LABEL[m] || m,
            score: b.score,
            time: this.formatTime(b.time),
          };
        });

      this.setData({
        loading: false,
        empty: rows.length === 0,
        rows,
        rank: this.calcRank(bestOverall),
      });
    } catch (e) {
      console.error("[ranking] load failed:", e);
      this.setData({ loading: false, empty: true });
    }
  },

  calcRank(best) {
    if (best >= 90) return { name: "王者", next: "已是最高段位", progress: 100 };
    if (best >= 75) return { name: "黄金 I", next: "王者", progress: Math.round(((best - 75) / 15) * 100) };
    if (best >= 60) return { name: "白银 III", next: "黄金 I", progress: Math.round(((best - 60) / 15) * 100) };
    if (best >= 45) return { name: "白银 II", next: "白银 III", progress: Math.round(((best - 45) / 15) * 100) };
    if (best >= 30) return { name: "白银 I", next: "白银 II", progress: Math.round(((best - 30) / 15) * 100) };
    return { name: "青铜 I", next: "白银 I", progress: best > 0 ? Math.round((best / 30) * 100) : 0 };
  },

  formatTime(d) {
    if (!d) return "";
    const t = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  },
});
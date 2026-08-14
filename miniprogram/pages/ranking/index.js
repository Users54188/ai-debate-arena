/**
 * ranking 页 — 段位排行（W6 + W7 接入 userProfile.classify）
 *
 * 单用户小程序展示两个视图：
 *   1. 我的段位（服务端按累计轮次映射，与 profile 同源）
 *   2. 各模式最佳成绩（本地 reports 表聚合）
 *
 * 注：跨用户排行需要 sessions/reports 表的全局读权限，单用户小程序通常不具备，
 *     故本页保留"个人最佳榜"为 MVP；跨用户排行作为产品演进项（需后端聚合云函数）。
 */

const config = require("../../config");

const MODE_LABEL = { L1: "苏格拉底追问", L2: "双人共修", L3: "辩论场" };

Page({
  data: {
    loading: true,
    empty: false,
    rank: { name: "新手", next: "完成更多思辨提升段位", progress: 0 },
    rows: [],
  },

  onShow() {
    this.loadRanking();
  },

  async loadRanking() {
    this.setData({ loading: true, empty: false });
    try {
      // 1. 我的段位（服务端真实映射）
      const profileRes = await wx.cloud.callFunction({
        name: config.cloudFunctions.userProfile,
        data: { action: "get" },
      });
      const profile = (profileRes.result && profileRes.result.data) || {};
      const classify = profile.classify || "new";
      const rank = {
        name: profile.rank || "新手",
        next: this.nextRankLabel(classify),
        progress: this.classifyProgress(profile.totalRounds || 0, classify),
      };

      // 2. 各模式最佳（本人 reports 聚合）
      const db = wx.cloud.database();
      const res = await db
        .collection("reports")
        .orderBy("score", "desc")
        .limit(50)
        .get();
      const reports = res.data || [];
      const bestByMode = {};
      for (const r of reports) {
        const m = r.mode || "L1";
        const s = r.score || 0;
        if (!bestByMode[m] || s > bestByMode[m].score) {
          bestByMode[m] = { mode: m, score: s, time: r.createdAt || "" };
        }
      }
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
        rank,
      });
    } catch (e) {
      console.error("[ranking] load failed:", e);
      this.setData({ loading: false, empty: true });
    }
  },

  /** 段位晋级提示文案（与 userProfile.TIERS 同源） */
  nextRankLabel(classify) {
    const order = ["new", "bronze", "silver", "gold", "platinum", "diamond", "king"];
    const labelMap = {
      new: "青铜", bronze: "白银", silver: "黄金", gold: "铂金",
      platinum: "钻石", diamond: "王者", king: "已是最高段位",
    };
    const idx = order.indexOf(classify);
    if (idx < 0 || idx >= order.length - 1) return labelMap.king;
    return `距离 ${labelMap[order[idx + 1]]}`;
  },

  /** 当前段位进度（按下一档所需轮次估算，与 userProfile.computeClassify 反向） */
  classifyProgress(totalRounds, classify) {
    const threshold = { new: 0, bronze: 10, silver: 30, gold: 50, platinum: 80, diamond: 120, king: 200 };
    const order = ["new", "bronze", "silver", "gold", "platinum", "diamond", "king"];
    const idx = order.indexOf(classify);
    if (idx < 0 || idx >= order.length - 1) return 100;
    const cur = threshold[classify] || 0;
    const next = threshold[order[idx + 1]] || cur;
    if (next <= cur) return 100;
    return Math.max(0, Math.min(100, Math.round(((totalRounds - cur) / (next - cur)) * 100)));
  },

  formatTime(d) {
    if (!d) return "";
    const t = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  },

  goHome() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});
/**
 * rankBadge —— 段位 → 徽章图片映射（首页/我的/排行榜共用）
 *
 * 现有独立素材：青铜 / 白银 / 黄金；更高段位（铂金/钻石/王者）暂无独立图，
 * 暂复用黄金徽章；新手（new）不显示徽章（返回空串，由 wxml wx:if 控制）。
 */

const RANK_BADGE = {
  bronze: "/images/rank-bronze.png",
  silver: "/images/rank-silver.png",
  gold: "/images/rank-gold.png",
  platinum: "/images/rank-gold.png",
  diamond: "/images/rank-gold.png",
  king: "/images/rank-gold.png",
};

function rankBadge(classify) {
  return RANK_BADGE[classify] || "";
}

module.exports = { rankBadge, RANK_BADGE };

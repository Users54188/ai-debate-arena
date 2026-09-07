/**
 * pageMotion —— tabBar 页面方向感知进入动画
 *
 * 背景：wx.switchTab 是系统级瞬时切换，没有可配置的转场动画，tab 页又常驻不销毁，
 * 普通 CSS 动画只在首次渲染播一次。这里在每个 tab 页的 onShow 调用 playTabEnter：
 *   1) 依据 globalData.lastTabIndex 与当前 tab 的左右关系算出方向（next/prev/idle）；
 *   2) 先把动画类清空、下一帧再挂回，强制 CSS 动画在每次切回时重新播放。
 *
 * 仅操作 transform/opacity（见 app.wxss .tab-enter--*），走 GPU 合成，不触发重排。
 */

// tab 顺序必须与 app.json tabBar.list 一致，用于判断左右方向
const TAB_PATHS = [
  "/pages/index/index",
  "/pages/history/index",
  "/pages/profile/index",
];

/**
 * 在 tab 页 onShow 中调用。
 * @param {Object} page 当前 Page 实例（传 this）
 * @param {String} path 当前 tab 的绝对路径
 * @param {String} [field] 绑定到 data 的字段名，默认 "tabAnim"
 */
function playTabEnter(page, path, field) {
  const key = field || "tabAnim";
  if (!page || !page.setData) return;

  const app = getApp();
  const globalData = (app && app.globalData) || {};
  const cur = TAB_PATHS.indexOf(path);

  let dir = "idle"; // 首次进入 / 从二级页返回同 tab：柔和淡入上移
  if (typeof globalData.lastTabIndex === "number" && cur >= 0 && globalData.lastTabIndex !== cur) {
    // tab 序号变大 = 向右切，新页从右侧滑入；变小则从左侧滑入
    dir = cur > globalData.lastTabIndex ? "next" : "prev";
  }
  if (app && app.globalData) app.globalData.lastTabIndex = cur;

  // 先切到隐藏重置态 → 下一帧再挂方向类，保证同名动画重新触发且不闪全亮帧
  page.setData({ [key]: "tab-enter tab-enter--reset" }, () => {
    const apply = () => page.setData({ [key]: `tab-enter tab-enter--${dir}` });
    if (wx.nextTick) {
      wx.nextTick(apply);
    } else {
      setTimeout(apply, 16);
    }
  });
}

module.exports = { playTabEnter, TAB_PATHS };

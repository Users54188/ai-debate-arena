/**
 * pageMotion —— tabBar 页面方向感知进入动画
 *
 * 背景：wx.switchTab 是系统级瞬时切换，没有可配置的转场动画，tab 页又常驻不销毁，
 * 普通 CSS 动画只在首次渲染播一次。这里在每个 tab 页的 onShow 调用 playTabEnter：
 *   1) 依据 globalData.lastTabIndex 与当前 tab 的左右关系算出方向（next/prev/idle）；
 *   2) 常驻页切回时先清空动画类、下一帧再挂回，强制 CSS 动画重新播放。
 *
 * 健壮性（防止"白屏/点了没反应"观感）：
 *   - 页面首次挂载不经过 opacity:0 的 reset 隐藏帧（首次创建本就最耗时，停在隐藏帧
 *     会被误认为 UI 丢失），直接挂方向类由首帧自然播放；
 *   - 任何情况下都有 200ms 兜底把页面落到可见终态，杜绝 nextTick 异常时卡在透明帧。
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

  const finalClass = `tab-enter tab-enter--${dir}`;
  const mountedFlag = `__mounted_${key}`;

  // 首次挂载：直接挂终态类，让首帧自然播放动画，绝不先隐藏（避免白屏感）
  if (!page[mountedFlag]) {
    page[mountedFlag] = true;
    page.setData({ [key]: finalClass });
    return;
  }

  // 常驻页切回：先切隐藏重置帧 → 下一帧挂方向类，强制同名动画重新触发且不闪全亮帧
  page.setData({ [key]: "tab-enter tab-enter--reset" });

  let done = false;
  const apply = () => {
    if (done) return;
    done = true;
    page.setData({ [key]: finalClass });
  };
  if (wx.nextTick) {
    wx.nextTick(apply);
  } else {
    setTimeout(apply, 16);
  }
  // 兜底：200ms 内必定落到可见终态，防止极端情况下卡在 opacity:0
  setTimeout(apply, 200);
}

module.exports = { playTabEnter, TAB_PATHS };

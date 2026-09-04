/**
 * star-field — 全局星空背景组件
 *
 * 纯 CSS 实现（性能友好，不消耗 setData）：
 * - 双层星点（远景慢闪 + 近景静止）
 * - 顶部紫色星云光晕
 * - 底部柔光地平线
 *
 * 使用：
 *   在页面根 view 内首位插入 <star-field />
 *   页面容器需 position: relative; overflow: hidden;
 *
 * 性能：仅渲染期一次性开销，运行时无任何 setData，零开销。
 */
Component({
  options: {
    addGlobalClass: true,
    multipleSlots: false,
  },
  data: {},
  lifetimes: {
    attached() {},
  },
  methods: {},
});

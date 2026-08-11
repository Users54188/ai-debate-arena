/**
 * logic-chain — 论证链条 Canvas 2D 组件（W3，禁止 D3/DOM 依赖）
 *
 * 布局：按 edges 拓扑深度分层（根节点 depth=0），层间水平均分，层内纵向均分；
 *       边用二次贝塞尔曲线，节点为圆角矩形 + label。
 * 交互：bindtouchstart 命中检测（触点 vs 节点包围盒，含 6px 容差），
 *       命中后高亮节点并加粗关联边。
 * 降级：chain 为 null 或节点数为 0 时组件自身渲染为空（不占位）。
 * 适配：Canvas 2D 需要 pixelRatio 缩放（wx.getSystemInfoSync().pixelRatio）。
 */

const PADDING_X = 24;
const PADDING_Y = 40;
const NODE_HEIGHT = 36;
const NODE_MIN_WIDTH = 72;
const NODE_FONT = "13px sans-serif";
const HIT_MARGIN = 6;

Component({
  properties: {
    chain: {
      type: Object,
      value: null,
      observer() {
        this.resetAndDraw();
      },
    },
  },

  data: {
    canvasHeight: 200,
    visible: false,
  },

  lifetimes: {
    ready() {
      this.resetAndDraw();
    },
  },

  methods: {
    /** 重新布局并绘制（外部传入 chain 或组件就绪时调用） */
    resetAndDraw() {
      const chain = this.data.chain;
      if (!chain || !Array.isArray(chain.nodes) || chain.nodes.length === 0) {
        this.setData({ visible: false });
        return;
      }
      this.highlightId = null;
      this.setData({ visible: true });
      this.nextTick(() => this.queryCanvasAndDraw());
    },

    nextTick(fn) {
      setTimeout(fn, 50);
    },

    queryCanvasAndDraw() {
      const query = this.createSelectorQuery();
      query
        .select("#lcCanvas")
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          this.canvas = res[0].node;
          this.ctx = this.canvas.getContext("2d");
          this.dpr = wx.getSystemInfoSync().pixelRatio || 1;
          this.canvasWidth = res[0].width || 300;
          this.layout();
          this.draw();
        });
    },

    /** 分层布局：depth[n] = 根到 n 的最长路径；层内按 id 稳定排序 */
    layout() {
      const chain = this.data.chain;
      const nodes = chain.nodes;
      const edges = chain.edges || [];
      const byId = {};
      nodes.forEach((n) => (byId[n.id] = n));

      // 入边表
      const incoming = {};
      nodes.forEach((n) => (incoming[n.id] = []));
      edges.forEach((e) => {
        if (incoming[e.to]) incoming[e.to].push(e.from);
      });

      // 拓扑计算最长深度
      const depth = {};
      const compute = (id, visited) => {
        if (depth[id] !== undefined) return depth[id];
        if (visited.has(id)) return 0; // 环防御
        visited.add(id);
        const ins = incoming[id];
        const d = ins.length === 0 ? 0 : Math.max(...ins.map((f) => compute(f, visited) + 1));
        visited.delete(id);
        depth[id] = d;
        return d;
      };
      nodes.forEach((n) => compute(n.id, new Set()));

      const maxDepth = Math.max(0, ...Object.values(depth));
      const layers = {};
      nodes.forEach((n) => {
        const d = depth[n.id];
        (layers[d] = layers[d] || []).push(n);
      });
      Object.keys(layers).forEach((k) => {
        layers[k].sort((a, b) => (a.id < b.id ? -1 : 1));
      });

      const layerCount = maxDepth + 1;
      const canvasH = Math.max(200, layerCount * 110 + PADDING_Y * 2);
      this.setData({ canvasHeight: canvasH });

      // 节点坐标（逻辑像素）
      this.pos = {};
      nodes.forEach((n) => {
        const d = depth[n.id];
        const layer = layers[d];
        const idx = layer.indexOf(n);
        const x =
          PADDING_X + (d / Math.max(1, maxDepth)) * (this.canvasWidth - PADDING_X * 2);
        const y =
          PADDING_Y +
          (layer.length === 1
            ? canvasH / 2 - PADDING_Y
            : (idx / (layer.length - 1)) * (canvasH - PADDING_Y * 2));
        this.pos[n.id] = { x, y, depth: d };
      });
    },

    /** 绘制边 + 节点 */
    draw() {
      const ctx = this.ctx;
      const chain = this.data.chain;
      if (!ctx || !chain) return;

      const W = this.canvasWidth;
      const H = this.data.canvasHeight;
      this.canvas.width = W * this.dpr;
      this.canvas.height = H * this.dpr;
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, W, H);

      const edges = chain.edges || [];
      const nodes = chain.nodes;

      // 记录节点包围盒（供命中检测）
      this.hitRects = {};

      // 先画边（在节点下层）
      edges.forEach((e) => {
        const from = this.pos[e.from];
        const to = this.pos[e.to];
        if (!from || !to) return;
        const highlight = this.highlightId && (e.from === this.highlightId || e.to === this.highlightId);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        const midY = (from.y + to.y) / 2;
        ctx.bezierCurveTo(from.x, midY, to.x, midY, to.x, to.y);
        ctx.strokeStyle = highlight ? "#4F46E5" : "#C7D2FE";
        ctx.lineWidth = highlight ? 3 : 1.5;
        ctx.stroke();
      });

      // 再画节点
      nodes.forEach((n) => {
        const p = this.pos[n.id];
        if (!p) return;
        const label = String(n.label || n.id || "").slice(0, 12);
        const isHighlight = this.highlightId === n.id;

        ctx.font = NODE_FONT;
        const textW = ctx.measureText(label).width;
        const boxW = Math.max(NODE_MIN_WIDTH, textW + 16);
        const boxX = p.x - boxW / 2;
        const boxY = p.y - NODE_HEIGHT / 2;

        this.hitRects[n.id] = {
          x: boxX - HIT_MARGIN,
          y: boxY - HIT_MARGIN,
          w: boxW + HIT_MARGIN * 2,
          h: NODE_HEIGHT + HIT_MARGIN * 2,
        };

        // 圆角矩形
        ctx.beginPath();
        const r = 8;
        ctx.moveTo(boxX + r, boxY);
        ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + NODE_HEIGHT, r);
        ctx.arcTo(boxX + boxW, boxY + NODE_HEIGHT, boxX, boxY + NODE_HEIGHT, r);
        ctx.arcTo(boxX, boxY + NODE_HEIGHT, boxX, boxY, r);
        ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
        ctx.closePath();

        ctx.fillStyle = isHighlight ? "#4F46E5" : "#EEF2FF";
        ctx.fill();
        ctx.strokeStyle = isHighlight ? "#4F46E5" : "#C7D2FE";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isHighlight ? "#FFFFFF" : "#4338CA";
        ctx.font = NODE_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, p.x, p.y);
      });
    },

    /** 触点命中检测（bindtouchstart） */
    onTouchStart(e) {
      if (!this.hitRects || !this.canvas) return;
      const touch = e.touches && e.touches[0];
      if (!touch) return;
      // canvas 逻辑坐标 = 物理坐标 / dpr
      const x = touch.x / this.dpr;
      const y = touch.y / this.dpr;

      let hitId = null;
      for (const id in this.hitRects) {
        const r = this.hitRects[id];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          hitId = id;
          break;
        }
      }
      this.highlightId = hitId;
      this.draw();
    },
  },
});

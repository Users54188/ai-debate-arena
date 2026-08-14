/**
 * onboarding 组件 — 首启三屏引导
 *
 * 使用：
 *   pages/index/index.json 加 "usingComponents": { "onboarding": "/components/onboarding/index" }
 *   wxml 末尾：<onboarding wx:if="{{showOnboarding}}" bind:done="onOnboardingDone" />
 *   父页 onOnboardingDone 调 getApp().markOnboarded() 并把 showOnboarding 设为 false
 *
 * 行为：三屏滑动 → "开始思辨"按钮 → 触发 done 事件
 * 数据持久化由父页负责（避免组件耦合 app.js）
 */

Component({
  data: {
    current: 0,
    slides: [
      {
        title: "不直接给答案，只追问",
        desc: "AI 用苏格拉底式反问，逼你拆解自己的观点。说出你的看法，让它来检验。",
        emoji: "🤔",
        bg: "#4F46E5",
      },
      {
        title: "三种深度，渐进训练",
        desc: "L1 单人思辨 / L2 双人共修 / L3 三方辩论围观。一层比一层更烧脑。",
        emoji: "🎯",
        bg: "#7C3AED",
      },
      {
        title: "AI 生成仅供参考",
        desc: "我们用 AI 制造认知冲突，但任何结论都需要你自己判断。",
        emoji: "⚠️",
        bg: "#0EA5E9",
      },
    ],
  },

  methods: {
    onSwiperChange(e) {
      this.setData({ current: e.detail.current });
    },

    onNext() {
      const { current, slides } = this.data;
      if (current < slides.length - 1) {
        this.setData({ current: current + 1 });
      } else {
        this.onDone();
      }
    },

    onSkip() {
      this.onDone();
    },

    onDone() {
      this.triggerEvent("done");
    },
  },
});

/**
 * onboarding 组件 — 首启三屏引导
 *
 * 使用：
 *   pages/index/index.json 加 "usingComponents": { "onboarding": "/components/onboarding/index" }
 *   wxml 末尾：<onboarding wx:if="{{showOnboarding}}" bind:done="onOnboardingDone" />
 *   父页 onOnboardingDone 调 getApp().markOnboarded() 并把 showOnboarding 设为 false
 *
 * 行为：三屏滑动 → 末屏须勾选"已成年 + 同意协议" → "开始思辨"按钮触发 done 事件
 * 数据持久化由父页负责（避免组件耦合 app.js）
 *
 * 合规（2026 微信小程序 AI 类硬性要求）：
 * - 首次使用前展示《用户协议》《隐私协议》入口（点击弹出条款 modal）
 * - 用户须明确同意协议 + 确认成年后方可进入功能
 */

Component({
  data: {
    current: 0,
    agreed: false,
    showTerms: false,
    termsContent: "",
    termsTitle: "",
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

    onDotTap(e) {
      const idx = e.currentTarget.dataset.idx;
      this.setData({ current: idx });
    },

    onNext() {
      const { current, slides } = this.data;
      if (current < slides.length - 1) {
        this.setData({ current: current + 1 });
      } else {
        // 末屏必须先勾选协议才能进入（合规硬性要求）
        if (!this.data.agreed) {
          wx.showToast({ title: "请先阅读并同意协议", icon: "none", duration: 2000 });
          return;
        }
        this.onDone();
      }
    },

    onAgreeChange(e) {
      this.setData({ agreed: e.detail && e.detail.value && e.detail.value.length > 0 });
    },

    onShowUserAgreement() {
      this.setData({
        showTerms: true,
        termsTitle: "用户协议",
        termsContent: [
          "欢迎使用 AI 思辨场。",
          "",
          "1. 服务性质：本小程序提供的所有 AI 生成内容（包括但不限于苏格拉底追问、专家讲解、正反方辩论、裁判点评、思辨报告）均由人工智能模型生成，仅供参考，不构成任何专业建议（包括但不限于医疗、法律、金融、心理咨询等）。",
          "",
          "2. 使用限制：用户不得利用本服务从事任何违反中华人民共和国法律法规的活动，不得输入或传播涉政、涉黄、涉暴、涉毒、谣言、个人隐私、版权侵犯等内容。系统对所有输入与 AI 输出进行内容安全审核，违规内容将被拦截。",
          "",
          "3. 未成年人保护：本服务不主动向未成年人推送。若您是未成年人，请在监护人陪同下使用，并由监护人协助完成本协议确认；监护人应承担相应的监督责任。",
          "",
          "4. 知识产权：用户在本小程序内生成的内容（思辨记录、报告等）归用户本人所有，但用户授予本小程序在本服务范围内存储、处理、生成报告的权利。小程序的代码、UI、商标等知识产权归开发者所有。",
          "",
          "5. 服务变更与终止：开发者有权根据运营需要变更、暂停或终止部分功能，并将通过小程序内公告形式提前告知。若用户违反本协议，开发者有权限制或终止对该用户的服务。",
          "",
          "6. 联系方式：对本协议有任何疑问，可通过小程序内「我的 - 关于与合规」反馈。",
        ].join("\n"),
      });
    },

    onShowPrivacy() {
      this.setData({
        showTerms: true,
        termsTitle: "隐私协议",
        termsContent: [
          "AI 思辨场 隐私协议",
          "",
          "生效日期：2026-08-17",
          "",
          "我们深知个人信息对你的重要性，将以最大诚意和审慎态度保护你的隐私。",
          "",
          "一、我们收集的信息",
          "1. 微信 openid：作为账号唯一标识，用于识别用户身份。不直接包含你的微信号、手机号或真实身份。",
          "2. 对话记录：你与 AI 的对话内容，用于会话恢复、生成思辨报告、滚动摘要。仅在你的账号下可见。",
          "3. 头像与昵称：仅在你主动通过「我的」页面设置时收集并保存。",
          "4. 设备与使用数据：基础库版本、操作时间戳等，用于服务稳定性和合规审计。",
          "",
          "二、信息使用范围",
          "上述信息仅用于本小程序内的功能（思辨对话、报告生成、配额管理、段位统计）。我们不会将你的信息出售或提供给任何第三方，但以下情形除外：",
          "1. 取得你的明确同意；",
          "2. 法律法规要求或行政、司法机关依法定程序要求；",
          "3. 为维护本服务的合法合规运营（如内容安全审核、配合监管检查）。",
          "",
          "三、信息存储与保护",
          "你的数据存储于腾讯云开发（CloudBase）服务器（境内）。我们采用云开发默认的安全机制（含字段级权限、归属校验、敏感数据隔离）。",
          "",
          "四、信息保留期限",
          "1. 对话记录与报告：保留至你主动删除或注销账号。",
          "2. 账号标识（openid）：在你不使用本服务期间，保留至微信平台主动注销或你主动联系我们删除。",
          "",
          "五、你的权利",
          "1. 查询：你可在「历史」「我的」页面查看自己的会话与档案。",
          "2. 更正：你可在「我的」页面修改头像与昵称。",
          "3. 删除：你可在「历史」页面长按删除会话；可在「我的 - 清空本地缓存」清理本地缓存；如需删除云端全部数据，请通过小程序内联系方式告知我们，我们将在 15 个工作日内处理。",
          "4. 撤回同意：你可停止使用本服务并要求删除数据。",
          "",
          "六、未成年人保护",
          "我们不在本服务中主动收集未成年人的个人信息。若你是未成年人，请在监护人陪同下使用并提前阅读本协议；监护人有权随时要求我们删除被监护人的相关信息。",
          "",
          "七、本协议的更新",
          "本协议可能根据法律法规或运营需要进行更新，更新后将在小程序内显著位置公告。继续使用即视为你同意更新后的协议。",
          "",
          "八、联系我们",
          "如对本协议有任何疑问或需行使上述权利，请通过小程序内「我的 - 关于与合规」联系我们。",
        ].join("\n"),
      });
    },

    onTermsClose() {
      this.setData({ showTerms: false });
    },

    noop() {},

    onSkip() {
      // 末屏跳过同样要求协议同意（合规硬性要求）
      if (this.data.current === this.data.slides.length - 1 && !this.data.agreed) {
        wx.showToast({ title: "请先阅读并同意协议", icon: "none", duration: 2000 });
        return;
      }
      this.onDone();
    },

    onDone() {
      this.triggerEvent("done");
    },
  },
});

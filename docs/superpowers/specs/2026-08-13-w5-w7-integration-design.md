# W5-W7 整合修复设计稿

> 日期:2026-08-13 | 分支:`feat/w5-w7-integration`(基于 `main`)
> 目标:整合 PR #8(L3 + 4-tab UI)与 PR #7(登录 + 分类 + 配额)精华,补齐 stub,完善小程序过审与体验所需功能。
> 测试期约束:`dailyQuota=999`、`maxRounds=999`、`ENFORCE_QUOTA=false`、`allowedOpenids=[]`(上线前还原)。

## 1. 决策落定

| 项 | 取舍 | 理由 |
|---|---|---|
| UI 架构 | 采纳 PR #8 的 4-tab(首页/思辨/历史/我的),页面留主包 | PR #8 已与 main 同步且实现完整;PR #7 的 2-tab + 分包方案改动过大且与 PR #8 互斥 |
| 命名 | `pages/profile`(PR #8) | 与 tabBar 一致 |
| 分支 | `feat/w5-w7-integration` ← `main` | 干净基底 |
| PR #7 摘取 | 仅云函数(`userProfile.classify`、`getQuota` 分档、`sessionStore.enforceQuotaBeforeCreate`)、`app.js` 静默建档、合规文档两份、chat-stream note 保留 | 丢弃其分包迁移、`pages/mine`、2-tab |
| 测试期 | 全部放开值保留 + TODO 标记 | 用户明确要求 |

## 2. 工作分解(6 阶段)

### A. 整合 cherry-pick(基础,无新代码)
- `git merge --no-ff origin/feature/ui-integration`(PR #8 已与 main 同步,冲突小)
- 从 PR #7 手工摘取以下文件的精华段,以 PR #8 方向为优先解决冲突:
  - `cloudfunctions/userProfile/index.js`:新增 `ensure` / `getProfile`(聚合 sessions 表)/ `updateProfile` / `classify` 计算
  - `cloudfunctions/getQuota/index.js`:`getClassify` + TIERS 分档(与 userProfile 同源)
  - `cloudfunctions/sessionStore/index.js`:新增 `enforceQuotaBeforeCreate`(目前 `ENFORCE_QUOTA=false`)、新增 `trackVote`(PR #8 已加,需协调)
  - `miniprogram/app.js`:`onLaunch` 加 `userProfile.ensure` 静默建档 + `globalData.openid`
  - `miniprogram/components/chat-stream/*`:加 `note` 字段保留(合规:不删模型 note)
  - `docs/compliance-checklist.md`、`docs/implementation-plan.md`:保留两份文档

### B. 填现有 stub(MVP 必需)

| Stub | 当前 | 目标 |
|---|---|---|
| `pages/ranking/index.js` | `Page({})` | 真实段位榜:调 `userProfile` 拿当前用户段位;调云函数 `getRanking`(新增)拉全站前 50 名 |
| `topics_v1` 辩题白名单 | 未集成 | 新增 `cloudfunctions/topics/index.js`(读 `topics_v1` 集合)+ L3 入口提供"选题"选项,从白名单取题(替代纯自由输入) |
| `pages/history` | PR #8 新加 | 补完:调云函数 `getMySessions`(新增)拉本人最近 20 场会话,按时间倒序,卡片入口跳对应报告 |
| `pages/profile` | PR #8 有雏形 | 对接 `userProfile.get`(classify/rank/totalRounds/dailyLimit),展示段位、配额、设置入口 |

### C. UX 完整性(微信审核刚需)

| 项 | 实现 |
|---|---|
| 隐私弹窗 | `wx.requirePrivacyAuthorize`(2024 起强制)或自建弹窗组件 + 设置页"隐私说明"入口已有 |
| 新用户引导 | `app.js` 首启标记 + 三屏 onboarding 组件 |
| 空状态 | 给 `history` / `ranking` / `report`(无数据时)加插画 + 文案 + CTA |
| 错误边界 | 各页 `catch` 后展示"网络异常 + 重试按钮"(report 页已做,其余页对齐) |
| loading 骨架 | `chat-stream` 加骨架样式;各列表页加 `loading` 态 |
| 设置页 | `pages/profile` 内嵌设置区:清缓存(已有) / 版本号 / 用户协议 / 隐私政策 / 关于 |
| 统一错误提示 | 新建 `utils/toast.js`:`showError(e)` 统一处理 `code:-2`(配额)、`code:-1`(通用错误)、网络异常 |

### D. 完整产品版增强

| 项 | 实现 |
|---|---|
| 战绩海报 | 补完 PR #8 的 `report/index.js` 海报 Canvas:L1/L2/L3 三档模板,含段位徽章 + 金句 + 分享按钮 |
| 群聊邀请 | `onShareAppMessage` 带 `sessionId`(本人)或 `shareToken`(好友);新增 L3 辩论结束后"邀请好友围观"路径 |
| 段位徽章动效 | `pages/profile` 段位升级时 CSS 动画 + `wx.vibrateShort` |
| 报告深度图表 | 扩展 PR #8 的 `report/index.js`:`logic-chain` Canvas 通用化,L3 三方雷达扩展 |
| 角色头像差异化 | `chat-stream` 组件支持 `affirmative`/`negative`/`judge` 三色头像与气泡(L3 辩论页用) |

### E. 验证(我能做的)
- `npm run lint`(check-syntax 全仓库语法)
- `npm run verify`(prompt 镜像一致性)
- 静态代码审查 + 跨文件引用核对

### F. 提交 / 推送
- 按阶段分提交,conventional commits 格式
- 推到 `feat/w5-w7-integration`
- 用 PAT 创建 PR,base = `main`

## 3. 我**不能**做的(用户须知)
- 真机/云函数运行时验证(无云开发环境)
- Prompt 回归评测(需云函数实跑)
- 微信审核(人工活)

## 4. 安全 / 合规底线
- 保持 PR #8 已达标的所有 P0/P1 安全实现:`sessionStore` IDOR 校验、`evalRunner` 白名单、prompt 注入隔离(XML 标签 + escapeXml)、原子追加、长度截断、shareToken。
- PR #7 的 `enforceQuotaBeforeCreate` 默认关闭(`ENFORCE_QUOTA=false`),开关留代码里。
- 合规文档两份(`compliance-checklist.md` / `implementation-plan.md`)从 PR #7 摘入。

## 5. 风险
1. **范围大**:工作量约 PR #8 + PR #7 之和的 1.5 倍。优先 A-C(过审必需),再 D(锦上添花)。
2. **冲突处理**:PR #8 与 PR #7 同时改 `app.js`、`sessionStore`、`generateReport`,逐一协调。
3. **不引入新依赖**:保持原生小程序 + `wx-server-sdk`。

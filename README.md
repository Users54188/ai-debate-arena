# 思辨场 / AI Debate Arena

> 2026微信小程序开发大赛参赛项目 | 主题：与AI共生  
> 赛道：教育学习 | 标签：多Agent架构 · 苏格拉底教学法 · 批判性思维训练

---

## 一句话简介

不做「给答案的AI老师」，做「逼你动脑的AI智囊团」。引入多Agent架构，从「人机对话」升级为「人机共思」，在思维碰撞中学习。

## 为什么做这个

所有AI学习产品都在做同一件事——更高效地灌输知识。但学习真正的瓶颈不是「信息不够」，而是「思考太浅」。

思辨场反其道而行：不给答案，只追问。用苏格拉底的方法逼你审视自己的逻辑，用多Agent辩论让你看到问题的多面性。

## 三层思辨场

| 层级 | 模式 | 说明 |
|------|------|------|
| L1 单人磨刀 | 苏格拉底追问 | 你提观点，AI层层反问，不给答案 |
| L2 双人共修 | 专家讲解 + 苏格拉底追问 | 一个AI讲原理，另一个AI立刻追问检验 |
| L3 三人围观 | AI辩论场 | 正方/反方/裁判三个AI辩论，你围观+投票 |

## 技术亮点

- **多Agent编排**：同一LLM切换system prompt，云函数串行编排对话流
- **端侧推理分流**：微信3.8.0端侧3亿参数模型处理70%逻辑分析，大幅降低Token消耗
- **全免费技术栈**：微信AI成长计划10亿Token + CloudBase云开发 + ChatUI Kit对话组件

## 开发计划

10周开发周期，详见 [docs/product-plan.md](docs/product-plan.md)

## 成本

全程使用微信免费额度，零自费。

---

## 工程质量证据（Engineering evidence）

这一节不描述愿景，只列可验证的事实，方便审阅者（和 Codex）判断这个仓库的维护状态。

### 维护节奏

| 指标 | 值 | 来源 |
|------|-----|------|
| 首次提交 | 2026-08-08（`W1: miniprogram/config.js`） | `git log --reverse` |
| 提交总数 | 106（截至最后一个合并 PR #19） | `git rev-list --count HEAD` |
| 活跃提交日 | 13 天，覆盖 08-08 → 08-30 的 10 周开发窗口 | `git log --date=short` |
| PR 数 | 20 个全部关闭，16 个已 merge | `GET /repos/Users54188/ai-debate-arena/pulls` |
| 贡献者 | 1（owner 单独维护） | `GET .../contributors` |
| 云函数 | 9 个（sessionStore / evalRunner / generateReport / securityCheck / topics / userProfile / getQuota / cleanupData / cleanupTestData） | `cloudfunctions/` |

### 自动化校验（零依赖，不需要 `npm install`）

```bash
npm run verify   # Prompt / 用例镜像一致性（10 项硬校验）
npm run lint     # 全仓库 32 个 JS 文件语法检查 + 上线护栏
```

- **`tools/verify-prompt-mirror.js`** —— 本项目最核心的一道防线。同一份 system prompt
  在三个地方存在：`miniprogram/utils/prompts.js`（前端预览）、`cloudfunctions/evalRunner`
  （实际调用）、`prompts/*.md`（人类阅读）。任何一处漂移都会导致"评测通过但线上行为不同"。
  脚本对 9 组 prompt（socrates + 4 个专家 + 3 个辩论角色）做逐字比对，对
  `cases.json` 做 sha256 比对，任一处不一致即 `exit(1)`。
- **`tools/check-syntax.js`** —— 语法检查之外，兼任**上线护栏**：检测四处
  `QUOTA_BYPASS` / `quotaBypass` 开关，CI 环境下若仍为 `true` 则阻断构建。
- **`.github/workflows/ci.yml`** —— 上述两个脚本的 CI 化，push / PR 自动触发。
- **`.github/workflows/quota-guard.yml`** —— PR 若触碰配额开关文件，描述里必须带
  `[release-profile]` 标记，否则阻断，防止漏改导致上线后配额失控。
- 细节与踩坑记录：[docs/ci-notes.md](docs/ci-notes.md)

### Prompt 评测基线

`prompts/evals/` + `cloudfunctions/evalRunner` 构成一个闭环评测器，不是"感觉效果不错"。

| 项 | 值 |
|---|---|
| 用例总数 | **81** 条（`cases.json`，version 1.0） |
| 覆盖类别 | 20 类：normal 8、pressure 5、off_topic 5、emotional 4、sensitive 4、19 条逻辑谬误（滑坡/稻草人/循环论证/草率概括共 16）、definition 3、confused 2、repeat 3，以及 L2/L3 层各 5/5/5/5/3/3/2/3 |
| 评分方式 | 被测 prompt 生成回复 → 独立裁判 prompt 打分（JSON 输出），结果落 `eval_runs` 表 |
| 一票否决项 | 4 条：泄露答案 / 讲解知识点 / 评价对错 / 使用感叹号 |
| 评分维度 | 命中真实假设 40 + 不复读 20 + 结构合规 25 + 语气克制 15 = 100 |
| 通过标准 | 无否决项 **且** 总分 ≥ 70 |
| 目标通过率 | ≥ 80%（`cases.json` 的 `targetPassRate: 0.8`），且不得低于上一版基线 |

评测设计见 [prompts/evals/rubric.md](prompts/evals/rubric.md)。

> 为什么这套东西值得看：**"不给答案只追问"是一个极易退化的 prompt 目标**。
> 模型天生想给答案，一句"你说得对"就会毁掉整个产品定位。所以这个项目把
> "什么叫合格的苏格拉底式追问"翻译成了可机读的 4 条否决项 + 4 个可打分维度 +
> 81 条带 `red_lines` 的用例，再加上镜像校验保证评测对象就是线上对象。
> 这是这个仓库里最接近"可复用的通用工程模式"的部分。

### 安全加固记录（2026-08-12 交叉评审后）

| 级别 | 问题 | 修复 |
|------|------|------|
| P0 | sessionStore get/append 无归属校验（IDOR） | 均校验 `openid`，他人 sessionId 一律拒绝 |
| P0 | evalRunner 无鉴权，任何人可触发 ~10万 Token 消耗 | openid 白名单（`config.json` 的 `allowedOpenids`，留空即禁用） |
| P0 | 用户输入可注入 system prompt | 全路径隔离：evalRunner（socrates/judge）与 generateReport（annotate/report）均以 `<user_data>`/`<transcript>` 等标签包裹不可信输入并加安全声明，且实际完成标签包裹（非仅声明） |
| P1 | append 读-算-写并发丢消息 | `_.push`/`_.max` 原子追加 + version 门控裁剪（重试 3 次） |
| P1 | 消息无长度上限、transcript 可无限膨胀 | 单条硬截断 2000 字符；transcript 超 8000 字符报警 |
| P1 | 分享链接携带 sessionId（可枚举触发报告） | 分享改带一次性 `shareToken`（只读、不触发生成、无 transcript） |
| P2 | prompts/evals 镜像漂移 | 校验通过：cases.json 哈希一致、PROMPT_SOCRATES 一致（现已 CI 化） |
| P2 | 废弃 API | `wx.getSystemInfoSync` → `wx.getWindowInfo`/`wx.getAppBaseInfo` |

上面三条 P0 里有两条（IDOR 归属校验、prompt 注入隔离）是**任何"云函数 + LLM + 用户会话"
的微信小程序都会踩的同一个坑**——`openid` 由运行时注入所以容易被当成天然的租户隔离，
实际只要忘校验就是全表可读；而 LLM 入参只要没做标签包裹，用户第一句话就能改写 system prompt。

## 可复用部分（计划中）

以下是从本项目提炼计划开源出去的模块，目前仍在项目内：

- **session 归属 + 并发安全模式**：`openid` 校验 + `_.push` 原子追加 + version 门控裁剪，
  规避 CloudBase 无事务时的读-算-写丢写。
- **prompt 注入隔离模式**：`<user_data>` / `<transcript>` 标签包裹 + 显式安全声明 +
  输出侧裁决，三段式，不依赖模型自觉。
- **prompt 漂移校验**：`tools/verify-prompt-mirror.js` 的通用形态（多份副本逐字比对 +
  sha256 + 软抽检）。

## 项目状态

- 参赛作品（2026 微信小程序开发大赛，教育学习赛道），开发窗口 2026-08-08 → 2026-08-30。
- 当前处于**测试期配置**：四处配额旁路开关为 `true`，CI 中只告警不阻断，见
  [docs/ci-notes.md](docs/ci-notes.md)。
- 后续维护以"提炼上述三个可复用模块"为主。

## 安全加固记录（2026-08-12 交叉评审后）

| 级别 | 问题 | 修复 |
|------|------|------|
| P0 | sessionStore get/append 无归属校验（IDOR） | 均校验 `openid`，他人 sessionId 一律拒绝 |
| P0 | evalRunner 无鉴权，任何人可触发 ~10万 Token 消耗 | openid 白名单（`config.json` 的 `allowedOpenids`，留空即禁用） |
| P0 | 用户输入可注入 system prompt | 全路径隔离：evalRunner（socrates/judge）与 generateReport（annotate/report）均以 `<user_data>`/`<transcript>` 等标签包裹不可信输入并加安全声明，且实际完成标签包裹（非仅声明） |
| P1 | append 读-算-写并发丢消息 | `_.push`/`_.max` 原子追加 + version 门控裁剪（重试 3 次） |
| P1 | 消息无长度上限、transcript 可无限膨胀 | 单条硬截断 2000 字符；transcript 超 8000 字符报警 |
| P1 | 分享链接携带 sessionId（可枚举触发报告） | 分享改带一次性 `shareToken`（只读、不触发生成、无 transcript） |
| P2 | prompts/evals 镜像漂移 | 校验通过：cases.json 哈希一致、PROMPT_SOCRATES 一致 |
| P2 | 废弃 API | `wx.getSystemInfoSync` → `wx.getWindowInfo`/`wx.getAppBaseInfo` |

## License

MIT

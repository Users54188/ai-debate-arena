# 实施计划：微信原生登录 + "我的"板块 + 用户精准分类（含 W7/W8 路线图）

> 本文档为 **规划稿**，供评审确认后再动手写代码。所有改动需基于 `feat/w4-l2-dual-agent` 之后的分支（建议新开 `feat/w7-login-mine`）。

---

## 0. 现状与风险点（已核对代码）

| 项 | 现状 | 结论 |
|----|------|------|
| OpenID 来源 | 云开发 `cloud.getWXContext().OPENID` 在 `getQuota/sessionStore/userProfile/generateReport` 均已注入 | 服务端天然有稳定 openid，**无需 wx.login 换 code** |
| 段位(rank) | `userProfile/index.js` 当前**返回 mock**（`rank:"青铜"`, 全 0） | 段位未真实化，需从 `users/sessions/token_usage` 聚合 |
| 配额校验 | `socrates/dual` 的 `checkQuota()` 被**测试 hack 提前 return**（上次 W4-D0 临时放开） | 真实逻辑在注释里，需还原 + 服务端强校验 |
| 配额计数 | `getQuota` 按 `openid+mode+当日 sessions` 计数 | **重启小程序不绕过**（服务端计数）；但"按场次计数"可能被"多次开新会话"拆场绕过轮次上限 |
| "我的"页 | 不存在 | 需新增页面 |
| tabBar | `app.json` **无 tabBar** | "我的"可作为 tabBar 页（须在主包） |
| 登录模块 | 无显式登录/授权流程 | 仅需在首次进入时静默建档（users 表） |

**核心认知**："重启小程序规避次数限制"在技术上的真实面——
- 若配额**纯客户端**判断 → 重启可清状态绕过 ✅（当前 hack 正是此问题，必须删）。
- 配额**服务端按 openid+日**判断 → 重启无法绕过（同一微信账号 openid 不变）。
- 真正可被钻的空子是**"按场次计数"被拆成多场**。计划通过"会话创建前强校验 + 按用户分类给总轮次上限"堵住。

---

## 1. 第一线功能：登录模块 + "我的"板块 + 用户精准分类

### 1.1 微信原生登录模块
- **结论**：云开发环境 openid 已稳定可用，**不需要** `wx.login` + code2session。
- 仅当需要**头像/昵称/手机号**才额外接入：
  - 头像昵称：`<button open-type="chooseAvatar">` + `<input type="nickname">`（微信现已废弃 `getUserProfile` 弹窗授权）。
  - 手机号：`<button open-type="getPhoneNumber">` → 云函数 `cloudID` 解密（需企业主体）。
- **落地动作**：
  - `app.js onLaunch`：调用 `userProfile.ensure` 静默建档（无头像则先用默认）。
  - 新增 `userProfile` action：`ensure`（ upsert `users` 文档：`openid, createdAt, classify, avatar, nickName`）、`updateProfile`（保存头像昵称）。
- 涉及文件：`miniprogram/app.js`、`cloudfunctions/userProfile/index.js`。

### 1.2 "我的"板块页面
- 新增 `miniprogram/pages/mine/index`（`.js/.wxml/.wxss/.json`）。
- 加入 `app.json`：作为 **tabBar 第二栏**（首页 + 我的），tabBar 页必须在主包。
- 展示内容：当前段位、总场次、总轮次、平均评分、胜率、设置入口（清空本地缓存/关于/反馈）。
- 数据来自 `userProfile.get`（需从 mock 改为真实聚合：`users` + `sessions` 计数 + `token_usage` 聚合）。
- 涉及文件：`miniprogram/pages/mine/*`、`miniprogram/app.json`（tabBar + pages）、`cloudfunctions/userProfile/index.js`（get 真实化）。

### 1.3 用户精准分类 + 防规避
- **分类维度**（写入 `users.classify`，服务端算、客户端只读）：
  - 段位档：青铜/白银/黄金/铂金/钻石/王者（由累计场次/胜率映射）。
  - 活跃度档：新用户/活跃/高活跃。
  - 内测白名单：来自 `evalRunner` 的 `allowedOpenids` 机制扩展。
- **配额分档（完全服务端决定）**：
  - `getQuota` 在返回 `limit` 前先查 `users.classify`，按档位给 `dailyQuota`（高段位/内测更多）。
  - 客户端**无法修改** limit（只展示），重启只是重新拉取 → 结果一致，无法规避。
- **会话创建前强校验（堵"拆场"空子）**：
  - `sessionStore.create` 内部先执行 getQuota 同款计数；若当日该 `openid+mode` 已达 `limit`（场次或总轮次），返回 `code≠0`，客户端拦截并提示"今日次数已用完"。
  - 轮次上限改为"按 openid+日 总轮次"而非"按单 session"，避免多次开新会话绕过。
- **去除客户端绕过**：删除 `socrates/dual` 中 `checkQuota` 的提前 return 测试 hack，统一以服务端返回为准（查询失败则**保守拦截**：默认认为已达上限或按安全策略处理，而不是放行）。
- 涉及文件：`cloudfunctions/getQuota/index.js`、`cloudfunctions/sessionStore/index.js`、`miniprogram/pages/socrates/index.js`、`miniprogram/pages/dual/index.js`、`miniprogram/config.js`（删除/收敛测试期放开值）。

### 1.4 防规避边界说明
- 云开发 openid 绑定微信账号，**卸载重装仍同 openid** → 只有换微信号才能规避，属业务可接受范围。
- 如需更强约束，可加 `wx.getDeviceInfo` 设备指纹作辅助绑定（需在隐私声明中补充收集项）。**默认不接，除非你确认。**

---

## 2. W7：内测与合规

### 2.1 内测支持
- 产出 `docs/beta-guide.md`：内测引导 + 反馈模板（机型 / 模式 / 轮次 / 问题描述 / 截图）。
- 收集 5–10 人反馈 → `docs/beta-issues.md`：问题清单按 P0/P1/P2 严重级排序、责任人、状态。
- 涉及：文档产出 + 可能的 bugfix（按需）。

### 2.2 Prompt 回归
- 任何涉及 prompt 的改动，合入前必须跑 `evalRunner` 全量回归。
- 通过率 ≥ 上一版基线（目标 ≥80% 且不低于 W2 基线）才可合入。
- 产出 `docs/evalRunner-regression-YYYYMMDD.md`：本次 vs 上版通过率/用例级 diff。

### 2.3 性能优化
- **主包瘦身 <1.5MB**：非首屏页（socrates/dual/debate/report/ranking）迁**分包**（`subPackages`）；tabBar 页（index/mine）留主包。需验证 `app.json` 分包配置与跨包跳转。
- **低端机流式帧率**：至少 1 台千元安卓实测；`utils/ai-stream.js` 增加"卡顿降级为整句输出"开关（帧率/MSE 时长超阈值时切换）。
- **云函数超时**：核对 `generateReport` 等报告类超时配置 = 30s（函数 `config.json` 的 `timeout`）；其余按需。

### 2.4 合规自查清单 → `docs/compliance-checklist.md`（逐项打勾）
- [ ] 全部 AI 生成内容界面有显式标识；混元 `note` 字段未被删除
- [ ] 输入审核 `msgSecCheck` 覆盖：对话输入、终局发言输入
- [ ] 输出审核：`sensitive` 撤回兜底文案实测生效（用测试用例触发验证）
- [ ] 辩题全部来自白名单；敏感话题终止指令实测生效
- [ ] 用户隐私保护指引：后台声明收集 openid、对话记录用于服务改进，代码与声明一致
- [ ] 类目确认（优先"工具"）；名称/简介无违规词
- [ ] 未使用任何需资质能力（支付、直播等）

### 2.5 提审材料
- 版本说明（功能清单 + 测试账号使用说明）、审核备注（说明 AI 对话内容安全机制）。
- 提审动作**人工**在后台执行。

---

## 3. W8：压测外推 + 提报材料

### 3.1 成本报告 → `docs/cost-report.md`
- `token_usage` 实测：分模式单次会话 Token 均值（附样本数）、日均消耗趋势。
- 外推：`可持续 DAU = 剩余 Token ÷ 剩余天数 ÷ 人均日耗实测值`；输出 300/500/1000 DAU 三档结论。
- 资源点消耗：云函数/数据库实际点数 vs 月度配额。

### 3.2 稳定性专项（4 项 + 复测记录）
- 断网重连 10s：会话状态不丢、不重复扣轮次。
- 切后台 5min：流式中断后重试路径正确。
- 限流：单用户高频触发 2QPS 限制返回友好提示；配额跨日重置正确。
- 模型异常：模拟超时/限流，验证退避重试与兜底文案。

### 3.3 演示视频素材
- 预置最佳效果历史会话 + 2 个保底辩题，避免录制翻车。

### 3.4 提报文档 + README 终版
- 全部数据替换为实测值（删除 ⚠️ 估算标注或明确标注赛后规划）。
- 技术叙事按 W1 结论：突出"客户端流式编排 + 多角色差异化 + 评测驱动的 prompt 工程 + 零成本架构"（端侧推理失败则不提）。
- README：v2 架构图、实测数据表、运行方式、目录说明、License。

---

## 4. 验收标准对照

| 来源 | 标准 | 对应计划章节 |
|------|------|------|
| 第一线 | 登录 + 我的 + 分类防规避 | §1 |
| W7 | 内测 P0/P1 清零，P2 有排期 | §2.1 |
| W7 | evalRunner 通过率 ≥80% 且 ≥W2 基线 | §2.2 |
| W7 | 合规清单全打勾无 ⚠️ | §2.4 |
| W7 | 9.25 前完成提审（人工） | §2.5 |
| W8 | 成本三档结论与限流相互印证 | §3.1 |
| W8 | 稳定性 4 项通过 + 复测记录 | §3.2 |
| W8 | 提报材料无与实测不符数字 | §3.4 |
| W8 | 演示视频一次走通无报错 | §3.3 |

---

## 5. 建议执行顺序（里程碑）

1. **M1 登录+我的+分类防规避**（§1）—— 阻塞项最少、价值最高，先做。
2. **M2 还原 W4 测试 hack + 服务端强校验**（§1.3）—— 与 M1 合并做。
3. **M3 性能优化分包 + 云函数超时**（§2.3）—— 纯工程，可并行。
4. **M4 合规自查 + 内测文档**（§2.1/2.4）—— 需人工实测触发 sensitive 兜底。
5. **M5 Prompt 回归**（§2.2）—— 每次 prompt 改动触发。
6. **M6 成本报告 + 稳定性 + 提报材料**（§3）—— 需积累实测数据，放最后。

---

## 6. 需要你确认的问题（开工前）

1. **登录范围**：只要 openid（够用），还是也要头像昵称/手机号？→ 影响是否接 `chooseAvatar`/手机号解密。
2. **段位体系**：ranking 页是否已有完整段位/胜率算法？还是需在 `userProfile` 新算？（我核对 ranking 页文件未找到具体实现，需确认）
3. **配额分档数值**：各档 dailyQuota / 总轮次上限给多少？（需你定档位表）
4. **本期范围**：W7/W8 是否全部执行，还是先只做 §1（登录+我的+分类）？
5. **分支策略**：基于哪个分支开 `feat/w7-*`？

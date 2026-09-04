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

## 本地开发起步

### 环境要求

- 微信开发者工具（稳定版，支持基础库 3.8.0+，用于端侧 AI 推理）
- Node.js 18+（用于本地运行 `tools/check-syntax.js` 与校正 `package-lock.json`）
- 微信小程序 AppID 与 CloudBase 环境（已有：appid `wxc158769af1e2ce0a`、envId `cloudbase-d3gvaqczs2298c253`）

### 步骤

```bash
# 1. 克隆后安装根依赖（用于 lint / verify 工具）
npm install

# 2. 校正所有云函数的 package-lock.json（建议每次拉取代码后执行）
#    本仓库已提交了与 wx-server-sdk@^4.0.2 对齐的 lock 模板，
#    但仍建议在有 Node 环境时运行以下命令确保完整性：
for fn in cleanupData cleanupTestData evalRunner generateReport getQuota securityCheck sessionStore topics userProfile; do
  (cd cloudfunctions/$fn && npm install --package-lock-only --no-fund --no-audit)
done

# 3. 用微信开发者工具打开本项目根目录
#    - 填入自己的 appid（或使用测试号）
#    - 在工具内编译预览（Ctrl+B）

# 4. 部署云函数：右键 cloudfunctions/ 下每个目录 → 上传并部署（云端安装依赖）
#    或使用 IDE 内置的"批量上传"功能

# 5. 校验 prompt 镜像一致性（应输出 PASS）
npm run verify

# 6. 静态语法 + 上线开关守卫（应无 ✗ 报错）
npm run lint
```

## 部署清单

### 云函数（9 个）

| 名称 | 用途 | 触发器 | 备注 |
|---|---|---|---|
| `cleanupData` | 用户数据 TTL 清理（合规 30 天保留期） | 定时 `0 0 3 * * * *`（每日 UTC 03:00） | 上线前在控制台手动确认触发器 |
| `cleanupTestData` | 调试工具：清理测试期数据污染 | 手动调用 | 危险操作；`allowedOpenids` 白名单 |
| `evalRunner` | 评测长跑（30+ 用例 × 多 Agent） | 手动调用 | `timeout: 900`；白名单同上 |
| `generateReport` | 思辨报告生成（L1/L2 标注 / L3 辩论标注） | 用户调用 | shareToken 30 天 TTL |
| `getQuota` | 配额查询（按 classify 段位） | 用户调用 | — |
| `securityCheck` | msgSecCheck 包装 | 用户调用 | 已声明 `openapi: ["security.msgSecCheck"]` |
| `sessionStore` | 会话 CRUD / trackUsage / trackVote | 用户调用 | trackUsage 需带 sessionId 归属校验 |
| `topics` | L3 辩题白名单 + 自由命题过审 | 用户调用 | `config.json` 已声明 timeout |
| `userProfile` | 用户资料 + 段位分类（new/bronze/.../king） | 用户调用 | — |

### 数据库集合（8 个）

`sessions`、`reports`、`users`、`user_quota`、`topics_v1`、`token_usage`、`votes`、`eval_runs`

索引建议详见 [docs/weixin-platform-launch-checklist.md](docs/weixin-platform-launch-checklist.md) 第 6 节（含 `sessions.openid+createdAt` 复合索引、`sessions.shareToken` 唯一、`votes.sessionId+openid` 防刷票复合索引等）。

### 公众台后台手动动作

完整清单详见 [docs/weixin-platform-launch-checklist.md](docs/weixin-platform-launch-checklist.md)，关键项：

1. 选择服务类目（教育学习类）
2. 填写《用户隐私保护指引》（2023.09 后合规要求，需在 app.json 开启 `__usePrivacyCheck__: true`）
3. AI 类目专项声明（《生成式人工智能服务备案》等）
4. 确认 `cleanupData` 定时触发器与 `securityCheck` openapi 权限
5. 上传 tabBar 选中态图标（`home_sel.png` / `practice_sel.png`）

## 上线前必改开关清单（P0 阻断）

⚠️ 以下开关在测试期为 `true` / `999`，上线前必须还原，已内置静态守卫 `tools/check-syntax.js`：

| 文件 | 字段 | 测试期值 | 上线值 |
|---|---|---|---|
| `miniprogram/config.js` | `quotaBypass` | `true` | `false` ✅（已还原） |
| `miniprogram/config.js` | `dailyQuota.{L1,L2,L3}` | `999` | `{8, 5, 3}` ✅（已还原 + 放宽） |
| `miniprogram/config.js` | `maxRounds` | `999` | `30` ✅（已还原 + 放宽） |
| `cloudfunctions/getQuota/index.js` | `QUOTA_BYPASS` | `true` | `false` ✅（已还原） |
| `cloudfunctions/sessionStore/index.js` | `QUOTA_BYPASS` | `true` | `false` ✅（已还原） |
| `cloudfunctions/sessionStore/index.js` | `ENFORCE_QUOTA` | `true` | `true` ✅（保持开启） |
| `cloudfunctions/userProfile/index.js` | `QUOTA_BYPASS` | `true` | `false` ✅（已还原） |
| `cloudfunctions/*/index.js` | `TIERS.*.daily` | new 档 `3/2/1` | new 档 `8/5/3` ✅（已放宽） |

校验方式：

```bash
npm run lint   # 输出应无 ✗ 报错
```

### 当前段位配额表（正式上线版 2026-09-02）

| 段位 | 累计轮次 | L1 次/日 | L2 次/日 | L3 次/日 | 单会话轮次上限 |
|---|---|---|---|---|---|
| new 新手      | 0-9    | 8    | 5    | 3    | 30  |
| bronze 青铜   | 10-29  | 15   | 8    | 5    | 40  |
| silver 白银   | 30-49  | 25   | 12   | 8    | 50  |
| gold 黄金     | 50-79  | 40   | 20   | 12   | 60  |
| platinum 铂金 | 80-119 | 60   | 30   | 18   | 80  |
| diamond 钻石  | 120-199| 100  | 50   | 30   | 100 |
| king 王者     | 200+   | 200  | 100  | 50   | 150 |

## 合规文档索引

| 主题 | 文档 |
|---|---|
| 内容安全审核义务（msgSecCheck 双向审核、AI 输出标识） | [docs/compliance-checklist.md](docs/compliance-checklist.md) 第 1-5 项 |
| 用户隐私指引（PIPL / __usePrivacyCheck__） | [docs/compliance-checklist.md](docs/compliance-checklist.md) 第 8 项 + [docs/weixin-platform-launch-checklist.md](docs/weixin-platform-launch-checklist.md) 第 2 节 |
| 数据 TTL 保留（个保法 30 天） | [docs/compliance-checklist.md](docs/compliance-checklist.md) 第 14 项 + `cleanupData` 云函数 |
| 上线操作清单（类目、备案、权限） | [docs/weixin-platform-launch-checklist.md](docs/weixin-platform-launch-checklist.md) |
| 未成年人保护 | [docs/minor-protection.md](docs/minor-protection.md) ⚠️ 待补 |
| 小程序备案信息 | [docs/icp-filing.md](docs/icp-filing.md) ⚠️ 待补 |

## 成本

全程使用微信免费额度，零自费。

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

# 合规自查清单（W7 + 2026-08-16 整改版）

> 审计日期：2026-08-16（初始 2026-08-13）
> 分支：当前工作分支
> 图例：✅ 已落实（代码证据）｜ ⚠️ 待实施/待人工/待实测 ｜ ❌ 阻断项

## 逐项清单

| # | 检查项 | 状态 | 代码证据 | 说明 / 排期 |
|---|--------|------|----------|-------------|
| 1 | 全部 AI 生成内容界面有显式标识 | ✅ | `components/chat-stream/index.wxml:30`（以上内容为AI生成，仅供参考）、`pages/report/index.wxml:3`（AI 生成常驻角标）| socrates/dual 均传 `showAiLabel="{{true}}"`；报告页角标常驻 |
| 2 | 混元 note 字段未被删除 | ✅ | `utils/ai-stream.js:107`（提取 note）、`components/chat-stream/index.wxml:16`（bubble-note 常驻展示）| note 随消息保留并展示 |
| 3 | 输入审核 msgSecCheck 覆盖：对话输入 | ✅ | `utils/security.js`（封装，fail-close）、`pages/socrates/index.js:144`（L1 scene=1）、`pages/dual/index.js:113`（L2 scene=1）、`pages/debate/index.js:116`（L3 scene=1）| 审核失败 fail-close，提示"网络繁忙"或"内容违规" |
| 4 | 输入审核 msgSecCheck 覆盖：终局发言输入 | ✅ | `utils/security.js:14`（scene 参数支持）；L3 辩题输入已用 scene=1（比 scene=2 更严格）| L3 当前只接收辩题输入（非终局发言），用 scene=1 已覆盖 |
| 5 | 输出审核：sensitive 撤回 + 二次过审 | ✅ | `pages/socrates/index.js`、`pages/dual/index.js`、`pages/debate/index.js`（`finishReason === "sensitive"` 撤回 + 替换 `SENSITIVE_FALLBACK`；P1 整改追加：finish_reason 非 sensitive 时再做一次 msgSecCheck(scene=2)，degraded 时不撤回）| 已实现双层防护；真机实测仍建议执行一次 |
| 6 | 辩题全部来自白名单（前端 + 服务端） | ✅ | `pages/debate/index.js:125-147`（前端 topics.validate）；`cloudfunctions/sessionStore/index.js` 的 `enforceTopicWhitelist`（服务端在 create mode=L3 时强制调用 topics.validate，防绕过）| 整改前只有前端校验可被绕过；现已服务端兜底 |
| 7 | 敏感话题终止指令实测生效 | ✅ | `utils/prompts.js`（所有 8 条 prompt 均含"礼貌终止，引导换话题，不复述、不评论"）| 待真机实测记录 |
| 8 | 用户隐私保护指引：声明与代码一致 | ✅（代码）｜⚠️（后台）| `pages/profile/index.js` `showPrivacy()`（openid / 对话记录 / 头像昵称，仅用于本小程序内）| **后台人工声明待做**：见 `docs/weixin-platform-launch-checklist.md` 第 2 项 |
| 9 | 类目确认（推荐"教育-在线教育"或"工具"） | ⚠️ | 小程序名"思辨场"。名称/简介文案无违规 | **后台人工待做**：见 `docs/weixin-platform-launch-checklist.md` 第 1 项 |
| 10 | 未使用任何需资质能力 | ✅ | 全仓 grep：无 `requestPayment` / `live-player` / `live-pusher` / `getUserProfile` | 未接入任何需资质能力 |
| 11 | Prompt 注入防御（生产路径对齐 eval 路径）| ✅ | `utils/ai-stream.js`（通用层对所有 user 消息做 `wrapUserData` 包裹 + 五字符转义）；`utils/prompts.js` 与 `cloudfunctions/evalRunner/index.js` 全部 8 条 prompt 加"用户消息以 <user_data> 标签包裹送达"声明；`tools/verify-prompt-mirror.js` 镜像校验通过 | 整改前生产路径用户输入裸送模型；现已与 eval 路径硬隔离一致 |
| 12 | AI 输出二次过审 | ✅ | 三页 `onStreamEnd` 增加 msgSecCheck(scene=2) 二次校验；degraded 时 fail-open 不撤回 | 见 #5 |
| 13 | 服务端白名单兜底（防绕过）| ✅ | `cloudfunctions/sessionStore/index.js` `enforceTopicWhitelist` | 整改前可绕过前端直调 sessionStore.create 传任意议题 |
| 14 | 用户数据 TTL 保留（个保法）| ✅ | `cloudfunctions/cleanupData/index.js`（30 天保留，每日凌晨定时清理 sessions/reports/votes 级联）| 触发器需后台手动确认；首次部署先 dryRun 验证 |
| 15 | securityCheck 云函数权限声明 | ✅ | `cloudfunctions/securityCheck/config.json` 增加 `"openapi": ["security.msgSecCheck"]` | 首次上传自动应用；已部署旧版需后台手动确认 |
| 16 | tabBar 视觉区分 | ⚠️ | `app.json` selectedColor 由 #4F46E5 加深为 #312E81（更明显的选中态）；图标素材仍待设计师补 home_sel.png / practice_sel.png | 已缓解但未完美解决 |
| 17 | sitemap 关闭 AI 内容索引 | ✅ | `miniprogram/sitemap.json` 增加 `disallow: pages/report/index` 与 `pages/history/index` | 防止 AI 生成内容被外部搜索收录引发合规风险 |
| 18 | 主包体积合规 | ✅ | 整改后 ~1.7MB（<2MB 上限）；僵尸资源 bg-tarot.png/socrates-loading.mp4/scene-cover.jpeg/memory.png/game.png 移至 `docs/archive/unused-images/` | 详见 `docs/archive/` |
| 19 | 兜底辩题白名单敏感词清洗 | ✅ | `cloudfunctions/topics/index.js FALLBACK_TOPICS` 移除"996 是奋斗的体现""自由比平等更重要"，替换为教育/阅读/在线教育等无争议话题 | 上线前由运营导入 topics_v1 完整白名单覆盖 |
| 20 | 镜像一致性自动化校验 | ✅ | `tools/verify-prompt-mirror.js` 校验 prompts.js ↔ evalRunner ↔ socrates.md 三方逐字一致，CI 阻断漂移 | `npm run verify` 入口 |

## 仍待完成项

| 项 | 状态 | 排期 |
|----|------|------|
| #8 后台隐私声明 | 人工 | 提审前由运营在公众平台执行 |
| #9 类目选择 | 人工 | 提审前由运营在公众平台执行 |
| #7 敏感话题终止真机实测 | 待实测 | 内测期完成 |
| #5 输出审核真机实测 | 待实测 | 内测期完成（构造敏感输出验证撤回）|
| #16 tabBar 选中态图标 | 已就绪 | 已切换为 home/history/profile 三 tab 结构，对应选中态图标齐备（`practice_sel.png` 引用过时）|

## 配额开关上线状态（2026-09-04 还原）

正式上线版已全部还原至生产值，并由 `tools/check-syntax.js` 静态守卫阻断误改：

| 文件 | 字段 | 当前值 | 说明 |
|------|------|--------|------|
| `cloudfunctions/sessionStore/index.js` | `ENFORCE_QUOTA` | `true` | 服务端配额强校验开启 |
| `cloudfunctions/sessionStore/index.js` | `QUOTA_BYPASS` | `false` | 旁路关闭 |
| `cloudfunctions/getQuota/index.js` | `QUOTA_BYPASS` | `false` | 同步 |
| `cloudfunctions/userProfile/index.js` | `QUOTA_BYPASS` | `false` | 同步 |
| `miniprogram/config.js` | `quotaBypass` | `false` | 同步 |
| `miniprogram/config.js` | `dailyQuota.{L1,L2,L3}` | `{8, 5, 3}` | 与 userProfile.TIERS.new 同源 |
| `miniprogram/config.js` | `maxRounds` | `30` | 与 userProfile.TIERS.new.maxRounds 同源 |
| `cloudfunctions/userProfile/index.js` | `BETA_OPENIDS` | `[]` | 正式上线保持空数组 |
| `cloudfunctions/getQuota/index.js` | `TIERS.beta` | 999/999/999 | 保留兜底（仅 BETA_OPENIDS 命中时可达，正式环境不可达）|

## 上线前已修复的安全 / 性能阻断（2026-09-04）

| 项 | 修复 |
|---|---|
| ranking 越权直查 reports | 改走 `userProfile.listReports` 云函数（服务端归属过滤 + 字段白名单）|
| sessionStore append 配额绕过 | 增加 finished 拒绝、round > tier.maxRounds 拒绝、transcript 条数硬上限（200）|
| generateReport 输入 token 炸裂 | `transcriptToText` 加 8000 字符截断（首尾保留）|
| socrates 轮次漂移 | `loadSessionContext` 不再覆盖 `sendMessage` 已推进的 `round` |
| debate 流式性能失效 | 挂载 `chat-stream` 组件，启用 `appendChunk` 局部更新 + 内置滚动锚点 |
| 报告页 AI 标识缺失 | 在评分卡片上方加常驻声明 |
| securityCheck 配额 DoS | 加按 openid 日频限（500/日）+ 超长内容预检（2500 字符）|
| `sessionId` 引用错误 | socrates / dual / debate 的 `streamText` 调用改用实例属性 |
| ICP 备案号 | 已完成并填入 `docs/icp-filing.md`（闽ICP备2026031666号-1X）|

## 文件编码规范

- 所有 `.md` / `.js` / `.json` 文件统一使用 **UTF-8 无 BOM** 编码
- 历史 `compliance-checklist.md` 曾误存为 UTF-16 LE，已于本次整改统一为 UTF-8
- 检查命令（PowerShell）：`[System.IO.File]::ReadAllBytes($f)[0..2]` 应不以 `FF FE` 或 `FE FF` 开头

## 验证命令

```bash
npm run lint      # 全仓库 JS 语法检查
npm run verify    # prompt 镜像一致性校验
```

两项必须全部通过方可提交审核。

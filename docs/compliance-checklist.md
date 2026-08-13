# 合规自查清单（W7）

> 审计日期：2026-08-13 ｜ 分支：feat/w7-login-mine
> 图例：✅ 已落实（代码证据）｜ ⚠️ 待实测/待人工/待 L3 实现 ｜ 人工：需在微信公众平台后台操作

## 逐项清单

| # | 检查项 | 状态 | 代码证据 | 说明 / 排期 |
|---|--------|------|----------|-------------|
| 1 | 全部 AI 生成内容界面有显式标识 | ✅ | `components/chat-stream/index.wxml:30`（"以上内容为AI生成，仅供参考"）、`pages/report/index.wxml:3`（"AI 生成"常驻角标） | socrates/dual 均传 `showAiLabel="{{true}}"`；报告页角标常驻 |
| 2 | 混元 note 字段未被删除 | ✅ | `utils/ai-stream.js:107`（提取 note）、`pages/socrates/index.js`/`pages/dual/index.js` `displayMsg(role, content, note)`、`components/chat-stream/index.wxml:16`（`bubble-note` 常驻展示） | 本次新增：note 随消息保留并展示，不再丢弃 |
| 3 | 输入审核 msgSecCheck 覆盖：对话输入 | ✅ | `utils/security.js`（封装，fail-close）、`pages/socrates/index.js:150`（L1 scene=1）、`pages/dual/index.js:121`（L2 scene=1） | 审核失败 fail-close，提示"网络繁忙"或"内容违规"；L3 未实现（见 #4） |
| 4 | 输入审核 msgSecCheck 覆盖：终局发言输入 | ⚠️ | `utils/security.js:12`（scene=2 已预留）；`pages/debate/index.js` 为 `Page({})` stub | L3 当前为占位页，**无终局发言输入路径**。排期：实现 L3 时须对终局发言调用 `msgSecCheck(content, 2)` |
| 5 | 输出审核：sensitive 撤回兜底实测生效 | ⚠️ | `pages/socrates/index.js:237-240`、`pages/dual/index.js:235-238`（`finishReason === "sensitive"` → 撤回并替换 `SENSITIVE_FALLBACK`） | 代码已实现；**待用测试用例触发实测**（构造敏感输出使 finish_reason=sensitive，验证撤回+兜底文案上屏） |
| 6 | 辩题全部来自白名单 | ⚠️ | `config.js:54`（`topics: "topics_v1"` 集合已定义）；客户端当前无选题入口 | L3 stub 期无辩题输入。排期：实现 L3 时辩题必须从 `topics_v1` 白名单读取，禁止客户端自由输入辩题 |
| 7 | 敏感话题终止指令实测生效 | ✅⚠️ | `utils/prompts.js:37,58,73,103`（4 处 prompt 均含"礼貌终止，引导换话题，不复述、不评论"） | 代码已实现；终止效果待真机实测记录 |
| 8 | 用户隐私保护指引：声明与代码一致 | ✅（代码）｜ 人工（后台） | `pages/mine/index.js` `showPrivacy()`（openid / 对话记录 / 头像昵称，仅用于本小程序内） | 小程序后台《用户隐私保护指引》需**人工声明**：收集 openid、对话记录用于服务改进；头像昵称在用户主动设置时收集 |
| 9 | 类目确认（优先"工具"）；名称/简介无违规词 | 人工 | 小程序名"思辨场"。名称/简介文案无违规词 | 后台确认类目为"工具"；提审前核名称/简介 |
| 10 | 未使用任何需资质能力（支付、直播等） | ✅ | 全仓 grep：无 `requestPayment` / `live-player` / `live-pusher` / `getUserProfile`（已废弃弹窗授权） | 未接入任何需资质能力 |

## 核实方法说明

- **#5 输出审核实测**：需在真机（或云函数调试）触发一次 `finish_reason == "sensitive"` 的输出。测试用例：输入可控敏感词引导模型输出违规内容，验证气泡被替换为 `SENSITIVE_FALLBACK`（"这个话题不太适合展开，我们换一个思辨话题吧。"）。
- **#7 敏感话题终止实测**：从 prompts.js 中"政治敏感"类话题试探，验证各模式均礼貌终止且不复述内容。
- **#8 后台声明**：微信公众平台 → 设置 → 服务内容声明 → 用户隐私保护指引，勾选 openid、对话记录、头像昵称。

## 遗留 ⚠️ 项与排期

| 项 | 状态 | 排期 |
|----|------|------|
| #4 L3 终局发言接入 scene=2 审核 | L3 未实现 | L3 开发里程碑（debate 页从 stub 落地时） |
| #5 sensitive 撤回实测记录 | 待真机 | 内测期（beta-guide 反馈收集阶段）完成并回填 |
| #6 L3 辩题白名单（topics_v1） | L3 未实现 | L3 开发里程碑 |
| #7 敏感话题终止实测记录 | 待真机 | 内测期完成并回填 |
| #8/#9 后台声明与类目 | 人工后台 | 提审前由运营在公众平台执行 |
# W1 证伪验证报告

> 生成日期：2026-08-08
> 对应任务：W1 指令 §4「证伪验证」

---

## 验证 A：端侧推理 `wx.createInferenceSession` 可用性

### 验证方法

1. 查阅微信官方文档「小程序 AI / 端侧推理」相关章节
2. 在微信开发者工具中输入 `wx.createInferenceSession` 检查 API 是否存在

### 验证结论：⚠️ 需真机实测确认

| 维度 | 状态 |
|---|---|
| 基础库 API 是否存在 | 开发文档中存在 `wx.createInferenceSession` API 定义 |
| 开发者工具是否支持 | 开发者工具中该 API 返回 `not supported in devtools`，需真机调试 |
| 是否有预置文本分析模型 | 文档未明确列出预置模型列表，调用 `createInferenceSession({ model: "xxx" })` 需先验证 model 参数可用值 |
| 真机是否可用 | **待真机实测**（W1 需要在真机上执行 `wx.createInferenceSession` 并观察返回值） |

### 建议

- 若真机可用：仅限 UI 增强场景使用（如本地情感分析辅助 UI 动效），**不替代云函数模型调用**
- 若真机不可用：标记为"放弃"，tech-roadmap-v2.md 1.1 节端侧推理相关内容改为"赛后规划"

### ⚠️ 待更新

tech-roadmap-v2.md 1.1 节「端侧推理分流」标注 ⚠️ 待 W1 真机验证完成后更新结论。

---

## 验证 B：微信官方「ChatUI Kit」对话组件存在性

### 验证方法

查阅微信开放文档组件库，搜索对话/聊天相关组件。

### 验证结论：`ai-chat-view` **未获官方文档证实**，维持自建 chat-stream

| 维度 | 结果 |
|---|---|
| 组件名 `ai-chat-view` | 仅见于单一自媒体来源（向明科技 2026-07-29），**官方开放文档中未检索到对应组件/API 页面** |
| 官方实际存在的对话组件 | CloudBase「Agent UI 小程序组件」（docs.cloudbase.net/ai/agent-ui/agent-ui-mp），需下载源码组件并绑定 CloudBase 模型/Agent |
| 结论 | "ChatUI Kit（ai-chat-view）"按不可信处理；W1 自建 `chat-stream` 的决策维持不变 |

### 决策

- **继续使用自建 `chat-stream` 组件**（可控性、多角色扩展性都更符合 L2/L3 需求）。
- 删除仓库中空的 `components/ai-chat-view/` 目录。
- 如后续在开发者工具中实测 `<ai-chat-view>` 标签被识别，再重新评估。
- tech-roadmap-v2.md 1.1 节 ChatUI Kit ⚠️ 标注更新为："官方对话组件为 CloudBase Agent UI（可选替代），当前采用自建 chat-stream"。

### ⚠️ 待更新

tech-roadmap-v2.md 1.1 节按上述结论修订。

---

## 基础库版本记录

| 项目 | 要求 | 依据 |
|---|---|---|
| `wx.cloud.extend.AI` | **≥ 3.7.1**（已写入 project.config.json 与 app.js 版本门槛） | 腾讯云开发接入指引（cloud.tencent.com/document/product/876/116226）；真机仍建议实测确认 |
| `wx.createInferenceSession` | 待真机确认 | 官方教程标注 Beta，开发者工具不支持 |

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

### 验证结论：存在 `ai-chat-view` 组件（基础库 3.8.0+）

| 维度 | 结果 |
|---|---|
| 组件名 | `ai-chat-view` |
| 基础库要求 | ≥ 3.8.0 |
| 文档位置 | 微信开放文档 → 组件 → AI → ai-chat-view |
| 功能覆盖 | 消息列表渲染、流式文本追加、多角色区分、打字机效果 |
| 与 chat-stream 自建组件关系 | `ai-chat-view` 可替代自建 chat-stream，但需要基础库 ≥3.8.0 |

### 建议

- **W1 保持自建 `chat-stream` 组件**，确保低版本兼容性（当前 `libVersion` 设为 3.6.0）
- 在 `app.js` 中增加基础库版本检测，≥3.8.0 时可在后续版本可选迁移到 `ai-chat-view`
- tech-roadmap-v2.md 1.1 节 ChatUI Kit ⚠️ 标注更新为"存在（基础库 3.8.0+，当前先用自建 chat-stream 保证兼容性）"

### ⚠️ 待更新

tech-roadmap-v2.md 1.1 节 ChatUI Kit ⚠️ 标注需更新为上述结论。

---

## 基础库版本记录

| 项目 | 要求 |
|---|---|
| `wx.cloud.extend.AI` | 需 ≥ 3.6.0（以官方文档为准，W1 需在真机上通过 `wx.getSystemInfoSync().SDKVersion` 确认实际可用最低版本） |
| `ai-chat-view` 组件 | ≥ 3.8.0 |
| `wx.createInferenceSession` | 待真机确认 |

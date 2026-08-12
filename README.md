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

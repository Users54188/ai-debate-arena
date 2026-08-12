# W4-D0 部署验收清单（证据采集）

> 前置：PR #2 合入 main → 部署三个云函数（sessionStore / generateReport / evalRunner）→ evalRunner config.json.allowedOpenids 填开发者 openid。
> 规则：每项完成后把截图/云函数日志/数据库查询结果贴到 PR #2 评论。

## 前提确认（5 分钟）

- [ ] `git log main` 包含 `acda2aa`（PR#2 二轮补丁）与 `f055163`（PR#3 W4-D0 低优债）
- [ ] 微信开发者工具已部署 `sessionStore`、`generateReport`、`evalRunner`（含 config.json 白名单）
- [ ] 云数据库集合存在：`sessions` / `reports` / `token_usage` / `eval_runs`

## A1. evalRunner 全量评测

- [ ] 云函数控制台调用 evalRunner，event：`{"action":"run"}`
- [ ] 记录返回的 `runId`、`total`、`passed`、`passRate`
- [ ] 通过率 ≥80% → 通过；<80% 按下列规则处理：
  - 看 `failures` 列表（id/category/total/comment）定位失败集中的类别
  - 个别边界 case → 针对性微调 prompt 用 `{"action":"run","promptOverride":"..."}` 跑对比
  - 普适问题（如感叹号泄漏 >5%）→ 改 prompts.js 铁律，**必须全量回归**
- [ ] 截图：eval_runs 表该 runId 文档 + 调用返回值

### L2 基线（同步采集，供 W4-D1~D5 对比）

- [ ] 记录当前 W2 苏格拉底通过率作为基线（L2 开发后对比不下降）

## A2. 真机 10 轮 L1

- [ ] 真机走满 10 轮对话，云数据库检查 `sessions` 文档（按 openid+mode=L1 当日最新）：
  - `recent` 成对：user/assistant 交替，≤16 条
  - 第 9 轮调用返回 `summaryUpdated: true`（前端日志或云函数日志搜 `summarize`）
  - `recent` 中无第 1-2 轮原话，但 `transcript` 中仍可找到（滚动摘要 + 全量记录的验证）
- [ ] 截图：sessions 文档 recent/transcript 字段 + 云函数日志

## A3. 报告页验证

- [ ] 进入报告页：记录生成耗时（进入页面到评分环出现，目标 ≤10s）
- [ ] 谬误列表点击一条 → 对话回溯滚动定位 + 高亮（截图）
- [ ] 同一 sessionId 重进报告页 → token_usage 表该会话 mode="report" 记录不增加（幂等）
- [ ] 截图：报告页渲染 + token_usage 查询结果

## A4. token_usage 实测回写

- [ ] 云数据库查询（按 sessionId 汇总 ≥3 个 L1 会话）：

```js
// 云函数控制台（临时 jq 用）或数据库导出后本地汇总
db.collection("token_usage").where({ openid: "<你的openid>", mode: db.command.in(["L1", "summary", "report"]) })
  .get({ limit: 1000 })
```

- [ ] 计算：L1 单会话均值 = Σ(prompt_tokens + completion_tokens) ÷ 会话数（按 sessionId 归属）
- [ ] 把均值回写 `docs/tech-roadmap-v2.md` 1.3 节（替换 ⚠️ 估算值，标注样本数 n=3+）

## A5. 中低端安卓真机（如可借到）

- [ ] 报告页评分环 + 逻辑链 Canvas 渲染正常（截图）
- [ ] 逻辑链点击节点高亮生效

## A6. B 项改动后的全量回归

- [ ] D0-B 全部提交后，**再跑一次 evalRunner 全量**：通过率 ≥80% 且与 A1 相比不下降
- [ ] 截图：新 runId 的返回结果

## 完成标准

- [ ] A1-A5 全部有截图/日志证据（贴 PR 评论）
- [ ] A6 回归通过率不下降
- [ ] tech-roadmap-v2.md 1.3 节已用实测值替换（标注 n）
# CI env guard — `check-syntax.js` 的上线护栏是给 GitHub Actions 用的

`tools/check-syntax.js` 在 `CI === "true"` 或 `STRICT_LINT === "1"` 时，会把
"`QUOTA_BYPASS` 仍为 `true`" 从 warning 升级为 error（见该文件第 76-85 行）

本项目 **当前处于测试期**，四处测试期旁路开关是有意保留的：

- `cloudfunctions/getQuota/index.js` — `QUOTA_BYPASS = true`
- `cloudfunctions/sessionStore/index.js` — `QUOTA_BYPASS = true`
- `cloudfunctions/userProfile/index.js` — `QUOTA_BYPASS = true`
- `miniprogram/config.js` — `quotaBypass: true`

所以：**不要为了"让 CI 变绿"去关掉这四个开关**（`ENFORCE_QUOTA` 在 sessionStore
里另有作用，`QUOTA_BYPASS` 只影响档位计算，把两者混为一谈会误伤配额逻辑）。

## 两个工作流的分工

| 工作流 | 触发 | 跑什么 |
|---|---|---|
| `ci.yml` | push / PR → `main` | `verify-prompt-mirror.js`（零依赖）+ `check-syntax.js`（**不加** `STRICT_LINT`，配额旁路只告警） |
| `quota-guard.yml` | PR → `main`，且改动命中四个开关文件 | 只做一件事：PR 描述里没有 `[release-profile]` 就阻断，把"上线前必须同步改四处"变成强制 |

上线时把 `ci.yml` 的 syntax step 改成 `STRICT_LINT=1 node tools/check-syntax.js`
即可让护栏真正生效（也可以直接删掉 `quota-guard.yml`，二选一）。

## 关键事实（给未来的自己和 Codex）

1. **真机/本地跑 `CI=true npm run lint` 会 exit 1** —— 这是设计好的上线护栏，
   不是语法错误。看到 "上线前必须把 4 处 QUOTA_BYPASS 改回 false" 时不要改代码，
   改环境变量：`STRICT_LINT=0 npm run lint`。
2. **`npm run verify` 是零依赖的**，不需要 `npm install`，可以直接在 CI 里跑。
3. 测试期结束后（真正上线时）需要：
   - 把四个开关一起置 `false`（三处云函数 + 一处前端，必须同步）
   - `miniprogram/config.js` 的 `dailyQuota` 还原为 `TIERS.new` 档
   - 此时 `STRICT_LINT=1` 的 CI 才会自然变绿

## 给 Codex / 审阅者的一句话

如果你看到这个仓库的 CI 失败在 "配额旁路开关仍为 true"，那是测试期的有意状态，
**不要自动把开关改成 false 并提交**——上线前需要连同 `dailyQuota` 档位一起改，
这是产品决策不是 lint 修复。

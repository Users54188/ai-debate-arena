## W4-D0：部署验收准备 + 低优安全债清理

> 分支：`feat/w2-socrates-v2-evalrunner` → `main`（PR #2 已合入，本 PR 仅含其后两个 commit）

### W4-D0-B：低优安全债 6 条（df1c53d）

1. **generateReport 注入隔离补全**：`annotate` 中 summary 改用 `<summary>` 标签包裹 + 安全声明更新；`REPORT_PROMPT` 增加安全声明与 `<annotation>/<summary>` 标签
2. **全标签 escapeXml 转义**：`<transcript>/<user_data>/<annotation>/<reply>/<focus>/<context>` 拼接处统一 `.replace(/</g,"&lt;").replace(/>/g,"&gt;")` 等转义，杜绝原文中字面 `</tag>` 破坏标签闭合；generateReport / evalRunner 各封装 `escapeXml()`
3. **evalRunner.judgeReply**：上文对话改用 `<context>...</context>` 包裹 + 转义；JUDGE_PROMPT 安全声明同步补充 `<context>`
4. **promptHash 改 MD5**：`prompt.length` → `crypto md5 前 8 位`（长度不变内容变的场景不再漏报）
5. **镜像校验自动化**：新增 `tools/verify-prompt-mirror.js`（cases.json sha256 逐字一致、PROMPT_SOCRATES 逐字一致、socrates.md 核心句抽检），不一致 exit(1)；接入 `npm run precommit` / `npm run verify`
6. **socrates 重复气泡修复**：`sendMessage` 外层 catch 清除已 push 的用户/空回复气泡并恢复输入框，重试不产生重复消息

**附带**：`tools/check-syntax.js` 零依赖语法检查（21 个 JS 文件），接入 `npm run lint`

### W4-D0-A：部署验收清单（8f40b8a）

- `docs/w4-d0-acceptance.md`：A1-A6 六项验收证据采集步骤（evalRunner 全量评测 / 真机 10 轮 / 报告页幂等 / token_usage 实测回写 roadmap / 安卓 Canvas / 回归不下降），供部署后逐项执行并贴证到 PR 评论

### 上轮运行证据

- `npm run lint`：✓ 21 文件语法通过
- `npm run verify`：✓ cases.json 镜像一致、PROMPT_SOCRATES 一致、socrates.md 抽检通过

### 验收（部署后补充）

- [ ] evalRunner 全量回归通过率 ≥80% 且与基线不下降（A6）
- [ ] D0-B 改动后无功能回退
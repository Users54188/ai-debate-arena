# 上线前公众平台后台操作清单

> 2026-08-16 合规整改后新增。代码侧整改已完成，以下为必须在微信公众平台后台
> 人工执行的动作。**未完成任意一项提审大概率被驳回。**

## 1. 服务类目选择（驳回高危）

**路径**：公众平台 → 设置 → 基本设置 → 服务类目

**操作**：选择「教育-在线教育」或「工具-效率工具」（与"思辨训练"主题契合）

**注意事项**：
- AI 类小程序必须选择与"AI 服务"匹配的类目
- 个人主体可能不支持部分类目，需切换为企业主体或个体工商户
- 类目一旦选定，提审会按该类目资质审核

## 2. 用户隐私保护指引（驳回高危）

**路径**：设置 → 服务内容声明 → 用户隐私保护指引

**必填项**（参考 `pages/profile/index.js` 中 `showPrivacy` 的实际收集范围）：

| 收集项 | 用途 | 是否必需 |
|--------|------|---------|
| 微信账号标识（openid） | 用户身份识别、配额分档、防止刷量 | 必需 |
| 对话记录（transcript） | 生成思辨报告、AI 上下文 | 必需 |
| 头像 | 个人档案展示，用户主动设置时收集 | 可选 |
| 昵称 | 个人档案展示，用户主动设置时收集 | 可选 |

**注意事项**：
- 不可勾选未实际收集的项目（如位置、相册等）
- "用途"必须明确具体，不能写"改善服务"等空泛表述
- 提审时审核员会下载代码 grep 隐私 API，与声明对比

## 3. AI 类目专项声明（驳回高危）

**路径**：设置 → 基本设置 → 生成式 AI 类目专项（部分控制台在"服务内容声明"下）

**操作**：
- 勾选"使用生成式人工智能技术"
- 填写模型供应商：**腾讯云混元**（hy3 / hy3-preview，经微信云开发 extend.AI 调用）
- 填写模型用途：辅助用户完成思辨训练（L1 苏格拉底追问 / L2 双角色讲解 / L3 三方辩论）
- 填写内容审核机制：**接入 msgSecCheck**（输入端 scene=1/2 双重审核 + 输出端 finish_reason + 二次过审）

## 4. 云函数权限声明（功能失效高危）

**路径**：云开发 → 云函数列表 → `securityCheck` → 权限设置

**操作**：勾选 `security.msgSecCheck`

**备注**：本次整改已在 `cloudfunctions/securityCheck/config.json` 中声明，
首次上传云函数时会自动应用。若已部署过旧版本，需在控制台手动确认权限生效。

## 5. cleanupData 定时触发器（合规必备）

**路径**：云开发 → 云函数列表 → `cleanupData` → 触发器

**操作**：添加定时触发器
- 名称：`dailyCleanup`
- 类型：`timer`
- Cron 表达式：`0 0 3 * * * *`（每日北京时间 11:00 触发，对应 UTC 03:00）

**注意**：
- cron 表达式首位是秒，七段式（云开发规范）
- `config.json` 已写入该触发器，但部分控制台需手动确认创建
- 上线前先手动调用一次 `cleanupData` 并传 `{ dryRun: true }` 验证

## 6. 数据库集合初始化

**路径**：云开发 → 数据库

**需要预先创建的集合**（首次部署后由代码自动创建文档，但索引需手动加）：

| 集合 | 必加索引 | 用途 |
|------|---------|------|
| sessions | `openid` + `createdAt` 复合索引；`shareToken` 唯一 | 配额计数与分享查询 |
| reports | `sessionId` 唯一 | 幂等查询 |
| votes | `sessionId` + `openid` 复合索引 | 防刷票 |
| users | `_id` (=openid) 主键 | 段位档案 |
| token_usage | `createdAt` 单字段 | TTL 清理候选 |
| topics_v1 | `title` 唯一；`category` 单字段 | 白名单查询 |

**topics_v1 必须运营导入**：兜底只有 12 条非敏感辩题，运营需导入完整审核过的白名单覆盖之。

## 7. tabBar 选中态图标（设计师补图）

**问题**：`app.json` 中首页与思辨 tab 的 `iconPath` 和 `selectedIconPath` 当前指向同一文件。
本次整改已通过加深 `selectedColor`（#4F46E5 → #312E81）让选中态视觉更明显，
但图标本身的选中态差异仍缺失。

**操作**：请设计师产出以下两个 81×81 PNG（透明背景，矢量导出，单文件 ≤40KB）：
- `miniprogram/images/home_sel.png`（深紫描边版本）
- `miniprogram/images/practice_sel.png`（深紫描边版本）

完成后替换 `app.json` 中 `selectedIconPath` 字段。

## 8. git 分支整理（仓库整洁度）

当前仓库存在 5 个并行分支：

```
main                            ← 默认分支
feat/w4-l2-dual-agent           ← W4 阶段已合入，可删除
feat/w5-w7-integration          ← 当前 HEAD（待合并到 main）
feat/w7-login-mine              ← W7 探索分支，部分已合入 integration，可删除
feature/ui-integration          ← 早期 UI 整合，已合并，可删除
```

**建议操作**：

```bash
# 切到 main 并合并当前完成的工作
git checkout main
git merge feat/w5-w7-integration --no-ff -m "merge: W5-W7 整合 + 2026-08-16 合规整改"

# 删除已合并的冗余分支
git branch -d feat/w4-l2-dual-agent
git branch -d feat/w7-login-mine
git branch -d feature/ui-integration

# 推送到远端
git push origin main
git push origin --delete feat/w4-l2-dual-agent feat/w7-login-mine feature/ui-integration
```

**注意**：`git branch -d` 只会删除已合并的分支；若提示未合并，加 `-D` 强删需谨慎确认。

## 9. 提审前最终自查

逐项打勾后再点提交审核：

- [ ] 服务类目已选
- [ ] 隐私指引已声明（且与代码 grep 结果一致）
- [ ] AI 专项声明已提交
- [ ] `securityCheck` 云函数权限已确认
- [ ] `cleanupData` 触发器已生效
- [ ] 数据库索引已建立
- [ ] topics_v1 已运营导入完整白名单
- [ ] tabBar 选中态图标已补齐（可选，影响审核员观感）
- [ ] 主包 <2MB（整改后 ~1.7MB）
- [ ] `npm run lint` 通过
- [ ] `npm run verify` 通过
- [ ] 真机走通 L1 / L2 / L3 三条主路径
- [ ] 真机触发一次敏感词输入，验证 msgSecCheck 拦截生效
- [ ] 真机触发一次敏感话题引导 AI 输出，验证 finish_reason=sensitive 撤回 + 二次过审撤回

## 10. 提审被驳回后的应对

常见驳回原因与对应整改：

| 驳回理由 | 整改动作 |
|---------|---------|
| "缺少 AI 标识" | 检查 chat-stream 组件 `showAiLabel="{{true}}"` 是否所有 AI 气泡都传了 |
| "用户输入未审核" | grep 全仓 `msgSecCheck` 调用点，确保三个入口都覆盖 |
| "隐私指引不符" | 对照代码 grep 出的 wx API 与后台声明逐项核对 |
| "存在违规内容"（具体样本） | 把样本加入 prompts/evals/cases.json 注入测试用例，跑 evalRunner 回归 |
| "类目不符" | 重新选择类目，可能需要补充资质材料 |

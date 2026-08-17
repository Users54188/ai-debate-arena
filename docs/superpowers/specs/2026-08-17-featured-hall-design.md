# 「精彩思辨」展馆 — 设计文档

> **版本**: v1.0 (2026-08-17)
> **状态**: 设计已确认，待写实施计划
> **范围**: 赛后迭代功能开发，**赛前不发布**（不影响赛前审核节奏与 UGC 风险评估）
> **作者**: brainstorming session 协作产出

---

## 一、背景与动机

### 1.1 项目上下文

「思辨场」是 2026 微信小程序开发大赛参赛作品（截止 2026-10-17），三种思辨模式：L1 苏格拉底追问 / L2 双人共修 / L3 三方辩论。已有完整核心闭环：对话 → 落库 → 报告 → 海报分享 → 段位系统。

### 1.2 原计划的社交功能

`docs/tech-roadmap-v2.md:21,271` 明确把「话题广场 / 群聊辩论赛」移到**赛后迭代**，理由：

- AI 类小程序合规要求最严，UGC 内容审核风险高
- 赛前所有辩题锁定在 `topics_v1` 白名单，从源头消除 UGC 风险
- 给赛前审核让路（举报入口 / 审核后台 / 违规处置流程都未实现）

### 1.3 本次需求的取舍

本次需求源自「加上论坛等后续功能」的指令。经 brainstorming 澄清：

- 不做完整 UGC 论坛（赛前风险太高）
- 做**只读展示页**「精彩思辨」，保留社区氛围体验
- 工期短（约 2-3 天），**不影响赛前审核**
- 赛后即可上线作为社交闭环第一块拼图

---

## 二、用户故事

### 2.1 主要场景

1. **用户公开自己的报告**
   - 用户在 `pages/report` 查看自己刚生成的报告
   - 看到复选框「公开到精彩思辨」（默认未勾）
   - 勾选后调云函数，报告进入展馆
   - 取消勾选即从展馆下架

2. **浏览展馆**
   - 用户在首页三种思辨模式卡片（L1/L2/L3）下方看到「精彩思辨」入口卡片
   - 点击进入展馆页，默认显示「热门」tab
   - 可切换到「最新」tab
   - 列表项显示：思辨分数、模式标签（L1/L2/L3）、作者秩位（匿名）、报告摘要前 80 字、点赞数、浏览量

3. **查看详情**
   - 点击列表项进入详情页
   - 上半屏：完整报告（reportText + score + strategyTags + fallacies 等）
   - 中部：「展开对话原文」按钮，点击后异步拉取 transcript 并展示（带"以下对话原文可能含敏感观点"提示）
   - 底部：点赞按钮（已点赞则显示"已赞"，可取消）

### 2.2 边界与不做的事

**不做**:
- ❌ 用户发帖 / 评论（涉及 UGC，赛前风险高）
- ❌ 关注用户 / 私信（社交闭环放到下一阶段）
- ❌ 热度算法推荐（用简单的 score × 时间衰减）
- ❌ 搜索 / 标签筛选（MVP 阶段不必要）
- ❌ 举报入口（赛后迭代加入，与论坛功能同期上线）
- ❌ 头像 / 昵称展示（隐私优先）

**做**:
- ✅ 报告公开 / 取消公开
- ✅ 展馆列表（热门 + 最新）
- ✅ 详情查看（报告 + 可选展开对话）
- ✅ 点赞（按 openid 去重，可取消）
- ✅ 浏览量（每次进入详情 +1）
- ✅ 匿名化（仅展示秩位）

---

## 三、数据模型

### 3.1 `reports` 集合新增字段

```js
{
  // ... 现有字段保持不变 ...
  isPublic: false,           // bool, 默认 false — 是否公开到展馆
  publishedAt: null,         // date or null — 公开时间（首次勾选时写入，用于"最新"tab排序）
  viewCount: 0,              // int, 默认 0 — 浏览量
  likeCount: 0,              // int, 默认 0 — 点赞数
  // rank 字段已有（来自 reports.mode + score 推断），不需新增
}
```

迁移策略：现有 reports 文档不批量更新；新字段在用户首次勾选公开时由云函数写入；列表查询用 `where isPublic=true` 自动过滤。

### 3.2 新建 `featured` 集合（公开镜像）

```js
{
  _id: "<auto>",
  reportId: "<reports._id>",
  openid: "<作者 openid>",  // 用于归属校验（云函数内部用，绝不返回给客户端）
  mode: "L1" | "L2" | "L3",
  score: 85,
  rank: "白银",             // 作者秩位快照（公开时写入，不随后续段位变化更新）
  reportText: "...",        // 报告正文（已过 msgSecCheck）
  topic: "...",             // 命题（仅 L3）
  // 排序字段
  hotScore: 85.0,           // score × 时间衰减（云函数写入时计算）
  publishedAt: <date>,
  // 计数（与 reports 同步）
  viewCount: 0,
  likeCount: 0,
  // 安全：transcript 不镜像；详情页通过 reports 取（带归属校验）
  // 安全：openid 字段仅服务端可见，所有返回给客户端的接口必须显式剔除
  createdAt: <serverDate>,
  updatedAt: <serverDate>,
}
```

**索引建议**:
- `(publishedAt desc)` — 用于「最新」tab
- `(hotScore desc)` — 用于「热门」tab
- `reportId` 唯一索引 — 防重复镜像

### 3.3 新建 `featured_likes` 集合（点赞去重）

```js
{
  _id: "<auto>",
  openid: "<点赞者 openid>",
  reportId: "<reports._id>",
  createdAt: <serverDate>,
}
```

**复合唯一约束**: `(openid, reportId)` — 通过云函数查询去重（CloudBase 不支持复合索引唯一约束，由云函数先查后写实现）。

### 3.4 数据一致性策略

**写入路径**（用户公开报告）:
```
pages/report → featured.publish 云函数
  → msgSecCheck(reportText, scene=2)
  → reports.update({ isPublic: true, publishedAt, viewCount:0, likeCount:0 })
  → featured.add({ ...镜像 })
```

**取消公开**:
```
featured.unpublish 云函数
  → reports.update({ isPublic: false })
  → featured.remove({ reportId })
  → featured_likes.remove({ reportId })  // 同时清理点赞记录
```

**点赞 / 浏览量同步**:
- `featured.like / view` 云函数同时更新 `featured` 与 `reports` 集合的计数
- 不强一致：用 `_.inc(1)` 原子自增，最大误差 1（容忍）
- 若同步失败：以 `featured` 集合为准，`reports` 集合只是冗余

---

## 四、API 设计

### 4.1 新增 `featured` 云函数

**接口契约**:

| action | 入参 | 返回 | 说明 |
|---|---|---|---|
| `list` | `{ tab: "hot"\|"new", cursor?, limit? }` | `{ items: [...], nextCursor }` | 展馆列表分页（cursor-based） |
| `detail` | `{ reportId }` | `{ report, author }` | 详情（不含 transcript） |
| `transcript` | `{ reportId }` | `{ transcript, sessionId }` | 拉取对话原文（带合规声明，需用户主动调用） |
| `publish` | `{ reportId }` | `{ ok }` | 公开报告（msgSecCheck 后写 featured） |
| `unpublish` | `{ reportId }` | `{ ok }` | 取消公开 |
| `like` | `{ reportId }` | `{ liked: bool, likeCount }` | 点赞 / 取消点赞（toggle） |
| `view` | `{ reportId }` | `{ ok }` | 浏览量 +1（详情页 onLoad 时调用） |

**归属校验**:
- `publish/unpublish`: 必须本人（`reports.openid === OPENID`）
- `detail/transcript`: 任何人可查（毕竟是公开报告），但 `transcript` 仅供当前用户主动展开
- `like/view`: 任何人可调用

**字段脱敏（强制）**:
- 所有返回给客户端的接口必须显式剔除 `openid` 字段（用解构或白名单字段返回）
- 列表项只能返回: `reportId / mode / score / rank / reportText(摘要) / topic / viewCount / likeCount / publishedAt`
- 详情接口只能返回: 上述 + 完整 `reportText`，绝不返回 `openid`
- 客户端不应能通过任何接口拿到作者 openid

**安全要点**:
- `publish` 前必须对 `reportText` 做 `msgSecCheck(scene=2)`，违规内容拒绝公开
- `transcript` 仅供查看公开报告的对话原文，但**不再做归属校验**（公开报告即意味着对话也已公开授权）
- 但仍要在 UI 上提示「以下对话原文可能含敏感观点，仅供参考」

### 4.2 修改 `generateReport` 云函数

返回数据新增字段:
```js
{
  code: 0,
  data: {
    report: {
      // ... 现有字段 ...
      isPublic: false,        // 新增（默认 false）
      publishedAt: null,      // 新增
      viewCount: 0,           // 新增
      likeCount: 0,           // 新增
    },
    // ... 现有 ...
  },
}
```

无需修改报告生成逻辑，仅在返回前补默认值即可。

---

## 五、页面与组件

### 5.1 新增 `pages/featured/index`（展馆列表页）

**文件**:
- `index.js` — 状态机、分页、tabs、下拉刷新
- `index.wxml` — 两 tab + 列表
- `index.wxss` — 星夜紫调（与全应用一致）
- `index.json` — 引用 `star-field`, `empty-state`

**数据**:
```js
data: {
  activeTab: "hot",     // "hot" | "new"
  items: [],            // 列表项
  cursor: null,         // 分页游标
  loading: false,
  noMore: false,
  refreshTop: 0,        // 顶部刷新位置（下拉刷新）
}
```

**列表项渲染**:
- 左：评分环缩略（score 数字 + 圆圈）
- 右：模式标签 + 秩位 + 摘要前 80 字 + 👍 数 + 👀 浏览量 + 公开时间相对显示

### 5.2 新增 `pages/featured-detail/index`（展馆详情页）

**文件**:
- `index.js` — 加载详情、加载 transcript、点赞、浏览量
- `index.wxml` — 报告卡片 + 「展开对话原文」按钮 + 点赞条
- `index.wxss`
- `index.json`

**数据**:
```js
data: {
  reportId: "",
  report: null,
  author: { rank: "白银" },     // 仅秩位
  transcriptExpanded: false,    // 是否已展开 transcript
  transcript: [],
  transcriptLoading: false,
  liked: false,
  likeCount: 0,
  viewCount: 0,
  loading: true,
  loadError: "",
}
```

**生命周期**:
- `onLoad`: 调 `featured.detail` 加载报告 → 调 `featured.view` 浏览量 +1
- 「展开对话原文」按钮点击: 调 `featured.transcript` 拉原文
- 点赞按钮点击: 调 `featured.like` toggle，更新 `liked` 与 `likeCount`

### 5.3 修改 `pages/index/index.wxml`

在三种思辨模式卡片（L1 苏格拉底 / L2 双人 / L3 辩论）下方加入口卡片：
```xml
<view class="mode glass-card featured-entry" bindtap="goFeatured" hover-class="card-hover">
  <view class="mode-side">
    <view class="mode-mark mark-featured">★</view>
  </view>
  <view class="mode-main">
    <text class="mode-title">精彩思辨</text>
    <text class="mode-desc">看看其他思辨者的报告与对话</text>
    <view class="mode-foot">
      <text class="chip chip-featured">展馆</text>
      <text class="mode-arrow">进入 ›</text>
    </view>
  </view>
</view>
```

新增 `goFeatured` 方法:
```js
goFeatured() {
  wx.navigateTo({ url: "/pages/featured/index" });
}
```

### 5.4 修改 `pages/report/index.wxml` 与 `index.js`

在海报按钮上方加复选框:
```xml
<view class="publish-row" wx:if="{{report && !isShareView}}">
  <checkbox-group bindchange="onPublishChange">
    <label class="publish-label">
      <checkbox value="1" checked="{{report.isPublic}}" color="#9D6BFF" />
      <text>公开到精彩思辨展馆（其他人可查看你的报告与对话）</text>
    </label>
  </checkbox-group>
</view>
```

`onPublishChange` 方法根据 checkbox 状态调 `featured.publish` 或 `featured.unpublish`。

### 5.5 新增图片资源

- `images/featured.png` — 展馆入口图标（首页卡片用）

可以暂用 emoji ★ 字符替代，避免引入新图片资产。

---

## 六、合规要点

### 6.1 内容安全

- **公开前审核**: `featured.publish` 必须对 `reportText` 做 `msgSecCheck(scene=2)`，违规内容拒绝公开并提示用户
- **transcript 安全声明**: 详情页展开对话原文前，UI 上明确提示「以下对话原文由 AI 与用户共同生成，可能含敏感观点，仅供参考」
- **二次审核**: 公开后定期跑批审核？MVP 不做，依赖用户举报（赛后迭代补举报入口）

### 6.2 隐私保护

- **匿名化**: 展馆列表与详情均不展示头像 / 昵称 / openid / 用户标识，仅展示秩位（"白银思辨者"等）
- **opt-in**: 用户主动勾选才公开，默认所有报告私有
- **可撤回**: 取消公开即从展馆下架，列表与详情都不再可见
- **transcript 不镜像**: `featured` 集合只存报告摘要，对话原文只在 `reports` 集合，且通过云函数按需拉取（便于撤回）

### 6.3 数据库权限

- `reports`: 维持现有私有权限（仅创建者可读写）
- `featured`: 设为「仅创建者可读写」+ 所有读取通过云函数（云函数有 admin 权限）
- `featured_likes`: 同上
- **不放权给客户端直读 featured**，避免被绕过查到非公开内容

---

## 七、错误处理

| 场景 | 处理 |
|---|---|
| `featured.list` 网络失败 | 显示空状态 + 重试按钮 |
| `featured.detail` 报告不存在 | 显示「该报告已被作者下架」+ 返回按钮 |
| `featured.publish` msgSecCheck 失败 | 提示「报告内容含敏感信息，无法公开」+ 不修改 checkbox 状态 |
| `featured.publish` 已被他人下架（race） | 提示「操作失败，请刷新页面重试」 |
| `featured.like` 重复点击防抖 | 500ms 内只接受一次（前端） |
| `featured.transcript` 加载失败 | 显示「对话原文加载失败」+ 重试 |

---

## 八、性能与扩展

### 8.1 分页

- 列表用 cursor-based 分页（不用 skip，性能更好）
- 每页 20 条
- cursor 为最后一条的 `publishedAt` 或 `hotScore`（取决于 tab）

### 8.2 索引

`featured` 集合需要建:
- `publishedAt` 索引（用于「最新」tab 排序）
- `hotScore` 索引（用于「热门」tab 排序）

### 8.3 热度算法

```
hotScore = score × timeDecay
timeDecay = 1 / (1 + log10(1 + daysSincePublished))
```

示例:
- 发布当天（days=0）: timeDecay=1，score=85 → hotScore=85
- 发布 7 天后: timeDecay=1/(1+log10(8))=1/1.9≈0.53，score=85 → hotScore≈45
- 发布 30 天后: timeDecay=1/(1+log10(31))=1/2.5≈0.4，score=85 → hotScore≈34

简化版可在每次 publish 时计算并写入，无需后台批处理。

### 8.4 缓存策略

MVP 不做缓存。如果赛后数据量上来再加:
- 「热门」列表每小时由定时器云函数刷新缓存
- 详情页客户端本地缓存 5 分钟

---

## 九、迁移与部署

### 9.1 数据库迁移

**手动操作**:
1. 在 CloudBase 控制台创建 `featured` 集合
2. 创建 `featured_likes` 集合
3. 设置集合权限为「仅创建者可读写」（实际所有访问走云函数）

**自动兼容**:
- 现有 reports 文档无需批量更新
- 新字段 `isPublic/publishedAt/viewCount/likeCount` 在首次勾选时由云函数写入
- 列表查询用 `where isPublic=true` 自动兼容老数据（查不到即未公开）

### 9.2 部署顺序

1. 部署新版云函数（`featured` 新建 + `generateReport` 更新）
2. 在控制台手动建集合 + 索引
3. 发布小程序（赛前 / 赛后视战略决定）

### 9.3 回滚

- 删除 `featured` 云函数与集合即可完全回滚
- `reports` 新字段不影响现有功能（默认 false / 0 / null）

---

## 十、验收标准

### 10.1 功能验收

- [ ] 用户在报告页可勾选「公开到精彩思辨」复选框
- [ ] 勾选后约 2 秒内 `featured` 集合新增一条记录
- [ ] 取消勾选后 `featured` 与 `featured_likes` 集合对应记录被删除
- [ ] 首页可见「精彩思辨」入口卡片，点击进入展馆
- [ ] 展馆默认显示「热门」tab，可切换到「最新」tab
- [ ] 列表项匿名展示（无头像 / 昵称 / openid）
- [ ] 点击列表项进入详情，可见完整报告
- [ ] 详情页点击「展开对话原文」可见 transcript
- [ ] 详情页点赞按钮可点击，「已点赞」状态正确切换
- [ ] 浏览量每次进入详情正确 +1

### 10.2 安全验收

- [ ] 用他人 reportId 调 `featured.publish` 返回 `not owned`
- [ ] 公开含违规字符的报告被 `msgSecCheck` 拦截
- [ ] 客户端无法绕过云函数直接读 `featured` 集合（权限校验）
- [ ] 列表 / 详情接口不返回作者 openid / 昵称 / 头像

### 10.3 性能验收

- [ ] 列表首屏加载 < 1.5s
- [ ] 详情页加载 < 2s
- [ ] transcript 展开加载 < 3s

---

## 十一、未来扩展

预留接口与数据结构，赛后论坛迭代可在此基础上扩展:

- **评论**: 新建 `featured_comments` 集合（结构类似 `featured_likes` + content 字段）
- **关注**: 新建 `follows` 集合（follower + following 双向索引）
- **举报**: 新建 `reports_abuse` 集合 + 后台审核页
- **话题标签**: `featured.tags` 数组字段 + `featured_tags` 索引集合

---

## 十二、决策日志

| # | 决策 | 理由 |
|---|---|---|
| 1 | 不做完整 UGC 论坛 | 赛前 UGC 审核风险高，原路线图已明确移到赛后 |
| 2 | 只读展馆 + opt-in 公开 | 保留社区氛围体验，零默认隐私风险 |
| 3 | 引入 `featured` 镜像集合 | `reports` 含敏感对话原文，权限不动；镜像集合便于排序优化 |
| 4 | 匿名化（仅秩位） | 思辨对话可能含敏感观点，实名暴露压力大 |
| 5 | 不展示头像 / 昵称 / openid | 隐私优先，赛后论坛功能再放宽 |
| 6 | transcript 不镜像 | 便于撤回公开时即时生效 |
| 7 | 用云函数代理所有 featured 访问 | 集合权限设私有，强制走云函数 admin 权限 |
| 8 | 热度算法用 score × log 时间衰减 | 简单有效，新内容有曝光机会，高分老内容仍可见 |

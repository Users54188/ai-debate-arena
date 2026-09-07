# 主包体积优化清单

> 状态更新：2026-09-05
> 主包体积：**1467KB**（已低于 1.5MB 限制，余量 69KB）

## 已自动优化

| 项目 | 节省 | 方式 |
|---|---|---|
| `exit-btn.jpeg` | **152KB** | 删除图片，改用纯 CSS 圆形玻璃态 × 按钮（视觉一致） |

## 待手动压缩（强烈建议，扩大余量）

> 工具推荐：[tinypng.com](https://tinypng.com/)（免费，PNG/JPEG 都支持，无注册即用）
> 上限：单图片压缩前后保留同名，覆盖原文件即可。

| 文件 | 当前 | 目标 | 说明 |
|---|---|---|---|
| `images/header-logo.png` | 413KB | **≤80KB** | 首页 hero，PNG 透明背景。建议用 tinypng 压缩；若背景可改为深色，可改 JPEG 进一步降到 50KB |
| `images/rank-bronze.png` | 138KB | **≤30KB** | 段位徽章，所有用户初始都会加载；用 tinypng |
| `images/rank-silver.png` | 143KB | **≤30KB** | 段位徽章；用 tinypng |
| `images/rank-gold.png` | 148KB | **≤30KB** | 段位徽章（gold/platinum/diamond/king 共用）；用 tinypng |
| `images/poster-bg.jpeg` | 157KB | **≤50KB** | report 页分享海报背景；用 tinypng 或导出时质量 75% |
| `images/socrates-avatar.jpeg` | 70KB | **≤30KB** | 头像；用 tinypng |
| `images/l1-badge.jpeg` | 40KB | **≤15KB** | 模式徽章；用 tinypng |
| `images/l2-badge.jpeg` | 31KB | **≤15KB** | 模式徽章；用 tinypng |
| `images/l3-badge.jpeg` | 31KB | **≤15KB** | 模式徽章；用 tinypng |

执行完上面 9 项后预计主包：**1467KB − 约 970KB = 约 500KB**（极致余量）

## 进阶方案（暂未实施）

如果未来再超 1.5MB，可考虑：

### 方案 1：段位徽章按需加载
当前 `rank-{bronze,silver,gold}.png` 共 429KB，但用户只会是其中一个段位。
可改成只加载用户当前段位的图：

```js
// 当前已部分实现：pages/index/index.js + pages/ranking/index.js 已根据 classify 选图
// 进一步优化：把 3 张徽章移到子包，初次加载只下载当前段位的 1 张（节省约 280KB）
```

### 方案 2：图片资源整体移入分包
在 `app.json` 增加 `subpackages`，把所有非首屏图片（poster-bg、socrates-avatar、l1/l2/l3-badge 等）
放到独立资源子包，首屏只加载 header-logo + 当前段位徽章。

### 方案 3：tabBar 图标零优化
当前 tabBar 6 张 PNG 共约 6KB，已极致，无需处理。

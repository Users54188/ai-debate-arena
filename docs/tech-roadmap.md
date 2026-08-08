# AI「思辨场」— 技术路径规划

> 基于产品方案 v1.0 | 2026-08-08

---

## 一、技术栈总览

### 1.1 选型矩阵

| 层级 | 技术选型 | 说明 |
|------|------|------|
| 前端框架 | 微信小程序原生 + ChatUI Kit | 原生性能最优，ChatUI Kit是官方对话组件 |
| UI 组件 | WeUI 2.0 | 微信风格，与ChatUI Kit风格统一 |
| 状态管理 | 小程序全局 app.globalData | 轻量场景无需引入MobX/Redux |
| 后端 | CloudBase 云开发（腾讯云） | 免费额度覆盖开发期；云函数+云数据库+云存储 |
| 云函数语言 | Node.js 18 | CloudBase原生支持，NPM生态丰富 |
| 数据库 | CloudBase 文档型数据库 | 无需自建MySQL，JSON文档灵活 |
| LLM 接口 | 腾讯混元 Hy3 API | 微信AI成长计划10亿Token免费 |
| 端侧推理 | 微信基础库3.8.0 Inference API | 3亿参数端侧模型 |
| 图片生成 | Canvas 2D + 云函数拼装 | 避免消耗AI生图额度 |
| 版本管理 | GitHub | 已建仓库 |

### 1.2 免费额度覆盖确认

| 资源 | 需求量级 | 免费额度 | 是否够 |
|------|:---:|:---:|:---:|
| LLM Token | 3000/次/人，日活2000→600万/天 | 10亿总计 | 167天 |
| 云函数调用 | ~10万次/月 | 10万次/月(免费) | 刚好 |
| 云数据库读 | ~50万次/月 | 5万次/天(免费) | 够 |
| 云数据库写 | ~5万次/月 | 3万次/天(免费) | 够 |
| 云存储 | ~200MB | 5GB(免费) | 够 |

> 唯一风险点：云函数调用次数与免费额度刚好持平，W8压力测试时需重点关注。

---

## 二、项目目录结构

```
ai-debate-arena/
├── miniprogram/                    # 小程序前端
│   ├── app.js                      # 入口
│   ├── app.json                    # 全局配置
│   ├── app.wxss                    # 全局样式
│   ├── pages/
│   │   ├── index/                  # 首页（三层入口）
│   │   │   ├── index.js
│   │   │   ├── index.wxml
│   │   │   └── index.wxss
│   │   ├── socrates/               # L1 单人磨刀
│   │   │   ├── socrates.js         # 核心对话逻辑
│   │   │   ├── socrates.wxml       # ChatUI Kit 对话界面
│   │   │   └── socrates.wxss
│   │   ├── dual/                   # L2 双人共修
│   │   │   ├── dual.js
│   │   │   ├── dual.wxml
│   │   │   └── dual.wxss
│   │   ├── debate/                 # L3 辩论场
│   │   │   ├── debate.js
│   │   │   ├── debate.wxml
│   │   │   └── debate.wxss
│   │   ├── report/                 # 思辨报告页
│   │   │   ├── report.js
│   │   │   └── report.wxml
│   │   ├── ranking/                # 段位排行榜
│   │   │   ├── ranking.js
│   │   │   └── ranking.wxml
│   │   └── topic/                  # 话题广场
│   │       ├── topic.js
│   │       └── topic.wxml
│   ├── components/                 # 自定义组件
│   │   ├── debate-stage/           # 辩论舞台组件
│   │   ├── score-board/            # 段位展示组件
│   │   └── share-poster/           # 战绩海报组件
│   ├── utils/
│   │   ├── cloud.js                # 云函数调用封装
│   │   ├── llm.js                  # LLM接口封装
│   │   ├── inference.js            # 端侧推理封装
│   │   └── audio.js                # 语音输入（可选）
│   └── assets/                     # 图片/音频资源
│
├── cloudfunctions/                 # 云函数
│   ├── socratesSession/            # L1 苏格拉底对话
│   │   ├── index.js
│   │   └── package.json
│   ├── dualSession/                # L2 双Agent编排
│   │   ├── index.js
│   │   └── package.json
│   ├── debateSession/              # L3 三Agent辩论
│   │   ├── index.js
│   │   └── package.json
│   ├── generateReport/             # 思辨报告生成
│   │   ├── index.js
│   │   └── package.json
│   ├── generatePoster/             # 战绩海报生成
│   │   ├── index.js
│   │   └── package.json
│   └── userProfile/                # 用户数据管理
│       ├── index.js
│       └── package.json
│
├── prompts/                        # System Prompt 库
│   ├── socrates.md                 # 苏格拉底角色
│   ├── expert_common.md            # 通用专家
│   ├── expert_science.md           # 科学类专家
│   ├── expert_humanities.md        # 人文类专家
│   ├── expert_tech.md              # 技术类专家
│   ├── debater_affirmative.md      # 辩论正方
│   ├── debater_negative.md         # 辩论反方
│   └── judge.md                    # 辩论裁判
│
├── docs/
│   ├── product-plan.md             # 产品方案
│   └── tech-roadmap.md             # 本文档
│
├── project.config.json             # 微信开发者工具配置
└── README.md
```

---

## 三、核心模块设计

### 3.1 对话引擎（最核心）

```
┌──────────────────────────────────────────┐
│              前端（小程序）                │
│  ┌─────────┐  ┌──────────────────────┐   │
│  │端侧推理  │  │  ChatUI Kit 对话组件  │   │
│  │(3亿参数) │  │  - 单人模式(单角色)    │   │
│  │---------│  │  - 双人模式(双角色交替) │   │
│  │逻辑谬误  │  │  - 辩论模式(三角色同屏) │   │
│  │论证提取  │  │                      │   │
│  │情感检测  │  │                      │   │
│  └────┬────┘  └──────────┬───────────┘   │
│       │                  │               │
├───────┼──────────────────┼───────────────┤
│       ▼                  ▼               │
│  ┌──────────── 云函数 ────────────────┐   │
│  │  ┌─────────────────────────────┐   │   │
│  │  │      Agent 编排层           │   │   │
│  │  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐  │   │   │
│  │  │  │L1 │ │L2 │ │L3 │ │报告│  │   │   │
│  │  │  └───┘ └───┘ └───┘ └───┘  │   │   │
│  │  └─────────────┬───────────────┘   │   │
│  │                ▼                   │   │
│  │  ┌─────────────────────────────┐   │   │
│  │  │      对话状态管理            │   │   │
│  │  │  - 轮次计数器                │   │   │
│  │  │  - 对话摘要缓存(最近20轮)    │   │   │
│  │  │  - 角色切换状态              │   │   │
│  │  └─────────────────────────────┘   │   │
│  └────────────────────────────────────┘   │
│                   │                       │
│                   ▼                       │
│         ┌─────────────────┐               │
│         │  混元 Hy3 LLM   │               │
│         │  - 标准对话接口  │               │
│         └─────────────────┘               │
└──────────────────────────────────────────┘
```

### 3.2 端侧推理分流机制

```
用户输入一句话
      │
      ▼
┌──────────────┐
│ 端侧推理引擎   │  ← 3亿参数模型，本地运行，零延迟
│               │
│ 1. 逻辑谬误检测 │  → 返回：[滑坡谬误/混淆因果/稻草人/无谬误]
│ 2. 论证框架提取 │  → 返回：{主张, 前提, 推理链, 预设}
│ 3. 情感倾向检测 │  → 返回：{倾向, 强烈程度 1-5}
│               │
└──────┬────────┘
       │
       ├── 置信度 ≥ 0.8 ──→ 直接注入LLM context，不额外消耗Token
       │
       └── 置信度 < 0.8 ──→ 标记为"待云端复核"，随用户输入
                            一起发给LLM做联合判断
```

**关键指标**：端侧推理模型处理一次输入约50ms，云端LLM一次往返约1500ms。端侧分流后，用户体感延迟从1500ms降至400ms（端侧50ms + 云端对话350ms，因为云端不需要做分析工作）。

### 3.3 多Agent编排核心逻辑

#### L1 单人模式（单Agent）

```javascript
// cloudfunctions/socratesSession/index.js
exports.main = async (event) => {
  const { userInput, sessionId, debateReport } = event;

  // 1. 加载对话状态
  const session = await db.collection('sessions').doc(sessionId).get();
  const history = session.data.summary; // 最近20轮摘要

  // 2. 解析端侧推理结果
  const fallacyResult = debateReport.fallacy;
  const argumentFrame = debateReport.argument;

  // 3. 组装 context
  const messages = [
    { role: "system", content: SOCRATES_PROMPT },
    ...history,
    {
      role: "user",
      content: `[论证框架] ${argumentFrame}\n[谬误标记] ${fallacyResult}\n[用户输入] ${userInput}`
    }
  ];

  // 4. 调用 LLM
  const reply = await hy3.chat(messages);
  const newRound = { round: session.data.round + 1, ... };

  // 5. 更新会话状态
  await db.collection('sessions').doc(sessionId).update({
    summary: db.command.push(newRound),
    round: db.command.inc(1)
  });

  return { reply, round: newRound.round };
};
```

#### L2 双人模式（双Agent串行）

```javascript
// cloudfunctions/dualSession/index.js
exports.main = async (event) => {
  const { userInput, sessionId, topic } = event;

  // 1. 选择专家角色
  const expertPrompt = selectExpert(topic); // 按话题匹配专家

  // 2. 专家先讲
  const expertReply = await hy3.chat([
    { role: "system", content: expertPrompt },
    { role: "user", content: `请向用户讲解：${userInput}` }
  ]);

  // 3. 苏格拉底追问（以专家回答为上下文）
  const socratesReply = await hy3.chat([
    { role: "system", content: SOCRATES_DUAL_PROMPT },
    { role: "user", content: `专家刚说：${expertReply}\n请向用户提出1-2个追问` }
  ]);

  return {
    expertReply,
    socratesReply,
    expertRole: topicToExpert[topic] || '通用学者'
  };
};
```

#### L3 辩论模式（三Agent串行，单轮3步）

```javascript
// cloudfunctions/debateSession/index.js
exports.main = async (event) => {
  const { topic, round, lastAffirmative, lastNegative } = event;

  const context = `辩题：${topic}`;

  // Step 1: 正方发言（需回应反方上一轮）
  const affirmative = await hy3.chat([
    { role: "system", content: AFFIRMATIVE_PROMPT },
    { role: "user", content: `${context}\n上一轮反方观点：${lastNegative || '(首轮)'}\n请正方发言` }
  ]);

  // Step 2: 反方发言（需回应正方）
  const negative = await hy3.chat([
    { role: "system", content: NEGATIVE_PROMPT },
    { role: "user", content: `${context}\n正方刚说：${affirmative}\n请反方反驳` }
  ]);

  // Step 3: 裁判点评
  const judge = await hy3.chat([
    { role: "system", content: JUDGE_PROMPT },
    { role: "user", content: `${context}\n正方：${affirmative}\n反方：${negative}\n请裁判点评本轮` }
  ]);

  return { round, affirmative, negative, judge };
};
```

### 3.4 数据模型

#### CloudBase 数据库集合设计

```
sessions（会话表）
├── _id: string (自动)
├── userId: string          # 微信openid
├── mode: "socrates"|"dual"|"debate"
├── topic: string           # 话题/观点
├── summary: array          # 对话摘要 [{role, content}, ...]
├── round: number           # 当前轮次
├── status: "active"|"ended"
├── createdAt: date
└── updatedAt: date

reports（思辨报告表）
├── _id: string
├── userId: string
├── sessionId: string
├── mode: string
├── logicChain: object      # 逻辑链 {nodes, edges}
├── fallacies: array        # 识别的谬误 [{type, example}]
├── score: number           # 思辨评分 0-100
├── highlights: array       # 精彩片段
├── createdAt: date
└── shared: boolean         # 是否已分享

users（用户表）
├── _id: string (openid)
├── nickname: string
├── avatar: string
├── rank: "bronze"|"silver"|"gold"|"diamond"
├── totalSessions: number
├── totalRounds: number
├── avgScore: number
├── winRate: number         # 辩论胜率
└── createdAt: date

topics（话题表）
├── _id: string
├── title: string           # 话题标题
├── category: string        # 科技/人文/社会/哲学/娱乐
├── difficulty: 1|2|3      # 难度
├── submitterId: string
├── voteCount: number
└── createdAt: date
```

---

## 四、分周技术实施计划

### W1：环境搭建（7.17-7.23）

**目标**：所有开发环境就绪，项目骨架可运行。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 微信开发者工具安装配置 | 可新建/预览小程序 | 0.5d |
| CloudBase环境创建 | 环境ID、API密钥 | 0.5d |
| 微信AI成长计划报名 | Token配额开通 | 0.5d |
| GitHub仓库关联本地 | 项目结构初始化 | 0.5d |
| ChatUI Kit引入 | npm包安装，hello world | 0.5d |
| 云函数模板创建 | 6个云函数骨架部署 | 1d |
| 数据库集合初始化 | 4个集合索引创建 | 0.5d |
| 项目配置完成 | app.json、权限声明 | 0.5d |

**关键坑位**：
- CloudBase环境必须选上海地域（混元API最近节点）
- ChatUI Kit需在`project.config.json`中开启`npm`支持后构建
- 端侧推理API需要在`app.json`声明`wx.inference`权限

**W1里程碑**：云端Hello World跑通（小程序→云函数→混元API→返回"你好，思辨场"）

---

### W2：核心对话（7.24-7.30）

**目标**：单人苏格拉底模式对话链路跑通。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 苏格拉底Prompt精调 | socrates.md定稿 | 2d |
| ChatUI Kit对话界面 | 单人模式聊天页 | 1d |
| socratesSession云函数 | 对话引擎核心逻辑 | 1.5d |
| 对话摘要存储与加载 | sessions表读写 | 0.5d |
| 轮次控制 | 5-15轮自动结束 | 0.5d |
| 错误处理 | 网络异常/超时/重试 | 0.5d |

**Prompt设计要点（苏格拉底角色）**：

```
你是苏格拉底·马尔维斯，一位只用提问来教学的思辨导师。
你的唯一工具就是提问。

核心原则：
1. 永远不直接给出答案、评价或判断
2. 从不复述用户的观点，而是质疑其背后的预设
3. 每次追问只聚焦一个逻辑环节
4. 语气冷静、尊重，但毫不留情
5. 当用户表现出困惑时，换一个角度提问，而非解释

禁止行为：
- 说"你说得对"或"你错了"
- 给出自己的观点或知识
- 使用感叹号
- 回答超过3句话（保持追问简短有力）

追问策略（按优先级）：
1. 追问预设："你这句话里藏着什么假设？"
2. 追问证据："有什么事实可以支撑这个判断？"
3. 追问边界："在什么情况下这个说法不成立？"
4. 追问后果："如果所有人都这样做，会发生什么？"
5. 追问定义："你说的'XX'具体指什么？"
```

**W2里程碑**：可以完整走完一次5轮苏格拉底追问，对话不中断。

---

### W3：端侧推理集成（7.31-8.6）

**目标**：端侧推理模型接入，实现70%分流。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 端侧推理API接入 | wx.inference调用封装 | 1d |
| 逻辑谬误分类器 | 7种常见谬误检测 | 1.5d |
| 论证框架提取 | 主张-前提-推理链结构化 | 1d |
| 置信度分流逻辑 | ≥0.8端侧/＜0.8云端 | 0.5d |
| 端侧结果下钻展示 | 用户可看到自己的论证结构 | 0.5d |
| 端侧失败兜底 | 端侧不可用时全走云端 | 0.5d |

**端侧推理调用示例**：

```javascript
// miniprogram/utils/inference.js
const inference = {
  // 逻辑谬误分类
  async detectFallacy(text) {
    try {
      const res = await wx.inference.classify({
        model: 'fallacy_detector_v1',  // 需自行训练或使用内置模型
        text: text
      });
      return {
        type: res.label,       // '滑坡谬误' | '稻草人' | '混淆因果' | '无'
        confidence: res.score
      };
    } catch {
      return { type: '检测失败', confidence: 0 };
    }
  },

  // 论证框架提取
  async extractArgument(text) {
    try {
      const res = await wx.inference.extract({
        model: 'argument_parser_v1',
        text: text
      });
      return {
        claim: res.claim,
        premises: res.premises || [],
        reasoning: res.reasoning || '',
        assumptions: res.assumptions || []
      };
    } catch {
      return { claim: text, premises: [], reasoning: '', assumptions: [] };
    }
  }
};
```

> **注意**：端侧推理的具体模型名称以微信基础库3.8.0实际开放的API为准。若内置模型不覆盖逻辑谬误分类，需要在W3早期确认并准备训练数据或降级方案。

**W3里程碑**：用户说话后，前端实时展示"论证框架"和"谬误标记"，再进入LLM追问。

---

### W4：思辨报告（8.7-8.13）

**目标**：单人模式完整闭环——对话→报告→评分。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 报告模板设计 | 3种报告页面样式 | 1d |
| 逻辑链可视化 | D3.js思维导图 | 2d |
| 评分算法设计 | 基于轮次/谬误/深度的打分 | 1d |
| generateReport云函数 | 调用LLM生成结构化报告 | 1d |
| 报告分享功能 | 保存/截图/转发 | 0.5d |

**评分算法**：

```
思辨分数 = 基础分 + 深度分 + 修正分

基础分（满分30）：min(轮次×6, 30)
  - 5轮=30分，每少一轮扣6分

深度分（满分40）：分层追问覆盖率×40
  - 触发"追问预设"：+8
  - 触发"追问证据"：+8
  - 触发"追问边界"：+8
  - 触发"追问后果"：+8
  - 触发"追问定义"：+8

修正分（满分30）：(1 - 谬误率)×30
  - 用户论证中无谬误→30分
  - 每出现一个谬误类型扣6分

总分范围：0-100
```

**W4里程碑**：用户走完一次对话后，看到可视化报告+评分+分享入口。

---

### W5：双Agent模式（8.14-8.20）

**目标**：双人共修模式上线。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 专家角色Prompt库 | 4类专家Prompt | 1.5d |
| dualSession云函数 | 双Agent串行编排 | 1.5d |
| 双角色交替UI | ChatUI Kit双头像对话 | 1d |
| 专家自动匹配 | 按话题选专家 | 0.5d |
| 双重评估报告 | 知识掌握×思辨深度 | 1d |

**专家角色分类与Prompt骨架**：

```
通用学者：百科全书式讲解，善用类比
科学专家：严谨实验思维，强调可证伪性
人文专家：历史脉络视角，强调多元解读
技术专家：工程实践导向，强调trade-off
```

**W5里程碑**：用户说"我想学区块链"，专家Agent讲原理，苏格拉底Agent追问理解，完整走通。

---

### W6：辩论场（8.21-8.27）

**目标**：三Agent辩论模式上线。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 正方/反方/裁判Prompt | 3个角色Prompt精调 | 2d |
| debateSession云函数 | 三Agent串行编排 | 1.5d |
| 辩论舞台UI | 三角色分色对话区 | 1d |
| 观战投票 | 每轮立场投票 | 0.5d |
| 用户发言入口 | 辩论后提交观点 | 0.5d |

**辩论质量保障措施**：

1. **防复读机**：每轮prompt注入「不要重复上一轮的论点，必须提出新的论证角度」
2. **防极端化**：prompt中要求「即使持正方立场，也要承认反方的合理性」
3. **裁判公正性**：裁判prompt要求「必须分别指出双方的亮点和漏洞，不可偏袒」

**W6里程碑**：输入"996是奋斗的体现"，三Agent完成3轮完整辩论，用户投票+发言。

---

### W7：社交功能（8.28-9.3）

**目标**：增长闭环——段位+海报+群聊。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 段位系统 | 青铜→钻石规则 | 0.5d |
| 战绩海报生成 | Canvas+云函数合成 | 2d |
| 群聊辩论赛 | 群内发起+排名 | 1.5d |
| 话题广场 | 投稿+投票 | 1d |
| 分享卡片 | 转发用标题/图片 | 0.5d |

**海报生成方案**（不消耗AI生图额度）：

```
Canvas 2D绘制：
├── 背景：预设渐变色模板（3套：暗黑/学术/活力）
├── 头像：用户微信头像圆角裁剪
├── 段位徽章：本地SVG素材
├── 数据：本次score/总场次/胜率
└── 金句：本次对话中用户最精彩的发言（LLM评选）
```

**W7里程碑**：用户完成一次思辨后，可生成并分享海报到微信群。

---

### W8：打磨优化（9.4-9.10）

**目标**：内测+修复+体验优化。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 内测招募（5-10人） | 内测群+反馈收集 | 1d |
| Prompt批量微调 | 根据内测反馈优化 | 2d |
| UI/UX精调 | 动画/加载态/空状态 | 1d |
| 性能优化 | 首屏加载/云函数冷启动 | 1d |
| Bug修复 | 内测bug清零 | 1d |
| 内容安全过滤 | 敏感词+不当言论拦截 | 0.5d |

**W8里程碑**：内测反馈响应完毕，无明显可用性Bug。

---

### W9：压力测试（9.11-9.17）

**目标**：验证免费额度下的稳定性。

| 测试项 | 方法 | 通过标准 |
|------|------|------|
| Token消耗压测 | 10人×每人20次对话 | 日均不超过300万Token |
| 云函数并发 | 模拟50人同时对话 | 无429限流/超时3次以上 |
| 数据库读写 | 压测场景下延迟 | p99 < 200ms |
| 端侧推理兼容 | 不同机型（3款） | 均正常返回 |
| 异常恢复 | 断网/超时/后台切前台 | 对话状态不丢失 |
| LLM输出安全 | 100条对话样本审核 | 无不恰当内容 |

**W9里程碑**：压测报告，确认日活2000人评审期无风险。

---

### W10：上线提报（9.18-9.24）

**目标**：提交审核+比赛材料。

| 任务 | 产出 | 估时 |
|------|------|:---:|
| 微信审核提交 | 代码审核+内容审核 | 1d |
| 演示视频录制 | 3分钟功能演示（三模式） | 1d |
| 提报文档撰写 | 作品说明+技术文档 | 1.5d |
| GitHub Readme完善 | 英文版+架构图+截图 | 0.5d |
| 审核问题应对 | 预留缓冲期 | — |

**演示视频分镜**：

| 时间 | 内容 |
|:---:|------|
| 0:00-0:30 | 打开小程序→首页三层展示→品牌展示 |
| 0:30-1:10 | L1单人磨刀：输入"学历史没用"→苏格拉底5轮追问 |
| 1:10-1:50 | L2双人共修：输入"薛定谔的猫"→专家讲解+苏格拉底追问 |
| 1:50-2:30 | L3辩论场：观战"996是奋斗"→投票→自己发言 |
| 2:30-3:00 | 报告+段位+海报→分享→二维码 |

---

## 五、关键风险与降级方案

| 风险 | 概率 | 发生时机 | 降级方案 |
|------|:---:|------|------|
| 端侧推理模型不适用逻辑分类 | 中 | W3 | 全走云端；10亿Token依旧撑得住，成本可控 |
| LLM回复质量不稳定 | 中 | W2-W8 | 预设话题库兜底；W8内测前完成3轮Prompt迭代 |
| CloudBase云函数冷启动慢 | 高 | W2 | 设置最小保留实例1个（消耗少量配额）；W8优化 |
| 微信审核未通过 | 低 | W10 | 预留2周缓冲；内容不含政治/敏感话题 |
| 端侧API文档与3.8.0实际不符 | 中 | W3 | W3早期验证；不符则直接走降级方案 |
| 辩论场Agent偶发不当言论 | 低 | W6 | 内容安全过滤云函数前置拦截 |

---

## 六、开发注意事项

### 6.1 Prompt管理原则

- 所有Prompt集中管理在`prompts/`目录，方便版本控制和批量调整
- 每次修改Prompt必须保留版本记录（Git commit message写明改动原因）
- 内测期间，根据用户反馈快速迭代Prompt（W8预留2天）

### 6.2 云函数最佳实践

- 每个云函数保持单一职责（对话/报告/海报分离）
- 冷启动优化：Node.js 18 + ESM模块 + 最小依赖
- 超时设置：对话类30s，报告类15s，海报类10s
- 错误统一返回格式：`{ code: 0, data: {...} }` 或 `{ code: -1, msg: "错误描述" }`

### 6.3 Token消耗监控

- 每次LLM调用记录`prompt_tokens` + `completion_tokens`
- 云数据库中建`token_usage`表，每日汇总
- 接近警戒线（80%额度）时，前端展示降级提示

### 6.4 ChatUI Kit使用要点

- 自定义消息类型：`socrates`/`expert`/`affirmative`/`negative`/`judge` 五种消息样式
- 双人模式：两个`Chat`实例交替显示，通过头像和颜色区分角色
- 辩论场：三个消息区域（上-正方、下-反方、底部-裁判）

---

*（内容由AI生成，仅供参考）*

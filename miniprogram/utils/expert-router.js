/**
 * expert-router.js — 话题 → 专家类型匹配（纯关键词命中，禁止 LLM 调用）
 *
 * 匹配规则：按优先级顺序，首次命中即返回；无匹配返回 common。
 * 返回：{ type: string, promptKey: string }
 *   type: 'science'|'humanities'|'tech'|'common'
 *   promptKey: prompts.expert_science / expert_humanities / expert_tech / expert_common
 */

const { prompts } = require("./prompts");

/** 关键词 → 专家类型映射表（按优先级排序，先命中先返回） */
const RULES = [
  {
    type: "science",
    promptKey: "expert_science",
    keywords: [
      "物理", "化学", "生物", "天文", "宇宙", "数学", "医学", "生理",
      "进化", "量子", "相对论", "能量", "原子", "分子", "基因", "DNA",
      "细胞", "光", "电", "磁", "力", "重力", "声", "热", "气候",
      "地震", "火山", "物种", "生态", "病毒", "细菌", "免疫",
      "科学", "实验", "自然", "地球", "行星", "星系", "黑洞",
    ],
  },
  {
    type: "humanities",
    promptKey: "expert_humanities",
    keywords: [
      "哲学", "历史", "文学", "社会", "心理", "伦理", "道德", "政治",
      "经济", "文化", "艺术", "音乐", "教育", "语言", "宗教", "法律",
      "存在", "意义", "自由", "正义", "权利", "公平", "价值",
      "孔子", "苏格拉底", "柏拉图", "亚里士多德", "尼采", "马克思",
      "人类", "文明", "战争", "民主", "制度", "传统", "诗歌", "小说",
    ],
  },
  {
    type: "tech",
    promptKey: "expert_tech",
    keywords: [
      "AI", "人工智能", "机器", "算法", "编程", "代码", "软件", "硬件",
      "计算机", "网络", "互联网", "数据", "芯片", "机器人", "自动",
      "技术", "工程", "架构", "系统", "协议", "加密", "安全",
      "区块链", "云计算", "物联网", "5G", "量子计算", "深度学习",
      "神经网络", "大模型", "ChatGPT", "生成式", "科技",
    ],
  },
];

/**
 * 根据用户输入文本匹配专家类型（纯关键词命中，不走 LLM）
 * @param {string} text 用户输入文本
 * @returns {{ type: string, promptKey: string, prompt: string }}
 */
function route(text) {
  const lower = (text || "").toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          type: rule.type,
          promptKey: rule.promptKey,
          prompt: prompts[rule.promptKey] || prompts.expert_common,
        };
      }
    }
  }
  return {
    type: "common",
    promptKey: "expert_common",
    prompt: prompts.expert_common,
  };
}

module.exports = { route, RULES };
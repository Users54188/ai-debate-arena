/**
 * verify-prompt-mirror.js — Prompt/用例镜像一致性校验（W4-D0-B5）
 *
 * 校验四组镜像：
 *  1. prompts/evals/cases.json ↔ cloudfunctions/evalRunner/cases.json（sha256 必须逐字一致）
 *  2. miniprogram/utils/prompts.js 的 socrates 字段 ↔ evalRunner 内置 PROMPT_SOCRATES（逐字一致）
 *  3. miniprogram/utils/prompts.js 的 expert_* 字段 ↔ evalRunner 内置 PROMPT_EXPERT_*（逐字一致，W4 加）
 *  4. prompts/socrates.md 抽检核心句子（md 为人类阅读镜像，不做逐字校验）
 *
 * 任一硬性镜像不一致 → exit(1)（阻断提交/CI）
 * 用法：node tools/verify-prompt-mirror.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function normalize(s) {
  return s.replace(/\r\n/g, "\n").trim();
}

function fail(msg) {
  failures++;
  console.error(`✗ ${msg}`);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

/* 1. cases.json 镜像（硬性：sha256 逐字一致） */
const casesA = path.join(ROOT, "prompts", "evals", "cases.json");
const casesB = path.join(ROOT, "cloudfunctions", "evalRunner", "cases.json");
if (!fs.existsSync(casesA) || !fs.existsSync(casesB)) {
  fail("cases.json 一侧缺失，请检查 prompts/evals/cases.json 与 cloudfunctions/evalRunner/cases.json");
} else if (sha256(casesA) !== sha256(casesB)) {
  fail("cases.json 镜像不一致（sha256 不同）：prompts/evals/cases.json 与 cloudfunctions/evalRunner/cases.json");
} else {
  ok("cases.json 镜像一致");
}

/* 2. PROMPT_SOCRATES 镜像（硬性：逐字一致） */
const promptsJs = path.join(ROOT, "miniprogram", "utils", "prompts.js");
const evalRunnerJs = path.join(ROOT, "cloudfunctions", "evalRunner", "index.js");
if (fs.existsSync(promptsJs) && fs.existsSync(evalRunnerJs)) {
  const jsSrc = fs.readFileSync(promptsJs, "utf8");
  const runnerSrc = fs.readFileSync(evalRunnerJs, "utf8");

  const m1 = jsSrc.match(/socrates:\s*`([\s\S]*?)`\s*,?$/m);
  const m2 = runnerSrc.match(/PROMPT_SOCRATES\s*=\s*`([\s\S]*?)`;/);

  if (!m1 || !m2) {
    fail("无法从 prompts.js / evalRunner 提取 PROMPT_SOCRATES（正则失配）");
  } else if (normalize(m1[1]) !== normalize(m2[1])) {
    fail("PROMPT_SOCRATES 不一致：miniprogram/utils/prompts.js 与 evalRunner 内置基线不同");
  } else {
    ok("PROMPT_SOCRATES（prompts.js ↔ evalRunner 内置）一致");
  }

  /* 3. PROMPT_EXPERT_* 镜像（硬性：逐字一致，W4 加） */
  const expertPairs = [
    { js: "expert_science", runner: "PROMPT_EXPERT_SCIENCE", label: "科学专家" },
    { js: "expert_humanities", runner: "PROMPT_EXPERT_HUMANITIES", label: "人文专家" },
    { js: "expert_tech", runner: "PROMPT_EXPERT_TECH", label: "技术专家" },
    { js: "expert_common", runner: "PROMPT_EXPERT_COMMON", label: "通用学者" },
  ];
  for (const pair of expertPairs) {
    // prompts.js 里形如 `expert_science: \`...\`,`；evalRunner 里形如 `const PROMPT_EXPERT_SCIENCE = \`...\`;`
    const reJs = new RegExp(`${pair.js}:\\s*\`([\\s\\S]*?)\`\\s*,?$`, "m");
    const reRunner = new RegExp(`${pair.runner}\\s*=\\s*\`([\\s\\S]*?)\`;`);
    const eJs = jsSrc.match(reJs);
    const eRunner = runnerSrc.match(reRunner);
    if (!eJs || !eRunner) {
      fail(`无法提取 ${pair.label} prompt（正则失配：${pair.js} ↔ ${pair.runner}）`);
    } else if (normalize(eJs[1]) !== normalize(eRunner[1])) {
      fail(`${pair.label} prompt 不一致：miniprogram/utils/prompts.js[${pair.js}] 与 evalRunner[${pair.runner}] 内容不同`);
    } else {
      ok(`${pair.label} prompt（${pair.js} ↔ ${pair.runner}）一致`);
    }
  }

  /* 4. PROMPT_DEBATE_* 镜像（硬性：逐字一致，W5 加） */
  const debatePairs = [
    { js: "debate_affirmative", runner: "PROMPT_DEBATE_AFFIRMATIVE", label: "辩论正方" },
    { js: "debate_negative", runner: "PROMPT_DEBATE_NEGATIVE", label: "辩论反方" },
    { js: "debate_judge", runner: "PROMPT_DEBATE_JUDGE", label: "辩论裁判" },
  ];
  for (const pair of debatePairs) {
    const reJs = new RegExp(`${pair.js}:\\s*\`([\\s\\S]*?)\`\\s*,?$`, "m");
    const reRunner = new RegExp(`${pair.runner}\\s*=\\s*\`([\\s\\S]*?)\`;`);
    const eJs = jsSrc.match(reJs);
    const eRunner = runnerSrc.match(reRunner);
    if (!eJs || !eRunner) {
      fail(`无法提取 ${pair.label} prompt（正则失配：${pair.js} ↔ ${pair.runner}）`);
    } else if (normalize(eJs[1]) !== normalize(eRunner[1])) {
      fail(`${pair.label} prompt 不一致：prompts.js[${pair.js}] 与 evalRunner[${pair.runner}] 内容不同`);
    } else {
      ok(`${pair.label} prompt（${pair.js} ↔ ${pair.runner}）一致`);
    }
  }
} else {
  fail("prompts.js 或 evalRunner/index.js 缺失，无法校验 PROMPT_SOCRATES / PROMPT_EXPERT_* / PROMPT_DEBATE_*");
}

/* 4. socrates.md 抽检（软校验：核心句子必须存在） */
const mdFile = path.join(ROOT, "prompts", "socrates.md");
if (fs.existsSync(mdFile)) {
  const md = fs.readFileSync(mdFile, "utf8");
  const coreSnippets = ["你是苏格拉底", "永不直接给答案", "不重复本段对话或摘要中已经问过"];
  let missing = 0;
  for (const snip of coreSnippets) {
    if (!md.includes(snip)) {
      missing++;
      fail(`prompts/socrates.md 缺少核心句子："${snip}"（md 与运行时 prompt 已漂移）`);
    }
  }
  if (!missing) ok("prompts/socrates.md 核心句子抽检通过");
} else {
  fail("prompts/socrates.md 不存在");
}

if (failures > 0) {
  console.error(`\n镜像校验失败：${failures} 项。先同步镜像再提交。`);
  process.exit(1);
}
console.log("\n镜像校验全部通过。");
process.exit(0);

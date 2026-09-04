/**
 * check-syntax.js — 全仓库 JS 语法检查（零依赖 lint 入口，W4-D0）
 *
 * 递归检查 cloudfunctions/ miniprogram/ tools/ 下所有 .js 文件，
 * 任一文件语法错误 → exit(1)。
 * 用法：npm run lint（内部执行 node --check）
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["cloudfunctions", "miniprogram", "tools"];
const SKIP = new Set(["node_modules", "miniprogram_npm", "dist"]);

function collectJs(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (SKIP.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectJs(full));
    else if (ent.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = DIRS.flatMap((d) => collectJs(path.join(ROOT, d)));
let failures = 0;

for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    failures++;
    console.error(`✗ 语法错误: ${path.relative(ROOT, f)}`);
    console.error(String(e.stderr || "").trim());
  }
}

if (failures > 0) {
  console.error(`\n语法检查失败：${failures}/${files.length} 个文件`);
  process.exit(1);
}

/* 上线护栏：测试期配额旁路开关检测（2026-08-25 评审建议）
 *
 * 5 处开关必须上线前同步置 false：云函数 QUOTA_BYPASS ×3 + 前端 quotaBypass ×1。
 * 默认 warning（开发者日常不被打断）；CI 环境（GitHub Actions 等自动设置 CI=true）
 * 或显式 STRICT_LINT=1 时升级为 error 阻断 —— 上线流水线必失败，强迫人工改回。
 */
const BYPASS_RE = /\b(QUOTA_BYPASS|quotaBypass)\s*[:=]\s*true\b/;
const bypassFiles = [
  "cloudfunctions/getQuota/index.js",
  "cloudfunctions/sessionStore/index.js",
  "cloudfunctions/userProfile/index.js",
  "miniprogram/config.js",
];
let bypassHits = 0;
for (const rel of bypassFiles) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) {
    const src = fs.readFileSync(full, "utf8");
    if (BYPASS_RE.test(src)) {
      bypassHits++;
      console.warn(`⚠ 配额旁路开关仍为 true: ${rel}`);
    }
  }
}
if (bypassHits > 0) {
  const strict = process.env.CI === "true" || process.env.STRICT_LINT === "1";
  if (strict) {
    console.error(`\n✗ 上线前必须把 ${bypassHits} 处 QUOTA_BYPASS/quotaBypass 改回 false`);
    console.error(`  (CI 环境强制阻断；本地如需保留测试期旁路，运行 STRICT_LINT=0 npm run lint)`);
    process.exit(1);
  } else {
    console.warn(`⚠ 共 ${bypassHits} 处配额旁路开关仍为 true（CI 构建将阻断；本地构建仅提示）`);
  }
}

console.log(`✓ 语法检查通过（${files.length} 个文件）`);
process.exit(0);

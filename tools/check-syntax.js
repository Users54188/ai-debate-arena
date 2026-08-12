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
console.log(`✓ 语法检查通过（${files.length} 个文件）`);
process.exit(0);

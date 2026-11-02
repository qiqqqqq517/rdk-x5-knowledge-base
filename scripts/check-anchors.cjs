// 校验所有 #锚点 链接是否真的匹配某个标题的 GitHub slug
const fs = require('fs');
const path = require('path');

// GitHub 标题 slug 规则：小写、去标点（保留字母数字 _ -）、空格转 -
function ghSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const DOCS = path.resolve(__dirname, '..', 'docs');
const files = walk(DOCS);

let checked = 0, bad = 0;
const problems = [];

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const rel = path.relative(path.resolve(__dirname, '..'), f).replace(/\\/g, '/');

  // 收集本章所有标题的 slug（含 H1-H6），剔除代码块
  let inFence = false;
  const slugs = new Set();
  const h3map = [];
  for (const line of txt.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const t = m[2].trim();
      slugs.add(ghSlug(t));
      if (m[1].length === 3) h3map.push(t);
    }
  }

  // 找该文件内部的 #锚点
  const re = /\]\(#([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(txt))) {
    checked++;
    const target = m[1];
    if (!slugs.has(target)) {
      bad++;
      problems.push(`${rel}  ✗ #${target}`);
    }
  }
}

console.log(`锚点链接检查：共 ${checked} 个，失效 ${bad} 个`);
if (problems.length) {
  console.log('\n失效锚点：');
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
}
process.exitCode = bad ? 1 : 0;

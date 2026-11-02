// 质量校验：章节字符数、禁用词、来源标注、链接有效性、标题唯一性
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(DOCS).filter(f => !f.endsWith('SUMMARY.md') && !f.endsWith('WRITING-GUIDE.md'));
const MIN = 4000;

let errors = 0, warns = 0;
const rows = [];

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const txt = fs.readFileSync(f, 'utf8');
  const chars = [...txt].length;
  const issues = [];

  // 剔除围栏代码块后再做结构判定（代码块里的 # 注释不是标题）
  const prose = txt.replace(/^```[\s\S]*?^```/gm, '');

  // 1. 一级标题唯一
  const h1 = prose.match(/^# .+$/gm) || [];
  if (h1.length === 0) issues.push('缺少一级标题');
  if (h1.length > 1) issues.push(`一级标题 ${h1.length} 个（应为 1）`);

  // 2. 禁用词
  const banned = ['TODO', '待补充', '占位符', 'FIXME', 'XXX待'];
  for (const b of banned) if (txt.includes(b)) issues.push(`含禁用词「${b}」`);

  // 3. 来源标注
  const srcCount = (txt.match(/^>\s*来源：/gm) || []).length;

  // 4. 相对链接可解析（只在正文 prose 里找，排除代码块；且要求指向 .md 文件）
  const linkRe = /\[[^\]\n]+\]\((?!https?:|#|mailto:)([^)\s]+\.md(?:#[^)\s]*)?)\)/g;
  let m;
  while ((m = linkRe.exec(prose))) {
    let target = m[1].split('#')[0].trim();
    if (!target) continue;
    try { target = decodeURIComponent(target); } catch {}
    const abs = path.resolve(path.dirname(f), target);
    if (!fs.existsSync(abs)) issues.push(`死链：${m[1]}`);
  }

  // 5. 字数
  if (chars < MIN) issues.push(`字符数 ${chars} < ${MIN}`);

  // 6. 结构完整性
  if (!/^## /m.test(txt)) issues.push('无二级标题');
  if (!/本章解决什么/.test(txt)) issues.push('缺少「本章解决什么」');
  if (!/常见误区|速查表|小结/.test(txt)) issues.push('缺少「常见误区/小结」');

  const err = issues.filter(i => !i.startsWith('字符数'));
  if (err.length) errors++;
  if (issues.length) warns++;

  rows.push({ rel, chars, srcCount, issues });
}

rows.sort((a, b) => b.chars - a.chars);
console.log('=== 章节清单（按字符数降序）===');
for (const r of rows) {
  console.log(`${String(r.chars).padStart(7)}  src=${String(r.srcCount).padStart(3)}  ${r.rel}${r.issues.length ? '   ⚠ ' + r.issues.join('; ') : ''}`);
}
const total = rows.reduce((a, b) => a + b.chars, 0);
console.log(`\n合计 ${rows.length} 章，${total} 字符（约 ${Math.round(total / 1000)}K）`);
console.log(`有问题的章节：${warns} / ${rows.length}`);
process.exitCode = errors ? 1 : 0;

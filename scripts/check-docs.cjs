// 质量校验：frontmatter、章节编号连续性、字符数、禁用词、来源标注、内部链接
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

const SKIP = ['SUMMARY.md', 'WRITING-GUIDE.md', 'AI-INDEX.md', 'GLOSSARY.md'];
const files = walk(DOCS).filter(f => !SKIP.includes(path.basename(f)));
const MIN = 4000;

const REQUIRED_FM = ['id', 'volume', 'volume_title', 'title', 'lang', 'rdkos_scope', 'tags', 'summary'];

let errors = 0, warns = 0;
const rows = [];

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const txt = fs.readFileSync(f, 'utf8');
  const chars = [...txt].length;
  const issues = [];

  // ===== frontmatter =====
  const fmMatch = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) {
    issues.push('缺少 YAML frontmatter');
  } else {
    const fm = fmMatch[1];
    for (const k of REQUIRED_FM) {
      if (!new RegExp(`^${k}:`, 'm').test(fm)) issues.push(`frontmatter 缺字段 ${k}`);
    }
  }

  // 剔除围栏代码块，代码块里的 # 注释不是标题
  let inFence = false;
  const heading = [];
  for (const line of txt.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) heading.push({ level: m[1].length, text: m[2].trim() });
  }

  // ===== H1 唯一 =====
  const h1 = heading.filter(h => h.level === 1);
  if (h1.length === 0) issues.push('缺少一级标题');
  if (h1.length > 1) issues.push(`一级标题 ${h1.length} 个（应为 1）`);

  // ===== H1 必须带章节号 =====
  const vol = (rel.match(/^docs\/(\d\d)-/) || [])[1];
  if (h1.length === 1 && vol) {
    const expect = String(Number(vol));
    if (!new RegExp(`^# ${expect}\\.\\d+ `).test('# ' + h1[0].text)) {
      issues.push(`H1 未以章节号开头（应形如 # ${expect}.1 标题）`);
    }
  }

  // ===== H2 编号连续性 =====
  const h2 = heading.filter(h => h.level === 2);
  const h2num = h2
    .map(h => (h.text.match(/^(\d+)\.(\d+)\.(\d+)\s/) || [])[0] ? h.text.match(/^(\d+)\.(\d+)\.(\d+)\s/) : null)
    .filter(Boolean);
  if (vol) {
    const expectVol = String(Number(vol));
    let prev = 0;
    for (const m of h2num) {
      if (m[1] !== expectVol) { issues.push(`H2 卷号错误：${m[0]}`); break; }
      const n = Number(m[3]);
      if (n !== prev + 1) { issues.push(`H2 编号不连续：${m[1]}.${m[2]}.${m[3]}（期望 .${prev + 1}）`); break; }
      prev = n;
    }
  }

  // ===== 禁用词 =====
  for (const b of ['TODO', '待补充', 'FIXME', 'XXX待']) {
    if (txt.includes(b)) issues.push(`含禁用词「${b}」`);
  }

  // ===== 来源标注 =====
  const srcCount = (txt.match(/^>\s*来源：/gm) || []).length;

  // ===== 相对链接有效 =====
  const prose = txt.replace(/^```[\s\S]*?^```/gm, '');
  const linkRe = /\[[^\]\n]+\]\((?!https?:|#|mailto:)([^)\s]+\.md(?:#[^)\s]*)?)\)/g;
  let m;
  while ((m = linkRe.exec(prose))) {
    let target = m[1].split('#')[0].trim();
    if (!target) continue;
    try { target = decodeURIComponent(target); } catch {}
    if (!fs.existsSync(path.resolve(path.dirname(f), target))) issues.push(`死链：${m[1]}`);
  }

  // ===== 结构完整性 =====
  if (!/^## /m.test(prose)) issues.push('无二级标题');
  if (!/本章解决什么/.test(prose)) issues.push('缺少「本章解决什么」');
  if (!/常见误区|速查表|小结/.test(prose)) issues.push('缺少「常见误区/速查表/小结」');
  if (chars < MIN) issues.push(`字符数 ${chars} < ${MIN}`);

  const hard = issues.filter(i => !i.startsWith('字符数'));
  if (hard.length) errors++;
  if (issues.length) warns++;

  rows.push({ rel, chars, srcCount, issues });
}

rows.sort((a, b) => b.chars - a.chars);
console.log('=== 章节清单（按字符数降序）===');
for (const r of rows) {
  console.log(`${String(r.chars).padStart(7)}  src=${String(r.srcCount).padStart(3)}  ${r.rel}${r.issues.length ? '   ⚠ ' + r.issues.join('; ') : ''}`);
}
const total = rows.reduce((a, b) => a + b.chars, 0);
const totalSrc = rows.reduce((a, b) => a + b.srcCount, 0);
console.log(`\n合计 ${rows.length} 章，${total} 字符（约 ${Math.round(total / 1000)}K），来源标注 ${totalSrc} 条`);
console.log(`有问题的章节：${warns} / ${rows.length}（其中硬错误 ${errors} 章）`);
process.exitCode = errors ? 1 : 0;

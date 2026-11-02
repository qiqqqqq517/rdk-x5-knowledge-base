// 深度审计：来源标注是否真实存在于素材中
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const RAW = path.join(ROOT, '_work', 'raw');
const FORUM = path.join(ROOT, '_work', 'forum');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const rawSlugs = new Set(fs.readdirSync(RAW).map(f => f.replace(/\.md$/, '')));
const forumIds = new Set(fs.readdirSync(FORUM).map(f => f.replace(/\.md$/, '')));

const files = walk(DOCS).filter(f => !f.endsWith('SUMMARY.md') && !f.endsWith('WRITING-GUIDE.md'));

let badSlug = 0, badTopic = 0, okSlug = 0, okTopic = 0;
const missingSlugs = new Map();
const missingTopics = new Map();

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  // 官方 slug: 「官方文档 <slug>（<url>）」  或 「官方文档 <slug>」
  const slugRe = /官方文档\s+([A-Za-z0-9_\-/]+)/g;
  let m;
  while ((m = slugRe.exec(txt))) {
    const slug = m[1].replace(/\/$/, '');
    const key = slug.replace(/\//g, '__');
    // 允许末尾带 markdown 强调符
    if (rawSlugs.has(key)) { okSlug++; }
    else {
      badSlug++;
      if (!missingSlugs.has(slug)) missingSlugs.set(slug, []);
      if (!missingSlugs.get(slug).includes(rel)) missingSlugs.get(slug).push(rel);
    }
  }

  // 社区 topic：t/topic/<id> 或 社区帖 <id>
  const topicRe = /forum\.d-robotics\.cc\/t\/topic\/(\d+)/g;
  while ((m = topicRe.exec(txt))) {
    const id = m[1];
    if (forumIds.has(id)) okTopic++;
    else {
      badTopic++;
      if (!missingTopics.has(id)) missingTopics.set(id, []);
      if (!missingTopics.get(id).includes(rel)) missingTopics.get(id).push(rel);
    }
  }
}

console.log('=== 来源真实性审计 ===');
console.log(`官方 slug 引用: 有效 ${okSlug} / 无效 ${badSlug}`);
console.log(`社区 topic 引用: 有效 ${okTopic} / 无效 ${badTopic}`);
if (missingSlugs.size) {
  console.log('\n未匹配的官方 slug（可能写法差异，需人工确认）:');
  for (const [s, where] of [...missingSlugs].slice(0, 40)) console.log(`  ${s}   <- ${where.length} 处, 例: ${where[0]}`);
}
if (missingTopics.size) {
  console.log('\n未匹配的社区 topic（可能编造！）:');
  for (const [s, where] of [...missingTopics].slice(0, 40)) console.log(`  ${s}   <- ${where.slice(0, 3).join(', ')}`);
}
process.exitCode = (badTopic > 0) ? 1 : 0;

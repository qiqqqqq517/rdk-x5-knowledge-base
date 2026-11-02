// 结构改造：统一 H1 + 分层编号 + 注入 YAML frontmatter + 修复速查表引用
// 目标：人读层级一致、可跳转；AI 可解析（frontmatter / 稳定 ID / 可定位编号锚点）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const VOLUMES = {
  '00-导读与选型': { vol: '0', title: '导读与选型' },
  '01-开箱与系统安装': { vol: '1', title: '开箱与系统安装' },
  '02-基础开发': { vol: '2', title: '基础开发' },
  '03-AI推理与工具链': { vol: '3', title: 'AI 推理与工具链' },
  '04-ROS2与TROS': { vol: '4', title: 'ROS2 与 TROS' },
  '05-进阶驱动与系统': { vol: '5', title: '进阶驱动与系统' },
  '06-错误反思与排障': { vol: '6', title: '错误反思与排障' },
  '07-附录与速查': { vol: '7', title: '附录与速查' },
};

const META = require('./_chapter-meta.json');

const FRONT = (m, vol, volTitle, rel) => {
  const id = rel.replace(/\.md$/, '').replace(/\//g, '-');
  return [
    '---',
    `id: ${id}`,
    `volume: ${vol}`,
    `volume_title: ${volTitle}`,
    `title: ${m.title}`,
    'lang: zh-CN',
    'rdkos_scope: "3.0.0 ~ 3.5.0"',
    `tags: [${m.tags.join(', ')}]`,
    `summary: ${m.summary}`,
    'source_policy: "official-first, community-verified"',
    '---',
    '',
  ].join('\n');
};

// 去掉行内代码与围栏代码，避免把 ``` # 注释 当标题处理
function splitCodeMask(txt) {
  const lines = txt.split('\n');
  let inFence = false;
  const mask = lines.map(l => {
    if (/^\s*```/.test(l)) { inFence = !inFence; return true; }
    return inFence;
  });
  return { lines, mask };
}

let changed = 0;
const report = [];

for (const [dir, volInfo] of Object.entries(VOLUMES)) {
  const absDir = path.join(DOCS, dir);
  if (!fs.existsSync(absDir)) continue;
  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.md')).sort();

  files.forEach((file, idx) => {
    const rel = `${dir}/${file}`;
    const abs = path.join(absDir, file);
    const meta = META[rel];
    if (!meta) { report.push(`!! 缺元数据: ${rel}`); return; }

    let txt = fs.readFileSync(abs, 'utf8');
    txt = txt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, '');

    const chapterNo = idx + 1;
    const chapterId = `${volInfo.vol}.${chapterNo}`;

    // 收集旧条目号 -> 新编号的映射，用于修速查表
    const oldToNew = [];
    const { lines, mask } = splitCodeMask(txt);

    let h1Done = false;
    let h2n = 0;
    let h3n = 0;
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (mask[i]) { out.push(line); continue; }

      // H1
      if (!h1Done && /^# /.test(line)) {
        out.push(`# ${chapterId} ${meta.title}`);
        h1Done = true;
        continue;
      }
      if (/^# /.test(line)) { out.push(line); continue; }

      // H2
      let m2 = line.match(/^## (.+)$/);
      if (m2) {
        const t = m2[1].trim();
        if (/本章解决什么|常见误区|本章故障速查表|本章小结|小结|反馈与共建/.test(t)) {
          out.push(`## ${t}`);
          continue;
        }
        const bare = t.replace(/^(\d+(\.\d+)*[\.\s、]+|第[一二三四五六七八九十]+[章节][\s、]*|[一二三四五六七八九十]+[、\.]\s*)/, '').trim();
        h2n += 1;
        h3n = 0;
        out.push(`## ${chapterId}.${h2n} ${bare}`);
        continue;
      }

      // H3
      let m3 = line.match(/^### (.+)$/);
      if (m3) {
        const t = m3[1].trim();
        const oldNo = (t.match(/^(\d+(?:\.\d+)*)/) || [, ''])[1];
        const bare = t.replace(/^(\d+(\.\d+)*[\.\s、]+)/, '').trim();
        if (/^(现象|根因|处置|预防|来源)$/.test(bare)) { out.push(`### ${bare}`); continue; }
        h3n += 1;
        const newNo = h2n > 0 ? `${chapterId}.${h2n}.${h3n}` : `${chapterId}.${h3n}`;
        // 记录旧编号 -> 新 H3 的 GitHub 风格锚点（保留下划线，去其它标点，空格转 -）
        const refOld = (t.match(/^(\d+\.\d+)\s/) || [, ''])[1];
        if (refOld) {
          const anchor = `${newNo} ${bare}`.toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
          oldToNew.push({ old: refOld, nu: `#${anchor}` });
        }
        out.push(`### ${newNo} ${bare}`);
        continue;
      }

      out.push(line);
    }

    txt = out.join('\n');

    // 修复「本章故障速查表」里对旧条目号的引用：2.1 -> 6.x.y
    // 策略：按顺序把表格中出现的旧编号逐个替换为对应的新 H3 锚点
    if (/本章故障速查表/.test(txt) && oldToNew.length) {
      const idxTable = txt.indexOf('## 本章故障速查表');
      const head = txt.slice(0, idxTable);
      let tail = txt.slice(idxTable);
      for (const { old, nu } of oldToNew) {
        const re = new RegExp(`(\\|\\s*)${old.replace('.', '\\.')}(\\s*(?:/\\s*\\d+\\.\\d+)?\\s*\\|)`, 'g');
        tail = tail.replace(re, (mm, p1, p2) => `${p1}[${old}](${nu})${p2}`);
      }
      txt = head + tail;
    }

    txt = FRONT(meta, volInfo.vol, volInfo.title, rel) + txt;
    fs.writeFileSync(abs, txt, 'utf8');
    changed++;
    report.push(`ok ${rel}  -> # ${chapterId} ${meta.title}  H2=${h2n} H3=${h3n} 表格映射=${oldToNew.length}`);
  });
}

console.log(report.join('\n'));
console.log(`\n改造 ${changed} 章`);

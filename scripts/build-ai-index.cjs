// 生成 AI 可读索引：docs/AI-INDEX.md（人读也友好）+ docs/index.json（机器读）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const VOLUMES = [
  ['0', '00-导读与选型', '导读与选型', '先读这卷：定位、硬件速览、四条版本线的对应关系'],
  ['1', '01-开箱与系统安装', '开箱与系统安装', '拿到板子后的第一步：配件、烧录、首启、远程登录、升级恢复'],
  ['2', '02-基础开发', '基础开发', '40PIN/GPIO、摄像头、显示、音频、网络与多媒体示例'],
  ['3', '03-AI推理与工具链', 'AI 推理与工具链', 'BPU、推理接口演变、模型转换、量化调优、性能优化'],
  ['4', '04-ROS2与TROS', 'ROS2 与 TROS', 'TROS 架构、图像采集、dnn_node、编解码与 ROS1 兼容'],
  ['5', '05-进阶驱动与系统', '进阶驱动与系统', '驱动开发、总线调试、CAN/PoE/ISP、系统配置与调频'],
  ['6', '06-错误反思与排障', '错误反思与排障', '72 条四段式故障复盘，按子系统分类'],
  ['7', '07-附录与速查', '附录与速查', '命令速查、报错速查表、接口引脚速查'],
];

function parseFront(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      v = v.replace(/^"(.*)"$/, '$1');
    }
    out[mm[1]] = v;
  }
  return out;
}

const chapters = [];
for (const [vol, dir, volTitle, volDesc] of VOLUMES) {
  const absDir = path.join(DOCS, dir);
  if (!fs.existsSync(absDir)) continue;
  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.md')).sort();
  files.forEach((file, i) => {
    const abs = path.join(absDir, file);
    const txt = fs.readFileSync(abs, 'utf8');
    const fm = parseFront(txt);
    const rel = `${dir}/${file}`;
    const chars = [...txt].length;
    const srcCount = (txt.match(/^>\s*来源：/gm) || []).length;
    // 抽取二级标题作为「本章可回答的问题」骨架
    let inFence = false;
    const h2 = [];
    for (const line of txt.split('\n')) {
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = line.match(/^## (.+)$/);
      if (m && !/本章解决什么|常见误区|本章故障速查表|小结|反馈与共建/.test(m[1])) h2.push(m[1].trim());
    }
    chapters.push({
      vol, volume: volTitle, chapter: `${vol}.${i + 1}`,
      id: fm.id || rel.replace(/\.md$/, '').replace(/\//g, '-'),
      title: fm.title || file.replace(/\.md$/, ''),
      path: `docs/${rel}`,
      tags: fm.tags || [],
      summary: fm.summary || '',
      sections: h2,
      chars, sources: srcCount,
    });
  });
}

// ---- 机器读 ----
fs.writeFileSync(path.join(DOCS, 'index.json'), JSON.stringify({
  name: 'RDK X5 全栈知识库',
  lang: 'zh-CN',
  rdkos_scope: '3.0.0 ~ 3.5.0',
  snapshot: '2026-11-02',
  chapters,
}, null, 2), 'utf8');

// ---- 人 + AI 都能读 ----
const L = [];
L.push('# AI 索引（机器可读 · 人读也友好）');
L.push('');
L.push('> 本文件由 `scripts/build-ai-index.cjs` 从各章 YAML frontmatter 自动生成，**不要手改**。');
L.push('> 配套机器可读副本：[`index.json`](index.json)。');
L.push('');
L.push('## 使用约定');
L.push('');
L.push('| 你要做的事 | 怎么用本索引 |');
L.push('| --- | --- |');
L.push('| 按关键词找章节 | 查下表 `标签` 列，或直接 `grep -rn "<关键词>" docs/` |');
L.push('| 精确引用某一节 | 章节号即锚点，如 `6.2.2.1`，GitHub 上可直接跳转 |');
L.push('| 判断是否适用你的系统 | 每章 frontmatter 的 `rdkos_scope`，全库统一为 `3.0.0 ~ 3.5.0`，跨版本差异在正文显式标注 |');
L.push('| 判断内容可信度 | `来源数` 列 = 该章 `> 来源：` 标注条数，可回溯到官方页或社区帖 |');
L.push('| 程序化检索 | 读 `index.json`，字段：`id / volume / chapter / title / path / tags / summary / sections` |');
L.push('');
L.push('## 全库规模');
L.push('');
const totalChars = chapters.reduce((a, b) => a + b.chars, 0);
const totalSrc = chapters.reduce((a, b) => a + b.sources, 0);
L.push(`- 章节数：**${chapters.length}**`);
L.push(`- 总字符：**${totalChars.toLocaleString('en-US')}**（约 ${Math.round(totalChars / 1000)}K）`);
L.push(`- 来源标注：**${totalSrc}** 条`);
L.push(`- 卷数：**${VOLUMES.length}**`);
L.push('');
L.push('## 章节总表');
L.push('');
L.push('| 章节 | 标题 | 标签 | 来源数 | 路径 |');
L.push('| --- | --- | --- | --- | --- |');
for (const c of chapters) {
  L.push(`| \`${c.chapter}\` | ${c.title} | ${c.tags.join('、')} | ${c.sources} | [${c.path}](${c.path.replace(/^docs\//, '')}) |`);
}
L.push('');

// 分卷速览：每章摘要 + 小节骨架
L.push('## 分卷速览');
L.push('');
for (const [vol, , volTitle, volDesc] of VOLUMES) {
  const list = chapters.filter(c => c.vol === vol);
  if (!list.length) continue;
  L.push(`### 第 ${vol} 卷 · ${volTitle}`);
  L.push('');
  L.push(`${volDesc}（${list.length} 章）`);
  L.push('');
  for (const c of list) {
    L.push(`#### ${c.chapter} ${c.title}`);
    L.push('');
    L.push(c.summary);
    L.push('');
    if (c.sections.length) {
      L.push('可查询的小节：' + c.sections.map(s => `\`${s}\``).join(' · '));
      L.push('');
    }
  }
}

L.push('## 给 AI 的检索建议');
L.push('');
L.push('1. **先定位版本**：答案依赖 RDKOS 版本。遇到 Python 推理相关问题时，先确认是 3.5.0+（`hbm_runtime`）还是 ≤3.4.1（`pyeasy_dnn`）。');
L.push('2. **排障优先查第 6 卷**：72 条故障均为「现象（原文报错）→ 根因 → 处置 → 预防」四段式，报错原文未改写，可按原文串直接匹配。');
L.push('3. **接口速查查第 7 卷**：命令、报错码、引脚表集中在此，不必翻正文。');
L.push('4. **引用时带章节号**：例如「见 7.2 报错速查表」，比只给标题更可定位。');
L.push('5. **注意版本分界**：3.5.0 起 Python 侧 `pyeasy_dnn` 已被 `hbm_runtime` 取代，且 `/app/pydev_demo/` 全量重写，旧教程路径可能失效。');
L.push('');

fs.writeFileSync(path.join(DOCS, 'AI-INDEX.md'), L.join('\n'), 'utf8');
console.log(`生成 AI-INDEX.md：${chapters.length} 章，${totalChars} 字符，${totalSrc} 条来源标注`);

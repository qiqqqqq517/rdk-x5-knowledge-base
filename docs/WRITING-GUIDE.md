# 写作规范

本仓库是 **RDK X5（地瓜机器人 D-Robotics 旭日 X5）全栈知识库**。所有章节必须遵守本规范，否则 `scripts/check-docs.cjs` 会报错。

## 一、格式契约（机器可校验）

### 1.1 每章必须有 YAML frontmatter

```yaml
---
id: 06-错误反思与排障-02-启动供电与烧录故障      # 路径以 - 连接，去 .md
volume: 6                                        # 卷号
volume_title: 错误反思与排障
title: 启动供电与烧录故障                          # 与 H1 的标题部分一致
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"                     # 全库统一
tags: [启动, 供电, 烧录, miniboot, 崩溃点漂移]     # 5 个左右，供 AI 检索
summary: 一句话说明本章解决什么、核心判据是什么      # 60~120 字
source_policy: "official-first, community-verified"
---
```

`id / volume / volume_title / title / lang / rdkos_scope / tags / summary` 八项为必填，缺任一项校验失败。

### 1.2 章节编号：全局唯一、层级递进

| 层级 | 格式 | 示例 | 用途 |
| --- | --- | --- | --- |
| H1 | `# 卷.章 标题` | `# 6.2 启动供电与烧录故障` | 一章一个，编号即锚点前缀 |
| H2 | `## 卷.章.节 标题` | `## 6.2.2 故障条目` | 章内小节，编号必须连续 |
| H3 | `### 卷.章.节.条 标题` | `### 6.2.2.1 上电后间歇性进不了 Ubuntu` | 故障条目（卷 6） |

约束：

- **H1 全章唯一**，且必须以 `卷号.章号 ` 开头（校验脚本会检查）。
- **H2 编号必须从 `.1` 连续递增**，不允许跳跃或重复。
- `/^\d/` 开头的 H2 才会被当作编号小节；以下固定标题**不加编号**：`本章解决什么`、`常见误区`、`本章故障速查表`、`本章小结`、`小结`、`反馈与共建`。
- 故障小节的 `### 现象` / `### 根因` / `### 处置` / `### 预防` **固定不加编号**（它们是条目的属性，不是并列结构）。

### 1.3 新增章节的流程

1. 在 `scripts/_chapter-meta.json` 里登记该章的 `title / tags / summary`；
2. 把 md 文件放进对应卷目录（文件名 `NN-主题.md` 排序决定章号）；
3. 跑 `node scripts/restructure.cjs` 自动补 frontmatter 与编号；
4. 跑 `node scripts/build-ai-index.cjs` 重算索引；
5. 跑三个校验脚本直到全绿。

---

## 二、内容标准

### 2.1 素材来源（只读，不要修改）

| 目录 | 内容 |
| --- | --- |
| `_work/raw/` | 官方文档全量抓取，247 页、约 131 万字符。文件名 = 文档路径把 `/` 换成 `__` |
| `_work/index.json` | 官方页面索引 `{url, slug, title, chars, file}` |
| `_work/forum/` | 地瓜社区论坛帖（Discourse），文件名 = topicId，含真实报错与解决过程 |
| `_work/forum_index.md` | 社区帖索引，按字节降序（长帖信息量最大） |

查素材：用 `grep` 在 `_work/raw/` 与 `_work/forum/` 里搜关键词，再 `read` 命中的文件。

### 2.2 溯源要求

每条技术结论都要能回溯：

```markdown
> 来源：官方文档 <slug>（<完整 URL>）
> 来源：社区帖 <topicId>（https://forum.d-robotics.cc/t/topic/<id>）
```

- 官方 slug 必须真实存在于 `_work/raw/`（`audit-sources.cjs` 会核对）。
- 社区 topicId 必须真实存在于 `_work/forum/`，**不许编造帖号**。
- 官方与社区说法冲突时**并列呈现并给判断依据**，不要和稀泥。

### 2.3 版本铁律

凡涉及 API 的段落**必须写明适用 RDKOS 版本**。关键分界：

- **RDKOS V3.5.0（2026-04）起**，Python 侧算法推理由 `pyeasy_dnn` 统一改为 **`hbm_runtime`**（pybind11 封装 libdnn），且 `/app/pydev_demo/` 下示例全量重写。
- 过渡期曾有 `bpu_infer_lib`，官方已明确停止维护。
- **TROS 的 C++ 侧始终用 `hobot_dnn`**，与 Python 侧 `hbm_runtime` 是并行接口，不是矛盾。

把 `hbm_runtime` 写成 `pyeasy_dnn` 的别名、或说「X5 是双核 BPU」，都属于严重错误。

### 2.4 故障写法（卷 6 强制）

```markdown
### 现象
<原文报错，用代码块包住，一字不改；截图类写「社区帖中为截图，用户文字描述是：…」>
### 根因
<讲清机制，为什么会出现这个现象>
### 处置
<可直接复制的命令，标注是否需要 sudo>
### 预防
<下次如何避免、如何快速定位>
> 来源：社区帖 <topicId>（https://forum.d-robotics.cc/t/topic/<id>）
```

- 社区帖里若有原始拼写错误（如 `bakeup1`、`Inlvaid`、`failture`），**保留原拼写并注明**，因为用户是拿原样去搜的。
- 同一现象有多种根因时并列，并给出**区分方法**（例如看串口日志里的哪个标志串）。

### 2.5 语言与代码

- 全中文，技术术语保留英文原文（`hbm_runtime`、`BPU`、`VIO`、`hb_mapper`）。
- 命令用 ```bash / ```python / ```c++ 代码块，**不加 `$` 或 `#` 提示符前缀**，注释用中文。
- 参数、引脚、型号、错误码、版本差异一律用表格。
- 不写营销话术（「强大的」「一站式的」「轻松搞定」）。直接陈述事实与步骤。
- 配图只引用官方图床绝对地址（`https://rdk-doc.oss-cn-beijing.aliyuncs.com/...`），不编造图片路径。

### 2.6 结构要求

每章必须包含：

- 开头 `## 本章解决什么`（2–4 句）
- 结尾 `## 常见误区`（或速查表/小结）

---

## 三、禁止事项

- 不要修改 `_work/` 下任何文件。
- 不要手改 `docs/AI-INDEX.md` 与 `docs/index.json`（由脚本生成）。
- 不要出现 `TODO`、`待补充`、`FIXME`、`XXX待` 等占位词。
- 不要编造社区帖 URL、topicId、官方页 slug。
- 写不出证据的内容直接删掉，不要留空壳。

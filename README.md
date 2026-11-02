# RDK X5 全栈知识库

> 面向 D-Robotics RDK X5（地瓜机器人旭日 X5，Sunrise 5，8 核 ARM Cortex-A55 + 10 TOPS BPU）的中文技术知识库
>
> 官方文档结构化重讲 + 社区真实故障复盘 + 版本漂移标注 · 8 卷 35 章 70 万字符

[![Docs](https://img.shields.io/badge/docs-中文-blue)]()
[![RDKOS](https://img.shields.io/badge/RDKOS-3.0.0%20~%203.5.0-green)]()
[![Chapters](https://img.shields.io/badge/章节-35%20%2F%208%20卷-informational)]()
[![License](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey)](LICENSE)

---

## 三十秒上手

| 你是 | 从这里进 |
| --- | --- |
| **人**，想按目录读 | [docs/SUMMARY.md](docs/SUMMARY.md) |
| **人**，想按关键词/标签查 | [docs/AI-INDEX.md](docs/AI-INDEX.md)（章节总表 + 标签 + 摘要） |
| **AI 助手**，第一次接触本库 | [llms.txt](llms.txt)（单文件说明全库结构与版本边界） |
| **AI / 脚本**，要程序化检索 | [docs/index.json](docs/index.json)（每章结构化元数据） |
| 遇到不认识的叫法 | [docs/GLOSSARY.md](docs/GLOSSARY.md)（中英对照 + 别名映射） |

---

## 这份库为什么这样组织

RDK X5 的资料分散在三处：官方文档讲「设计上应该怎么做」，社区论坛讲「实际会怎么坏」，个人博客讲自己那一次怎么弄好的。三方都在，但没人把它们缝起来，而且**大量教程已经过期**。

本库做三件事：

| | 官方文档 | 本知识库 |
| --- | --- | --- |
| 组织方式 | 按功能模块 | **按你要做的事** |
| 故障覆盖 | 标准 FAQ | **72 条真实报错 + 四段式复盘** |
| 版本处理 | 只呈现最新版 | **显式标注版本分界** |
| 机器可读 | 无 | **frontmatter + index.json + llms.txt** |

### 必须先知道的版本边界

```bash
cat /etc/version
rdkos_info
```

| 你的 RDKOS | Python 推理接口 | 影响 |
| --- | --- | --- |
| 3.0.0 ~ 3.4.1 | `pyeasy_dnn` | 旧教程适用 |
| **3.5.0 及以上** | **`hbm_runtime`**（pybind11 封装 libdnn） | 新接口，旧教程失效；`/app/pydev_demo/` 全量重写 |

> 另注：TROS 的 C++ 侧始终用 `hobot_dnn`，与 Python 侧 `hbm_runtime` **是两套并行接口，不是矛盾**。

---

## 内容导航

| 章节 | 主题 | 适合谁 |
| --- | --- | --- |
| [0.x](docs/00-导读与选型/) | 导读与选型、**硬件速览、版本总线** | 所有人，**先读这卷** |
| [1.x](docs/01-开箱与系统安装/) | 配件、烧录、首启、远程登录、升级恢复 | 拿到新板子的人 |
| [2.x](docs/02-基础开发/) | 40PIN/GPIO、摄像头、显示、音频、网络与多媒体 | 做应用开发的人 |
| [3.x](docs/03-AI推理与工具链/) | BPU、推理接口演变、模型转换、量化、性能 | 算法工程师 |
| [4.x](docs/04-ROS2与TROS/) | TROS 架构、图像采集、dnn_node、编解码与桥接 | 机器人开发者 |
| [5.x](docs/05-进阶驱动与系统/) | 驱动开发、总线调试、CAN/PoE/ISP、系统配置 | 嵌入式工程师 |
| [6.x](docs/06-错误反思与排障/) | **72 条四段式故障复盘** | 所有人，出问题就来 |
| [7.x](docs/07-附录与速查/) | 命令速查、**报错速查表**、引脚速查 | 所有人，当工具书用 |

三条推荐路径：

- **新手跑通**：0.x → 1.x 全部 → 2.x 挑需要的 → 出问题查 6.x
- **算法部署**：0.3 版本总线 → 3.x 全部 → 2.2 摄像头 → 6.5 AI 故障
- **嵌入式改板**：5.x 全部 → 4.x → 6.x

---

## 格式约定（人和 AI 共用）

### 1. 章节编号即锚点

```
0.1  1.1  2.1 …              章节（H1）
6.2.1                        章内小节（H2）
6.2.2.1                      故障条目（H3，卷 6）
```

编号全局唯一。GitHub 上点击 `6.2.2.1` 直接跳到对应条目，引用时写「见 6.2.2.1」即可定位。

### 2. 每章带 YAML frontmatter

```yaml
---
id: 06-错误反思与排障-02-启动供电与烧录故障
volume: 6
volume_title: 错误反思与排障
title: 启动供电与烧录故障
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [启动, 供电, 烧录, miniboot, 崩溃点漂移]
summary: 启动链六阶段判读、10 条故障四段式复盘。核心判据：崩溃点漂移=供电/内存不稳，崩溃点固定=软件 bug。
source_policy: "official-first, community-verified"
---
```

AI 可以只读 frontmatter 就判断一章是否相关，不必读全文。

### 3. 每条结论可溯源

```markdown
> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/...）
> 来源：社区帖 35112（https://forum.d-robotics.cc/t/topic/35112）
```

全库共 **823 条**来源标注，可逐条回溯。没有出处行的是编者按（经验归纳）。

### 4. 故障按四段式写

```markdown
### 现象     ← 原文报错，一字不改，可直接拿去搜
### 根因     ← 讲清机制
### 处置     ← 可直接复制的命令
### 预防     ← 下次怎么避免、怎么快速定位
```

价值在于**同一现象的根因可能完全不同**。例如「上电反复重启」既可能是电源不足，也可能是 Miniboot 与 NAND 布局不匹配 —— 本库会并列写出并给出区分方法（看串口日志是 `PAGE_SIZE_2K` 还是 `4K`）。

---

## 数据来源

| 来源 | 规模 | 抓取方式 |
| --- | --- | --- |
| 官方文档站 `developer.d-robotics.cc/rdk_x_doc` | 247 个中文页面，约 131 万字符 | sitemap 全量枚举 |
| 地瓜社区论坛 `forum.d-robotics.cc` | 961 个主题帖，约 1100 万字节 | Discourse JSON API，50+ 关键词检索 |

未纳入：官方文档英文页、已下架的 RDK X3 旧版页。社区帖为关键词覆盖检索，非论坛全量。

**素材快照日期：2026-11-02。** RDKOS 版本、apt 源、驱动支持会随时间变化，遇到不一致时以官方最新文档与你的板端实测为准。

---

## 本地预览

纯 Markdown，无构建依赖：

```bash
# 有 Node.js
npx -y docsify-cli serve docs

# 有 Python
python -m http.server 8000 --directory docs
```

## 质量校验

仓库自带三个脚本，改完内容跑一遍：

```bash
# 章节质量：frontmatter 完整性、H1 唯一、H2 编号连续、禁用词、死链、字数、结构完整
node scripts/check-docs.cjs

# 来源真实性：把正文里的官方 slug 与社区 topicId 逐个对素材求交
node scripts/audit-sources.cjs

# 内部锚点：所有 #锚点 链接是否真能匹配到某个标题
node scripts/check-anchors.cjs
```

维护时改完章节需重新生成索引：

```bash
node scripts/build-ai-index.cjs   # 重算 docs/AI-INDEX.md 与 docs/index.json
```

当前状态：**35 章全部通过，死链 0，失效锚点 0**。

---

## 贡献

欢迎提 Issue 与 PR，尤其是：

- **版本过期**：某段内容在你的 RDKOS 版本上不成立
- **新的踩坑**：有可复现的报错 + 根因 + 处置，按第 6 卷四段式提交
- **官方文档变更**：官方更新后本库未同步

提交前请读 [写作规范](docs/WRITING-GUIDE.md)。核心要求：**报错原文不改写、每条结论标出处、命令可复制、版本必须显式**。

新增章节需同时更新 `scripts/_chapter-meta.json` 并重跑 `scripts/restructure.cjs` 与 `scripts/build-ai-index.cjs`。

---

## 许可

文档内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可。

引用的官方文档内容版权归 **D-Robotics（地瓜机器人）** 所有；社区帖内容版权归各原作者所有。本库仅做整理、组织与补充说明，不主张对原始内容的著作权。

「RDK」「旭日」「Sunrise」「D-Robotics」「地瓜机器人」等为地瓜机器人商标。本项目为社区整理，**非官方文档**，不代表地瓜机器人官方立场。

---

## 相关链接

| 资源 | 地址 |
| --- | --- |
| 官方文档站 | https://developer.d-robotics.cc/rdk_x_doc/ |
| 官方资料中心 | https://developer.d-robotics.cc/rdk_doc_center/ |
| 地瓜开发者社区 | https://forum.d-robotics.cc/ |
| Model Zoo（GitHub） | https://github.com/D-Robotics/rdk_model_zoo |
| 下载资源汇总 | https://developer.d-robotics.cc/rdk_x_doc/Quick_start/download |
| GitHub 镜像 | https://github.com/qiqqqqq517/rdk-x5-knowledge-base |
| Gitee 镜像 | https://gitee.com/qiqqq517/rdk-x5-knowledge-base |

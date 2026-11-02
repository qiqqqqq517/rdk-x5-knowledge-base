# RDK X5 全栈知识库

> 面向 D-Robotics RDK X5（旭日 X5 / Sunrise 5，10 TOPS 端侧算力，8 核 ARM Cortex-A55）的中文技术知识库
>
> 官方文档结构化重讲 + 社区真实故障复盘 + 版本漂移标注

[![Docs](https://img.shields.io/badge/docs-中文-blue)]()
[![RDKOS](https://img.shields.io/badge/RDKOS-3.0.0%20~%203.5.0-green)]()
[![License](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey)]()

---

## 这是什么

RDK X5 的资料分散在三个地方：官方文档站讲设计上应该怎么做，社区论坛讲实际会怎么坏，个人博客讲自己那一次怎么弄好的。三方都在，但没人把它们缝起来。

这个仓库把两个**一手来源**（官方全站 247 页 + 社区 961 个主题帖）整理成结构化知识库，做三件官方文档不做的事：

| | 官方文档 | 本知识库 |
| --- | --- | --- |
| 组织方式 | 按功能模块 | **按你要做的事** |
| 故障覆盖 | 标准 FAQ | **真实原始报错 + 四段式复盘** |
| 版本处理 | 只呈现最新版 | **显式标注版本分界** |

### 为什么需要「版本分界」标注

RDK X5 从 RDKOS 3.0.0 走到 3.5.0，Python 推理接口变过一次，网上大量教程已经过期：

| 你的 RDKOS 版本 | Python 推理接口 | 影响 |
| --- | --- | --- |
| 3.0.0 ~ 3.4.1 | `pyeasy_dnn` | 旧教程适用 |
| **3.5.0 及以上** | **`hbm_runtime`**（pybind11 封装 libdnn） | 新接口，旧教程失效 |

先跑这两条确认自己在哪里：

```bash
cat /etc/version
rdkos_info
```

---

## 内容导航

| 卷 | 主题 | 适合谁 |
| --- | --- | --- |
| [第 0 卷 导读与选型](docs/00-导读与选型/) | 本库怎么用、硬件速览、**生态全景与版本总线** | 所有人，**先读这卷** |
| [第 1 卷 开箱与系统安装](docs/01-开箱与系统安装/) | 配件、烧录、首启、远程登录、升级备份恢复 | 拿到新板子的人 |
| [第 2 卷 基础开发](docs/02-基础开发/) | 40PIN、摄像头、显示、音频、网络与多媒体 | 做应用开发的人 |
| [第 3 卷 AI 推理与工具链](docs/03-AI推理与工具链/) | BPU、推理接口演变、模型转换、量化调优、性能优化 | 算法工程师 |
| [第 4 卷 ROS2 与 TROS](docs/04-ROS2与TROS/) | TROS 架构、图像采集、dnn_node、编解码与桥接 | 机器人开发者 |
| [第 5 卷 进阶驱动与系统](docs/05-进阶驱动与系统/) | 驱动开发、总线调试、CAN/PoE/ISP、系统配置 | 嵌入式工程师 |
| [第 6 卷 错误反思与排障](docs/06-错误反思与排障/) | **四段式故障复盘**，按子系统分类 | 所有人，出问题就来 |
| [第 7 卷 附录与速查](docs/07-附录与速查/) | 命令速查、**报错速查表** | 所有人，当工具书用 |

### 三条推荐路径

**新手，只想先跑起来**

```
第 0 卷硬件速览 → 第 1 卷全部 → 第 2 卷挑需要的 → 出问题查第 6 卷
```

**算法工程师，要把模型部署上去**

```
第 0 卷版本总线 → 第 3 卷全部 → 第 2 卷摄像头章 → 第 6 卷第 5 章
```

**嵌入式工程师，要改驱动做产品**

```
第 5 卷全部 → 第 4 卷 → 第 6 卷
```

---

## 本库的三条写作纪律

### 1. 每条结论可溯源

正文里的技术事实后面都有出处行：

```markdown
> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）
> 来源：社区帖 35112（https://forum.d-robotics.cc/t/topic/35112）
```

没有出处行的是编者按（经验归纳），会明确区分。

### 2. 报错原文不改写

社区帖里贴的报错，本库**原样抄进代码块**，一个字不改。这样你可以直接把那段文本粘到搜索引擎或社区搜索框。

### 3. 故障按四段式写

第 6 卷的每一条故障都是固定结构：

```
### 现象     ← 原文报错，不改写
### 根因     ← 讲清机制，为什么会出现
### 处置     ← 可直接复制的命令
### 预防     ← 下次怎么避免、怎么快速定位
```

这个结构的价值在于：**同一现象的根因可能完全不同**。例如「上电反复重启」既可能是电源不足，也可能是 NAND 固件不匹配 —— 本库会并列写出，并给出区分方法。

---

## 数据来源

| 来源 | 规模 | 抓取方式 |
| --- | --- | --- |
| 官方文档站 `developer.d-robotics.cc/rdk_x_doc` | 247 个中文页面，约 131 万字符 | sitemap 全量枚举 |
| 地瓜社区论坛 `forum.d-robotics.cc` | 961 个主题帖，约 1100 万字节 | Discourse JSON API 按 50+ 关键词检索 |

官方文档的英文页面、已下架的 RDK X3 旧版页面未纳入。社区帖按关键词覆盖检索，非论坛全量。

素材快照日期：**2026-11-02**。RDKOS 版本、apt 源、驱动支持等随时间变化，遇到不一致时以官方最新文档与你的板端实测为准。

---

## 本地预览

纯 Markdown，无构建依赖。任选其一：

```bash
# 有 Node.js
npx -y docsify-cli serve docs

# 有 Python
python -m http.server 8000 --directory docs
```

然后打开 `http://localhost:8000`（docsify）或 `http://localhost:8000`（http.server），从 `docs/SUMMARY.md` 或 `README.md` 开始读。

### 质量自检

仓库自带章节校验脚本，检查：字符数下限、一级标题唯一性、禁用词（TODO/待补充）、相对链接是否死链、来源标注数量、章节结构完整性。

```bash
node scripts/check-docs.cjs
```

---

## 贡献

欢迎提 Issue 与 PR，尤其是以下几类：

- **版本过期**：你发现某段内容在你的 RDKOS 版本上不成立
- **新的踩坑**：有可复现的报错 + 根因 + 处置，欢迎按第 6 卷的四段式提交
- **官方文档变更**：官方更新后本库未同步

提交前请读 [写作规范](docs/WRITING-GUIDE.md)，核心要求是：**报错原文不改写、每条结论标出处、命令可复制**。

---

## 许可

文档内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可。

引用的官方文档内容版权归 **D-Robotics（地瓜机器人）** 所有；引用的社区帖内容版权归各原作者所有。本库仅做整理、组织与补充说明，不主张对原始内容的著作权。

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

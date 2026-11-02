---
id: 04-ROS2与TROS-01-TROS架构与安装
volume: 4
volume_title: ROS2 与 TROS
title: TROS 架构与安装
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [TROS, ROS2, Humble, apt源, 版本对应]
summary: TogetheROS.Bot 在 ROS2 Humble 之上的定位、tros-humble 包体系、apt 安装与 GPG 密钥、TROS 与 RDKOS 版本对应关系。
source_policy: "official-first, community-verified"
---
# 4.1 TROS 架构与安装

## 本章解决什么

TogetheROS.Bot（下称 TROS）是地瓜机器人基于 ROS2 二次封装的机器人操作系统，它不是「另一个 ROS2 发行版」，而是把 BPU 推理、硬件编解码、共享内存零拷贝这些板端特有能力包进 ROS2 节点里的一套发行版。本章说清三件事：TROS 到底封装了什么、它跟 RDKOS 的版本线怎么对应、以及在这块板子上怎么把它装起来和修起来。

关键前提：**TROS 与 RDKOS 是两条独立的版本号**。你嘴上说的「我的系统是 3.3.3」和「我的 TROS 是 2.4.3」是两个不同的数，混淆这两条线是本章后续所有排障错误的源头。

## 4.1.1 TROS 是什么，封了什么

官方对 TROS 的定位原文：

> 「TogetheROS.Bot 是 D-Robotics 面向机器人厂商和生态开发者推出的机器人操作系统……支持在 RDK 平台上运行，同时提供模拟器版本在 X86 平台上运行。RDK 平台涵盖下图所示的全部功能，X86 平台支持以图片回灌方式体验部分功能。」
> 来源：官方文档 Robot_development（https://developer.d-robotics.cc/rdk_x_doc/Robot_development）

三个要点：

1. **它有 X86 版本**，但不是完整功能——X86 侧只支持「图片回灌」这一种体验方式，用于在没有板子的情况下验证算法链路；涉及 BPU、VIO、硬件编解码的部分在 X86 上跑不了真数据。
2. **源码在 GitHub 的 D-Robotics 组织下**，不在 RDKOS 镜像仓库里单独发。
3. 它是**预装在系统镜像里**的，不是装完系统再装一遍的独立软件。

官方 FAQ 讲得更直白：

> 「TROS 通常在您烧录官方提供的 RDK OS 系统镜像时，就已经内置并预装在板卡上了。您不需要在烧录完系统后再手动执行完整的 TROS 安装流程。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

### 4.1.1.1 与标准 ROS2 的关系

官方给出的对应关系是按 Ubuntu 底座版本绑定的：

| RDK OS 大版本 | Ubuntu 底座 | TROS 基于的 ROS2 LTS |
| --- | --- | --- |
| RDK OS 2.x | Ubuntu 20.04 | ROS2 Foxy Fitzroy |
| RDK OS 3.x | Ubuntu 22.04 | ROS2 Humble Hawksbill |

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

RDK X5 全系基于 Ubuntu 22.04，所以 **X5 上只有 Humble 这一条线**，不存在 Foxy 版 TROS。所有 `/opt/tros/foxy/...` 的写法都是 X3 时代或老文档残留。

兼容性方面官方明确：「TROS 与对应版本的标准 ROS2 在核心 API 和通信机制上是完全兼容的，这意味着为标准 ROS2 Foxy/Humble 开发的节点和服务通常可以直接或稍作修改后在对应版本的 TROS 上运行，反之亦然。它们可以相互通信。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

但有一个**硬限制**：一个终端会话里只能 source 一个 ROS 环境。同时装 TROS 和标准 ROS2 Humble 是允许的，两者能共存，但你 `source /opt/tros/humble/setup.bash` 之后就不要再去 source `/opt/ros/humble/setup.bash`，否则 `AMENT_PREFIX_PATH` 会互相覆盖，表现为「包明明装了却 `Package not found`」。

### 4.1.1.2 三个组成部分

TROS 的功能包在组织上分三层：

| 层 | 内容 | 典型包 |
| --- | --- | --- |
| Communication | 通信与基础组件、传感器驱动、编解码、零拷贝 | `hobot_usb_cam`、`hobot_mipi_cam`、`hobot_codec`、`hobot_shm`、`hobot_cv` |
| Boxs | 算法功能包，多数基于 `hobot_dnn` | `hobot_dnn`、`hobot_mot`、`hobot_stereonet`、`mono2d_body_detection` |
| Apps | 完整应用示例 | 智能盒子（`hobot_rtsp_client`）、巡线小车、AMR |

社区整理的功能包总表把它整理得更细，并标注了每个包支持的板卡：

> 「TogetheROS.Bot（TROS）是地瓜机器人面向 RDK 的机器人操作系统，兼容 ROS 2（Foxy / Humble / Jazzy），由 Communication（通信与基础组件）、Boxs（算法功能包）、Apps（应用示例）三部分组成。」
> 来源：社区帖 35812（https://forum.d-robotics.cc/t/topic/35812）

## 4.1.2 版本对应表

这是本卷最重要的一张表。**RDKOS 版本号与 TROS 版本号不是同一个数**，官方只在部分 RDKOS 版本的发布说明里才标注同期 TROS 版本。

| RDKOS 版本 | 发布 | 同期 TROS 版本 | TROS 侧变更 |
| --- | --- | --- | --- |
| 3.2.3 | 2025-06 | 未单独标注 | 20250610 更新 ROS 仓库 GPG 签名密钥 |
| 3.3.3 | 2025-10 | **TROS V2.4.3** | 单目 MIPI 支持启动多路采集；双目 MIPI 新增 SC132GS 支持 |
| 3.4.1 | 2025-12 | 未单独标注 | 修 `hobot_cv` 的 vse resize bug；修 `hobot_dnn` 推理延迟统计错误；修 mipi_cam/算法模块 ros component so 安装路径错误；优化 `hobot_codec` 配置 |
| 3.5.0 | 2026-04 | 未单独标注 | Python 侧统一 `hbm_runtime`（**TROS 侧 C++ 仍走 `hobot_dnn`，两者不冲突**） |

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

官方原文的标题写法可以直接印证 3.3.3 与 V2.4.3 的绑定：

> 「#### TROS 更新说明（V2.4.3）​ - 单目 MIPI 图像采集：支持启动多路图像采集 - 双目 MIPI 图像采集：新增对 SC132GS 双目相机的支持」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

同一条信息在 RDK 总览页的写法是「#### TROS 算法升级 2.4.3 & 版本号：3.3.3」，把两个版本号并列，可以确认是同一件事。
> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）

3.3.3 之后官方发布说明里就没有再单独标注 TROS 版本号了。社区帖里能看到更高的 TROS tag 与版本号：

- 有位用户贴出自己的运行环境：「RDK X5，rdk_os_3.5.0-2026-4-9，tros 2.5.2」。
- `robot_dev_config` 仓库的 `git tag --list` 输出里能看到从 `tros_1.1.0` 一路到 `tros_2.5.2` 的完整 tag 序列（含 `tros_2.4.3`、`tros_2.5.0`、`tros_2.5.1`、`tros_2.5.2`）。

> 来源：社区帖 35110（https://forum.d-robotics.cc/t/topic/35110）
> 来源：社区帖 35240（https://forum.d-robotics.cc/t/topic/35240）

**所以查询自己板子上 TROS 实际版本，不要靠 RDKOS 版本号推断，要直接查包：**

```bash
# 查 tros 元包版本（这是整体的 TROS 版本号）
apt show tros-humble 2>/dev/null | grep -E "^Version"

# 查所有 tros 包及版本
apt list --installed 2>/dev/null | grep tros

# 查某个具体包的版本与来源
apt show tros-humble-hobot-dnn
```

真实输出长这样（摘自社区用户贴出的 `rdkos_info`）：

```
tros-humble/unknown,now 2.3.2-jammy.20250108.090123 arm64 [installed]
tros-humble-dnn-node/unknown,now 2.4.2-jammy.20241225.023147 arm64 [installed]
tros-humble-hobot-cv/unknown,now 2.3.0-jammy.20241225.025952 arm64 [installed]
tros-humble-hobot-codec/unknown,now 2.3.2-jammy.20241225.035052 arm64 [installed]
tros-humble-mipi-cam/unknown 2.3.7-jammy.20250312.083735 arm64 [upgradable from: 2.3.6-jammy.20250109.065921]
tros-humble-hobot-usb-cam/unknown,now 2.3.0-jammy.20241225.031650 arm64 [installed]
tros-humble-hobot-shm/unknown,now 0.0.1-jammy.20241225.030528 arm64 [installed]
tros-humble-websocket/unknown,now 2.3.2-jammy.20241225.034606 arm64 [installed]
tros-humble-hobot-rtsp-client/unknown,now 1.0.1-jammy.20241225.031516 arm64 [installed]
tros-humble-hobot-image-publisher/unknown,now 2.2.1-jammy.20241225.035542 arm64 [installed]
```

> 来源：社区帖 28538（https://forum.d-robotics.cc/t/topic/28538）

注意一个容易误读的地方：**元包 `tros-humble` 的版本（上面是 2.3.2）才是「TROS 版本」，各个功能包有自己的独立版本号**（`hobot-cv` 是 2.3.0，`dnn-node` 是 2.4.2）。所以论坛里说「hobot_dnn 需要 ≥ 2.6.1」指的是 `tros-humble-dnn-node` 这个**包**的版本，不是 TROS 整体版本。

> 来源：社区帖 34415（https://forum.d-robotics.cc/t/topic/34415）

## 4.1.3 包体系与命名规则

TROS 的包名统一前缀是 `tros-humble-`，ROS2 包名（`ros2 launch` 里用的那个）是去掉前缀、并把连字符换成下划线的形式。对应关系：

| APT 包名 | ROS2 包名 | 作用 |
| --- | --- | --- |
| `tros-humble-hobot-usb-cam` | `hobot_usb_cam` | USB 摄像头驱动节点 |
| `tros-humble-mipi-cam` | `mipi_cam` | MIPI 摄像头驱动节点 |
| `tros-humble-hobot-codec` | `hobot_codec` | 硬件编解码（MJPEG/H264/H265 与 BGR8/RGB8/NV12 互转） |
| `tros-humble-hobot-cv` | `hobot_cv` | 图像处理加速（VSE resize、crop） |
| `tros-humble-dnn-node` | `dnn_node` | 推理节点框架库 |
| `tros-humble-dnn-node-example` | `dnn_node_example` | 推理节点完整示例（可执行文件 `example`） |
| `tros-humble-hobot-shm` | `hobot_shm` | 零拷贝共享内存环境 |
| `tros-humble-websocket` | `websocket` | Web 端可视化（内含 nginx，占 8000 端口） |
| `tros-humble-hobot-rtsp-client` | `hobot_rtsp_client` | RTSP 拉流 |
| `tros-humble-hobot-image-publisher` | `hobot_image_publisher` | 本地图片/视频按 ROS 消息发布 |
| `tros-humble-hobot-vio` | `hobot_vio` | VIO 多媒体底层 |

> 来源：社区帖 28538（https://forum.d-robotics.cc/t/topic/28538）、社区帖 35812（https://forum.d-robotics.cc/t/topic/35812）

几个**安装路径**必须记住，后面每一章的排障都会用到：

| 路径 | 内容 |
| --- | --- |
| `/opt/tros/humble/setup.bash` | 环境配置脚本，每个新终端都要 source 一次 |
| `/opt/tros/humble/share/<pkg>/launch/` | launch 文件所在目录 |
| `/opt/tros/humble/lib/<pkg>/` | 可执行文件与随包 config |
| `/opt/tros/humble/lib/hobot_shm/config/shm_fastdds.xml` | 零拷贝 DDS 配置 |
| `~/.ros/log/` 或 `/root/.ros/log/` | ROS2 运行日志 |
| `/opt/hobot/model/x5/basic/` | 官方预置模型（如 `yolov8_640x640_nv12.bin`） |

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

官方 FAQ 明确给了 launch 文件的定位方法：「TROS 功能包的 launch 文件通常位于 `/opt/tros/<tros_distro>/share/<package_name>/launch/` 目录下（例如 `/opt/tros/humble/share/mipi_cam/launch/`）。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

而可执行文件在 `lib` 下。下面这条命令在官方 FAQ 的「最小化 Linux 镜像」问答里出现过，用于在没有 ros2 CLI 的环境里直接跑节点：

```bash
# 查找某个包的可执行文件
find /opt/tros/ -name example -executable -type f
# 典型结果：/opt/tros/humble/lib/dnn_node_example/example
```

> 来源：官方文档 FAQ/applications_and_examples（https://developer.d-robotics.cc/rdk_x_doc/FAQ/applications_and_examples）

## 4.1.4 APT 源配置

TROS 的包走地瓜官方 APT 源，配置文件是 `/etc/apt/sources.list.d/sunrise.list`。**源域名历史上改过几次**，老镜像上的配置基本都是错的。

### 4.1.4.1 正确的源配置

官方给出的正确写法（X5 那行是注释状态，因为文档示例是 S100 的机器）：

```
deb [signed-by=/usr/share/keyrings/sunrise.gpg] http://archive.d-robotics.cc/ubuntu-rdk-s100 jammy main #RDK S100
# deb [signed-by=/usr/share/keyrings/sunrise.gpg] http://archive.d-robotics.cc/ubuntu-rdk-x5 jammy universe #RDK X5
# deb [signed-by=/usr/share/keyrings/sunrise.gpg] http://archive.d-robotics.cc/ubuntu-rdk jammy universe #RDK X3
```

> 来源：官方文档 FAQ/hardware_and_system（https://developer.d-robotics.cc/rdk_x_doc/FAQ/hardware_and_system）

X5 上应该启用的是 `ubuntu-rdk-x5 jammy universe` 这一行。

### 4.1.4.2 域名演进与判错信号

官方列出的典型报错原文：

```
The repository '...' is no longer signed.
Could not resolve 'archive.sunrisepi.tech' (或其他旧域名)
The following signatures couldn't be verified because the public key is not available: NO_PUBKEY ...
```

> 来源：官方文档 FAQ/hardware_and_system（https://developer.d-robotics.cc/rdk_x_doc/FAQ/hardware_and_system）

根因是「地瓜机器人官方软件源域名或 GPG 签名密钥发生变更，导致本地配置过期」。
> 来源：官方文档 FAQ/hardware_and_system（https://developer.d-robotics.cc/rdk_x_doc/FAQ/hardware_and_system）

域名时间线：

| 域名 | 状态 |
| --- | --- |
| `sunrise.horizon.cc` | 旧域名，已废弃 |
| `archive.sunrisepi.tech` | 旧域名，已废弃 |
| `archive.d-robotics.cc` | 现行域名 |

官方 FAQ 在讲 TROS 包更新时给的仍是「确保 D-Robotics 官方 APT 源（如 sunrise.horizon.cc 或最新的 archive.d-robotics.cc）配置正确」这种兼容表述，说明两个域名在文档体系里都出现过，但**实际可用的只有 `archive.d-robotics.cc`**。
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

### 4.1.4.3 修复步骤（可直接复制）

```bash
# 1. 看当前配置错在哪
cat /etc/apt/sources.list.d/sunrise.list

# 2. 把旧域名批量替换为新域名
sudo sed -i 's/archive.sunrisepi.tech/archive.d-robotics.cc/g' /etc/apt/sources.list.d/sunrise.list
sudo sed -i 's/sunrise\.horizon\.cc/archive.d-robotics.cc/g' /etc/apt/sources.list.d/sunrise.list

# 3. 重新拉取 GPG 公钥（这是 3.2.3 之后最常需要的一步）
sudo wget -O /usr/share/keyrings/sunrise.gpg http://archive.d-robotics.cc/keys/sunrise.gpg

# 4. 刷新索引
sudo apt update
```

> 来源：官方文档 FAQ/hardware_and_system（https://developer.d-robotics.cc/rdk_x_doc/FAQ/hardware_and_system）

### 4.1.4.4 GPG 密钥为什么经常要更新

RDKOS 3.2.3 的镜像更新记录里有一条：

> 「20250610 - 更新 ROS 仓库 GPG 签名密钥」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

这意味着**2025-06-10 之前烧的镜像，用 apt 更新时会遇到 `NO_PUBKEY`**。处置就是上面第 3 步。这也是为什么「老镜像 + apt upgrade」几乎必踩这个坑。

### 4.1.4.5 APT 锁被占用

另一个高频报错：

```
E: Could not get lock /var/lib/apt/lists/lock. It is held by process XXXX (apt-get)
N: Be aware that removing the lock file is not a solution and may break your system.
E: Unable to lock directory /var/lib/apt/lists/
```

官方给的原因与处置：系统后台可能在跑自动更新检查，或上次 apt 未正常结束。优先等待；确认没有 apt/dpkg 进程后再 `sudo kill XXXX`；清理锁文件（`/var/lib/apt/lists/lock`、`/var/cache/apt/archives/lock`、`/var/lib/dpkg/lock`）属于**有风险操作**，官方自己加了 ⚠️ 标注，必须在确认无进程时才能做。
> 来源：官方文档 FAQ/hardware_and_system（https://developer.d-robotics.cc/rdk_x_doc/FAQ/hardware_and_system）

## 4.1.5 更新与重装

### 4.1.5.1 常规更新

```bash
sudo apt update && sudo apt upgrade
```

官方明确这条命令「会更新已安装的 TROS 包到最新版本」。
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

但有一个**升级陷阱**记录在 3.1.0 的发布说明里：从旧版本 `apt update && apt upgrade` 升到 3.1.0 时，必须先卸载 `tros-humble-stereonet-model` 再装 `tros-humble-hobot-stereonet`：

```bash
sudo apt-get remove tros-humble-stereonet-model
sudo dpkg --remove --force-all tros-humble-stereonet-model
sudo apt install -y tros-humble-hobot-stereonet
```

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

这是「包改名」导致 apt 无法自动处理依赖的典型情况。**判断方法**：如果 `apt upgrade` 报依赖冲突，先 `apt list --installed | grep <关键词>` 看是不是同名不同后缀的包并存。

### 4.1.5.2 单包重装

官方 FAQ 以 `hobot_usb_cam` 为例给了完整流程：

```bash
# 1. 找到精确包名
apt list --installed | grep hobot-usb-cam

# 2. 卸载
sudo apt remove tros-humble-hobot-usb-cam

# 3. 确认源正确并刷新
sudo apt update

# 4. 重装
sudo apt install tros-humble-hobot-usb-cam
```

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

适用场景是「怀疑某个功能包的配置文件被改乱或安装不完整」。注意这里官方用的是 `hobot-usb-cam`（连字符），而包名是 `tros-humble-hobot-usb-cam`，grep 时用不带 `tros-humble-` 前缀的关键词更稳。

### 4.1.5.3 大版本不能 apt 升级

官方明确：

> 「由于 TROS 的版本与 RDK OS 的底层 Ubuntu 版本紧密绑定（例如 Foxy 对应 Ubuntu 20.04，Humble 对应 Ubuntu 22.04），通常无法直接通过 apt upgrade 等命令将 TROS 从一个大的 LTS 版本（如 Foxy）升级到另一个大的 LTS 版本（如 Humble）。正确的升级方式是：通过烧录包含了新版本 TROS 的、对应新 Ubuntu 版本的 RDK OS 完整系统镜像。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

对 X5 用户来说这条其实不构成障碍——X5 只有 Humble 一条线。但对从 X3（Foxy）迁移过来的用户是必读的：**不能把 X3 上的 TROS 原地升到 Humble，只能换板子或换镜像**。

## 4.1.6 源码编译与交叉编译

### 4.1.6.1 什么时候需要源码编译

官方把场景分了三类：

| 场景 | 是否需要源码编译 |
| --- | --- |
| 只想体验已有功能 | **不需要**，直接烧镜像跑预编译包 |
| 要改某个功能包做二次开发 | 需要，建议板端编译或交叉编译 Docker |
| 从零构建整个 TROS 发行版 | 需要，必须用交叉编译 Docker，在 x86 上做 |

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

板端编译的前提是装好 colcon：

```bash
sudo apt update
sudo apt install python3-colcon-common-extensions python3-catkin-pkg-modules python3-rosdep
# 或者用 pip
pip3 install -U colcon-common-extensions empy
```

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

### 4.1.6.2 交叉编译 Docker 与 sysroot

官方的交叉编译方案是「Docker + sysroot + CMake 工具链文件」三件套。社区帖里贴出了完整的操作序列：

```bash
# 宿主机：建工作区并拉取构建配置仓库
mkdir -p cc_ws/tros_ws/src
cd cc_ws/tros_ws
git clone https://github.com/D-Robotics/robot_dev_config.git
git reset --hard tros_2.3.2

# 拉取 TROS 全部源码
vcs-import src < ./robot_dev_config/ros2_release.repos

# 启动交叉编译容器并挂载工作区
docker run -it --rm --entrypoint="/bin/bash" --env "TZ=Asia/Shanghai" --volume cc_ws:/cc_ws tros2:latest

# 容器内：必须先 source 系统 ROS（文档没写但少了会找不到 ament）
source /opt/ros/humble/setup.bash

cd /cc_ws/tros_ws
bash ./robot_dev_config/build.sh -p X5
```

> 来源：社区帖 28795（https://forum.d-robotics.cc/t/topic/28795）

`build.sh -p X5` 里的 `-p` 是平台参数。**不指定或指定错会静默降级到 X3**：

```
invalid platform, build platform X3 default
PREFIX_PATH: x3
```

> 来源：社区帖 28742（https://forum.d-robotics.cc/t/topic/28742）

这是交叉编译最隐蔽的坑之一：脚本不报错退出，只是按 X3 的 sysroot 去编，编出来的东西在 X5 上缺符号。

### 4.1.6.3 依赖架构问题（x86 vs arm64）

社区里最典型的疑问是「x86 上编译时依赖库都是 x86 的，怎么让它用 arm64 的库」。官方给的答案：

> 「Sysroot 环境：我们的工程目录（如 `sysroot_docker`）中包含了目标平台（ARM64）所需的系统库和依赖库，而非使用宿主机的 x86 库。工具链配置：构建脚本调用的 CMake 工具链文件（`aarch64_toolchainfile.cmake`）已经配置好了 `CMAKE_FIND_ROOT_PATH`。这意味着编译器在查找依赖时，会被强制指向上述的 ARM64 sysroot 路径。」
> 来源：社区帖 33805（https://forum.d-robotics.cc/t/topic/33805）

所以**只要严格按文档在 Docker 里跑 `build.sh`，依赖路径问题会自动处理**，不需要手动指定。反过来说，如果你在宿主机上直接 cmake，就一定会踩架构混链。

### 4.1.6.4 sysroot_docker 缺失

另一个高频故障：拉了 Docker 镜像但里面没有 `sysroot_docker` 目录，导致后续所有 `rm` / `ln` / `touch` 全报 `No such file or directory`。

```
rm: missing operand
touch: cannot touch './src/rtabmap_ros/rtabmap_demos/COLCON_IGNORE': No such file or directory
Failed <<< img_msgs [2.08s, exited with code 1]
```

> 来源：社区帖 33805（https://forum.d-robotics.cc/t/topic/33805）

**根因**是 `robot_dev_config` 的分支/tag 不对——老的分支里 `build.sh` 不包含 X5 的配置，导致 sysroot 路径解析错误。社区的稳定结论是：X5 用 `git reset --hard tros_2.3.2`。
> 来源：社区帖 35240（https://forum.d-robotics.cc/t/topic/35240）

`build.sh` 里另一类报错是源码版本不匹配：

```
CMake Error at CMakeLists.txt:201 (add_library):
Cannot find source file:
src/util/output_parser/detection/ptq_yolo8_seg_output_parser.cpp
```

社区核对后确认这是 `dnn_node` 的 CMakeLists 写错了路径（应为 `segmentation/ptq_yolo8_seg_output_parser.cpp` 却写成 `detection/`），属于**特定 tag 的仓库 bug**，换 tag 或手动改 CMakeLists 才能过。
> 来源：社区帖 28795（https://forum.d-robotics.cc/t/topic/28795）

## 4.1.7 排障：debug 日志与定位

官方 FAQ 给了一套标准流程，值得照做：

```bash
# 1. 清空旧日志，避免混入历史
rm -rf ~/.ros/log/*
# root 用户路径是 /root/.ros/log/*

# 2. 用 DEBUG 级别重跑 launch
ros2 launch <pkg> <launch.py> --ros-args --log-level DEBUG
```

也可以直接在 launch 文件的节点 `arguments` 里加 `['--ros-args', '--log-level', 'DEBUG']`。
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

提问时该带的信息，官方也列了清单：

```bash
rdkos_info
apt list --installed | grep tros
apt show <tros_package_name>
```

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

`rdkos_info` 的输出非常长（硬件型号、CPU/BPU 温度频率、内存、RDKOS 版本、内核版本、miniboot 版本、全部 hobot-* 与 tros-* 包清单、内核模块列表）。它是排查 TROS 问题的**第一手材料**，尤其是包清单部分能直接看出「哪个包版本老了」。

## 4.1.8 源码与文档去哪找

TROS 的资料分散在三个地方，官方 FAQ 给过明确指引：

> 「TROS 手册：官方 TROS 用户手册中，在介绍各个核心功能包或示例时，通常会提供对应源码的 GitHub 仓库链接。NodeHub：如果功能包是作为 NodeHub 的一部分提供，其相关介绍页面通常也会包含源码链接。GitHub D-Robotics 组织：大部分 TROS 相关的开源功能包都托管在 GitHub 上的 D-Robotics 组织下。README 文档：通常每个 TROS 功能包的源码仓库中都会包含一个详细的 `README.md` 文件。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

三个层次的定位差别很重要：

| 位置 | 提供什么 | 什么时候用 |
| --- | --- | --- |
| `/opt/tros/humble/share/` | 已安装的 launch、config、msg | 运行与改参数 |
| TROS 用户手册 | 用法、参数说明、示例 | 学怎么用 |
| GitHub `D-Robotics` 组织 | 源码、issue、PR | 改代码、看实现、查 bug 修没修 |

社区维护的资源汇总页把每个功能包的「文档 + 源码」两条链接并排列了出来，是最省时间的入口：`hobot_cv`、`hobot_dnn`、`hobot_codec`、`hobot_usb_cam`、`hobot_image_publisher` 等都在这张表里。
> 来源：社区帖 35812（https://forum.d-robotics.cc/t/topic/35812）

## 4.1.9 TROS 与 Model Zoo 的模型资源分歧

这是 2025 年到 2026 年间 TROS 用户最容易被卡住的地方：**Model Zoo 里下载的模型，默认配置下的 `dnn_node` 可能跑不了**。

官方的定性：

> 「社区开发者经常遇到一个棘手的问题：从开发者社区（Model Zoo）获取的 YOLO 系列模型，无法直接在 TROS 中使用。这主要是因为模型的输出格式与 TROS 中 `hobot_dnn` 节点的解析代码不兼容。」
> 来源：社区帖 33843（https://forum.d-robotics.cc/t/topic/33843）

根因是两条线的模型产出规范不同步：

> 「`hobot_dnn` 项目的后处理解析器（parser）当前期望其处理的 YOLO 模型输出是量化后（例如 `int32_t` 类型）的张量，因此代码中包含了反量化处理步骤。然而当前 Model Zoo 中最新的 YOLO 模型已更新，其输出层直接输出未经量化的 float（FP32）浮点型张量。这种变化导致了数据格式的不兼容：原有的解析器会错误地将 FP32 数据当作 `int32_t` 处理，导致解析失败和错误的检测结果。」
> 来源：社区帖 33843（https://forum.d-robotics.cc/t/topic/33843）

官方的处理态度是「统一」，但时间上滞后：

> 「截至 2026 年 2 月 2 日，我们已经充分意识到这一问题，并已启动一项旨在提升开发者体验的对 Model Zoo 全面重构工作……TROS 预计在下一版本尽快完成统一工作。」
> 来源：社区帖 33843（https://forum.d-robotics.cc/t/topic/33843）

在那之前，官方给了两条临时路径，分别对应新旧两套 `hobot_dnn`：

| 路径 | 前提版本 | 做法 |
| --- | --- | --- |
| 改 parser 源码 | 任意 | 把 `int32_t*` 改 `float*`、删掉反量化步骤（详见第三章） |
| 用 `ultralytics_yolo` 解析器 | `hobot_dnn` ≥ 2.6.1 | JSON 里把 `dnn_parser` 改成 `ultralytics_yolo` |

> 来源：社区帖 33843（https://forum.d-robotics.cc/t/topic/33843）、社区帖 34415（https://forum.d-robotics.cc/t/topic/34415）

**记住这个顺序**：先 `hrt_model_exec model_info` 看模型输出的 `tensor type`，是 `S32` 就用官方默认 parser，是 `F32` 就得用上面两条路径之一。不要凭「模型是从 Model Zoo 下的」就假设它能直接跑。

## 4.1.10 与标准 ROS2 共存

官方允许在板子上自行安装标准 ROS2 发行版，但给了一条明确约束：

> 「您也可以在 TROS 之外，在板卡上自行安装其他标准 ROS2 发行版（如 Foxy, Humble）或 ROS1（如 Noetic），它们可以与 TROS 共存，但如前所述，一个终端会话中只能 source 一个 ROS 环境。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

另一个必记的架构限制：

> 「任何在 x86 平台直接编译（而非交叉编译）的 ROS 功能包都不能直接在 ARM 架构的 RDK 板卡上运行，反之亦然。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

安装标准 ROS2 Humble 的软件源配置（官方给了完整命令）：

```bash
# 区域设置
sudo apt update && sudo apt install locales
sudo locale-gen en_US en_US.UTF-8
sudo update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
export LANG=en_US.UTF-8

# 加 ROS2 官方源
sudo apt install software-properties-common
sudo add-apt-repository universe
sudo apt update && sudo apt install curl -y
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

sudo apt update
```

> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

官方还提醒：「当系统中同时存在 D-Robotics TROS 的源和 ROS2 官方源时，apt 在安装或更新软件包时会根据包的版本和优先级进行选择。」
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

## 常见误区

**误区一：把 RDKOS 版本号当成 TROS 版本号。**
「我的系统是 3.3.3，所以 TROS 是 3.3.3」是错的。TROS 是 2.x 系列，3.3.3 与之对应的是 **TROS V2.4.3**。判断方法只有一条：`apt show tros-humble | grep Version`。

**误区二：以为 TROS 要单独安装。**
它随系统镜像预装。`sudo apt install tros` 这类命令在官方文档里根本不存在，能装上的只有 `tros-humble-*` 各个功能包。装不上时先查源，不要怀疑安装方式。

**误区三：在 X5 上找 Foxy 版 TROS。**
X5 全系 Ubuntu 22.04，只有 Humble。文档里 `source /opt/tros/setup.bash`（不带 `humble`）是给 X3/Foxy 用的，X5 必须用 `source /opt/tros/humble/setup.bash`。同理 `/opt/tros/foxy/` 路径在 X5 上不存在。

**误区四：交叉编译不指定平台，或用了错的 robot_dev_config 分支。**
`build.sh` 不带 `-p X5` 会静默按 X3 编（输出 `invalid platform, build platform X3 default`），编出来的包在 X5 上缺符号；`robot_dev_config` 不用 `tros_2.3.2` 会导致 `sysroot_docker` 缺失。这两个坑都不报错退出，只报一堆看似无关的 `rm: missing operand`。

**误区五：`apt upgrade` 能跨大版本升 TROS。**
不能。Foxy → Humble 只能烧新镜像。而且即便同一大版本内升级，也可能遇到包改名（`tros-humble-stereonet-model` → `tros-humble-hobot-stereonet`）需要手动先卸后装。

**误区六：把「Python 用 `hbm_runtime`」错当成「TROS 也换了推理接口」。**
RDKOS 3.5.0 起 Python 侧统一 `hbm_runtime`，但这只影响 `/app/pydev_demo/` 那套 Python 示例。**TROS 侧 C++ 推理仍然走 `hobot_dnn`**，两条线并行，互不替代。看到「Python 用 `hbm_runtime`、C++ 用 `hobot_dnn`」不要以为是文档矛盾。

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）、官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

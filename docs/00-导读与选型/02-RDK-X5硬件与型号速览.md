---
id: 00-导读与选型-02-RDK-X5硬件与型号速览
volume: 0
volume_title: 导读与选型
title: RDK X5 硬件与型号速览
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [硬件, 规格, 内存布局, 电源]
summary: X5 与 X5 Module 的型号差异、芯片规格、14 个接口、电源与 RTC 要求、约 1150MB 保留内存布局、温度传感器。
source_policy: "official-first, community-verified"
---
# 0.2 RDK X5 硬件与型号速览

## 本章解决什么

买板子之前要确认型号，写代码之前要确认接口能力，排查问题之前要确认硬件边界。这一章把 RDK X5 的硬件事实集中列出：芯片规格、接口清单、电源要求、内存布局。看完你应该能回答三个问题：我这块是什么型号？它能接什么？哪些是硬限制（改不了）而不是配置问题（能改）？

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）
> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）

## 0.2.1 型号确认：X5 与 X5 Module 不是一回事

RDK 套件包含四款硬件，本文档只覆盖其中与 X5 相关的两款：

| 型号 | 形态 | 定位 | 关键差异 |
| --- | --- | --- | --- |
| **RDK X5** | 全功能单板 | 开发者上手、原型验证 | 全板载设计，**无核心模组**；调试串口是 Micro-USB（接口 4），波特率 115200 |
| **RDK X5 Module** | 核心板 + IO 载板 | 产品化、定制开发 | 300 针高速扩展接口；调试串口在背面（接口 22），波特率 **921600** |

型号差异会直接导致「照着教程接线接不上」。最典型的两个坑：

1. **调试串口波特率不同**。X5 是 115200，X5 Module 是 921600。波特率设错，串口终端里全是乱码。
2. **电源接口规格不同**。X5 用 USB Type-C 5V/5A；X5 Module 载板也是 Type-C 5V/5A，但载板上还有独立的电源开关和 Sleep 按键。

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

### 0.2.1.1 怎么在板子上确认自己是什么型号

```bash
hrut_boardid
```

这条命令会输出板卡的 ID 与属性位。其中 DDR 容量、DDR 类型等字段是位域编码的：

| 字段 | 位 | 编码含义 |
| --- | --- | --- |
| `auto detect` | bit [31] | 0x0 = 启用 DDR 自动探测；0x1 = 不使用 LPDDR4 自动探测 |
| `ddr_type` | bit [27:24] | 0x0 = 自动探测，0x1 = LPDDR4，0x2 = LPDDR4X，0x3 = DDR4，0x4 = DDR3L |
| `capacity` | bit [19:16] | 0x0 = 自动探测，0x1 = 1GB，0x2 = 2GB，0x4 = 4GB |

> 来源：官方文档 Appendix/rdk-command-manual/cmd_hrut_boardid（https://developer.d-robotics.cc/rdk_x_doc/Appendix/rdk-command-manual/cmd_hrut_boardid）

**这解释了一个社区高频疑问**：有人 `rdkos_info` 看到的内存明显小于标称容量。这不是坏板，是 **Linux 保留内存**占掉了 —— 见下面「内存布局」一节。

## 0.2.2 芯片规格

| 项目 | 规格 |
| --- | --- |
| 主控 SoC | D-Robotics Sunrise® 5（旭日 5） |
| CPU | 8 核 ARM Cortex-A55 |
| BPU 端侧算力 | 10 TOPS |
| 内存类型 | LPDDR4（4266MHz，见机械图命名 `LPDDR4_4266MHz`） |
| 系统底座 | Ubuntu 22.04（RDKOS ≥ 3.0.0）；Ubuntu 20.04（< 3.0.0） |

> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）——「RDK X5 是一款全功能开发板，具有 10Tops 端侧推理算力与 8 核 ARM A55 处理能力，支持 2 路 MIPI Camera 接入，4 路 USB3.0 接口」
> 来源：官方文档 Quick_start/download（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/download）

**注意算力口径**：10 TOPS 是 BPU 的定点（INT8）推理算力，不是 FP32 算力，也不是 CPU 算力。任何「我的模型跑不到标称帧率」的讨论，都要先把这点对齐 —— 模型里如果有大量算子 fallback 到 CPU，实际性能与 10 TOPS 无关。

## 0.2.3 接口清单

RDK X5（单板）正面 14 个接口位：

| 序号 | 功能 | 说明 |
| --- | --- | --- |
| 1 | 供电接口 | USB Type-C，需 5V/5A |
| 2 | RTC 电池接口 | 靠近 PWR 的引脚为 B+，另一为 GND |
| 3 | 闪连接口 | USB Type-C，用于刷机/ADB |
| 4 | 调试串口 | Micro-USB，115200-8-N-1 |
| 5 | MIPI Camera 接口 | **2 路** |
| 6 | 千兆以太网口 | 1000BASE-T / 100BASE-T，**支持 PoE** |
| 7 | USB 3.0 Type-A | **4 路** |
| 8 | CAN FD 接口 | 高速 CAN FD |
| 9 | 40PIN 接口 | GPIO / I2C / SPI / UART / PWM |
| 10 | HDMI 显示接口 | 最高 1080P |
| 11 | 耳机接口 | 多标准兼容，板载 ES8326 |
| 12 | 板载 Wi-Fi 天线 | IPEX 1 代，2.4G/5G |
| 13 | TF 卡接口 | 底面，Micro SD |
| 14 | LCD 显示接口 | MIPI DSI，22pin |

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

RDK X5 Module 载板把部分接口做了外围器件转换，这决定了它们的**实际能力边界**：

| 接口 | 实现方式 | 影响 |
| --- | --- | --- |
| CAN | **TCAN4550，SPI 转 CAN** | 不是 SoC 原生 CAN，吞吐与延迟受 SPI 限制 |
| 耳机音频 | ES8326B，I2S 转 DAC&ADC | 走 I2S，不是 USB Audio |
| 4 路 USB 3.0 | **GL3510 USB Hub 扩展** | 4 路共享上行带宽，不是 4 条独立通道 |

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

「4 路 USB 共享 Hub 上行带宽」是一条容易被忽略的硬限制：接 4 个高帧率 USB 摄像头时总带宽会打满，表现是掉帧或 `select timeout`，而不是某个摄像头单独坏掉。

## 0.2.4 电源：最容易误判的硬约束

| 项目 | 要求 |
| --- | --- |
| 供电接口 | USB Type-C（接口 1） |
| 电压电流 | **5V/5A**（官方原文「需要使用支持 5V/5A 的电源适配器」） |
| 禁止 | **不要用电脑 USB 口供电** |
| 电源指示灯 | 绿色 PWR 亮 = 供电正常 |
| 状态指示灯 | 绿色 ACT 闪烁 = 系统运行正常（3.1.0 之后为橙色状态灯闪烁） |

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）——「请不要使用电脑 USB 接口为开发板供电，否则会因供电不足造成开发板异常断电、反复重启等情况」

电脑 USB 口典型输出 0.5A~0.9A，与 5A 差一个数量级。**供电不足的故障形态非常隐蔽**：

- 能开机，但跑一段时间随机卡死
- 网络时断时续（Wi-Fi 掉线、SSH 断连）
- 插拔电源又能起来，但进不了桌面

这类现象在社区里被归因成「系统 bug」「Wi-Fi 驱动问题」的比例很高，实际根因是电源。排查顺序上，**电源永远是第一步**。

> 来源：社区帖 35112（https://forum.d-robotics.cc/t/topic/35112）

RTC 电池另有独立要求，很多人忽略：

| 项目 | 要求 |
| --- | --- |
| 供电电压 | 2~3.3V |
| 放电电流 | > 2.5uA |
| 可承受最大充电电压 | ≥ 3.3V |
| 可允许最大充入电流 | > 1mA |

**非充电电池不能用于 RTC 供电** —— 板子会尝试给它充电。

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

## 0.2.5 内存布局：为什么可用内存小于标称

这是 RDK X5 最容易被误解的一处。Linux 设备树里预留了七段专用内存，**`free` 命令显示的可用内存已经排除了它们**，所以看起来「少了一大块」。

| 内存划分 | 作用 | 地址范围 | 大小 |
| --- | --- | --- | --- |
| `kernel_ram` | 内核代码与数据 | 0x8000_0000..0x87FF_FFFF | 128 MB |
| `uboot_log_reserved` | 内核获取启动日志 | 0x87FF_C000..0x87FF_FFFF | 16 KB |
| `cma_reserved` | CMA 内存分配 | 0x8800_0000..0x9FDF_FFFF | 382 MB |
| `firewall_ddr_default` | firewall 违例时导向地址 | 0x9FE7_F000..0x9FE7_FFFF | 4 KB |
| `adsp_ddr` | ADSP 固件 | 0x9FE8_0000..0xA207_FFFF | 34 MB |
| `ramoops_reserved` | ramoops 临时分配 | 0xA408_0000..0xA40B_FFFF | 256 KB |
| `ion_reserved` | ION 内存分配 | 0xA410_0000..0xD40F_FFFF | 768 MB |

**保留内存默认合计约 1150MB。**

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/memory（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/memory）

Linux 可访问的 DDR 范围是 `0x8400_0000` 到 `0x8000_0000 + DDR 容量`。保留空间的定义在 `arch/arm64/boot/dts/hobot/x5-memory.dtsi`。

查看真实分配：

```bash
cat /proc/iomem
free -h
```

### 0.2.5.1 ION 内存与三个区域

ION 是内核里管设备间内存共享的子系统。在 X5 上，ION 内存被四类使用者共享：

- BPU 子系统
- HIFI 子系统（DSP）
- 开发者通过 `hbmem` 接口分配的 ION 内存
- 多媒体系统（VIN、ISP、VSE、GDC、VPU、OSD、GPU、Display）

X5 主要用三个 ION 区域，分工明确：

| 区域 | 主要服务对象 |
| --- | --- |
| `cma_reserved` | 多媒体系统 |
| `carveout` | BPU 子系统 |
| `ion_cma` | 备用：上面两个区域没空间时自动从这里申请 |

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/memory（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/memory）

调整 ION 区域大小用 `srpi-config`（ION memory 一节）。这是解决「多路摄像头时内存分配失败」的正规手段。

## 0.2.6 温度传感器

X5 有三个温度传感器，分别对应 DDR / BPU / CPU：

```bash
cat /sys/class/hwmon/hwmon0/temp1_input   # DDR
cat /sys/class/hwmon/hwmon0/temp2_input   # BPU
cat /sys/class/hwmon/hwmon0/temp3_input   # CPU
```

温度精度为 0.001 摄氏度 —— 读到 `45000` 就是 45.000°C，不是 45000 度。

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/driver_thermal_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_thermal_dev）

CPU / GPU 3D / BPU / DDR 都支持调频，其中 **CPU 支持调压**，其余只调频。这条差异在超频与功耗调优时很关键。

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/driver_lowpower（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_lowpower）

## 0.2.7 存储与外设

| 项目 | 规格 | 注意 |
| --- | --- | --- |
| Micro SD | 接口 13（底面） | 推荐 ≥ 16GB；**运行中禁止热插拔**，会损坏文件系统 |
| HDMI | 接口 10 | 最高 1080P；Server 版只显示 logo |
| LCD | MIPI DSI，22pin | 可用 `DSI-Cable-12cm` 接树莓派款 LCD |
| MIPI Camera | 2 路 | **开发板未断电时禁止插拔摄像头**，极易烧坏模组 |
| Wi-Fi 天线 | IPEX 1 代，2.4G/5G | 装金属外壳时必须接外置天线 |

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

「未断电插拔 MIPI 摄像头会烧模组」是硬件级红线，不是危言耸听：MIPI CSI 带电插拔会产生瞬态电流冲击，官方明确警告过。

## 0.2.8 默认网络配置

有线网口默认是**静态 IP**：

| 项目 | 值 |
| --- | --- |
| 接口 | `eth0` |
| 模式 | 静态 |
| 默认 IP | `192.168.127.10` |

确认实际 IP：

```bash
ifconfig eth0
```

> 来源：官方文档 Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

这条默认值解释了「网线直连电脑却 ping 不通」的常见现象：电脑网卡不在 `192.168.127.0/24` 网段。要么改电脑网段，要么板端改 IP。

## 0.2.9 官方配件与资料

| 资料 | 链接 |
| --- | --- |
| RDK X5 规格书 | https://archive.d-robotics.cc/downloads/hardware/rdk_x5/RDX%20X5.pdf |
| RDK X5 原理图 | https://archive.d-robotics.cc/downloads/hardware/rdk_x5/RDK_X5_IO_CONN_PUBLIC_V1.1.pdf |
| 3D 机械尺寸图（STEP） | https://archive.d-robotics.cc/downloads/hardware/rdk_x5/RDK_X5_LPDDR4_4266MHz_V1P0_pcb.stp |
| 2D 机械图 top（DXF） | https://archive.d-robotics.cc/downloads/hardware/rdk_x5/RDK_X5_LPDDR4_4266MHz_V1P0_top_dxf.dxf |
| 2D 机械图 bottom（DXF） | https://archive.d-robotics.cc/downloads/hardware/rdk_x5/RDK_X5_LPDDR4_4266MHz_V1P0_bottom_dxf.dxf |

> 来源：官方文档 Advanced_development/hardware_development/rdk_x5/hardware（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/hardware）

官方认证配件中，电源型号值得记下来 —— 自己配电源是最容易出错的地方：

| 类型 | 供应商 | 型号 | 描述 |
| --- | --- | --- | --- |
| 电源 | 微雪 | `PSU-27W-USB-C-CN-B` | Type-C 接口 5V/5A 定制电源 |
| 外壳 | 地瓜机器人 | RDK X5 Case | 全金属黑色外壳 |
| PoE 模块 | 微雪 | RDK X5 PoE Module | 40PIN 连接，兼容 IEEE 802.3af/at，全隔离 SMPS |
| IMU | 地瓜机器人 | RDK IMU Module | 6 轴 BMI088，I2C 接口 |

> 来源：官方文档 Quick_start/accessory（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/accessory）

### 0.2.9.1 MIPI 摄像头选型（官方认证清单摘录）

| 型号 | 像素 | 默认分辨率 | 最大分辨率 | 备注 |
| --- | --- | --- | --- | --- |
| OV5647 | 500W | 1920x1080@30fps | 2592x1944@15fps | FOV 对角 160° |
| IMX219 | 800W | 1920x1080@30fps | 3264x2464@15fps | 注意有「Jetson Nano 版」与「Pi5 版」两种 FOV |
| IMX477 | 1230W | 1920x1080@50fps | 4000x3000@10fps | 支持 1280x960@120fps |
| IMX415 | 800W | 待测试 | 待测试 | 22PIN 无需转接板 |
| SC132GS（双目） | 130W | 1280×1080@120fps | — | 全局快门，GS130W / GS130WI |

**IMX219 有两种 FOV 版本**（160° 与 120°），Pi5 版需要先用 `srpi-config` 切换效果库，否则出图异常。这是社区里反复出现的坑。

> 来源：官方文档 Quick_start/accessory（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/accessory）

## 常见误区

1. **「标称 8GB 内存，`free` 只有 6GB 多，板子有问题」** —— 正常。约 1150MB 被设备树保留给 kernel、CMA、ADSP、ION 等，`free` 已排除这部分。
2. **「电脑 USB 口也能供电，能开机就行」** —— 能开机不等于能用。供电不足表现为随机卡死与网络异常，会误导你排查软件一整天。
3. **「X5 和 X5 Module 教程通用」** —— 波特率（115200 vs 921600）、电源接口、调试口位置都不同。
4. **「USB 3.0 有 4 路，所以有 4 倍带宽」** —— 载板上经 GL3510 Hub 扩展，4 路共享上行带宽。
5. **「10 TOPS 意味着我的模型能跑到某个帧率」** —— 10 TOPS 是 INT8 定点算力上限。算子 fallback 到 CPU、内存拷贝开销、后处理都会吃掉实际性能。

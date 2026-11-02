# CAN、PoE 与 ISP 摄像头调试

## 本章解决什么

X5 上有三块「接上外设之后才发现不懂」的区域：CAN 总线（板载 TCAN4550，走 SPI 转 CAN FD）、PoE 供电（板子不是完整 PD 设备，需要外挂 Hat）、以及 ISP 摄像头（涉及 sensor 适配、V4L2、效果库调参三层）。

本章分别讲清三件事：**CAN 怎么配、怎么测、为什么会在跑十几分钟后卡死**；**PoE 的电流路径到底怎么走、为什么必须用 802.3at**；**ISP 的系统结构、3A 算法如何与固件交互、V4L2 三种工作模式和常见 sensor 适配失败原因**。三块内容互不相关，但共享一个前提：都必须先确认硬件链路，再动软件。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__can（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/can）、__POE（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/POE）、__V4l2（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/V4l2）

## 一、CAN 与 CAN FD

### 硬件：TCAN4550 与终端电阻

X5 板载 **TCAN4550**：带有集成 CAN FD 收发器的 CAN FD 控制器，支持高达 8Mbps 数据速率，符合 ISO11898-1:2015（数据链路层）与 ISO11898-2:2016（物理层）规范。它通过 **SPI 接口**在 CAN 总线和系统处理器之间搭桥，所以本质上是「SPI 转 CAN」，不是 SoC 内置的 CAN 控制器。

对开发者的实际意义：

- 支持经典 CAN 与 CAN FD 两种模式；
- 板端支持 1M 的 CAN、2M 的 CAN FD（这是官方给出的实测口径）；
- CAN 接口配备 **一个 120Ω 终端电阻开关**，需要启用时闭合开关即可；
- 端子接口型号：**SH1.0 1X3P**。

**终端电阻的使用条件**（官方原文）：

> 如果距离过长（大于 1 米），速率过大（大于 125Kbps），需要闭合 RDK X5 的终端电阻开关，对端设备也要使能 120 欧姆的电阻。这样做会消除信号反射，保证总线的稳定通信。

社区经验把这条讲得更实操：整条 CAN 总线两端各需要一颗 120Ω 电阻，保持总线电阻为 60 欧（两颗 120Ω 并联）。**用万用表量 CAN_H 与 CAN_L 之间的电阻，应该接近 60Ω**，这是判断终端电阻装没装对的最快方法。

同时社区强调另外两点容易被忽略的：

- **GND 必须共地**。CAN 是差分信号但不是悬空的，没有共地会出现莫名其妙的 bus-off。
- **不要把 H/L 接反**。接反不会烧东西，但 `can0` 会一直收不到任何报文。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__can、社区帖 35199（https://forum.d-robotics.cc/t/topic/35199）

### 设备树配置

CAN 挂在 SPI5 上：

```dts
&spi5 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi5grp>;

    tcan4x5x: tcan4x5x@0 {
        compatible = "ti,tcan4x5x";
        reg = <0>;
        #address-cells = <1>;
        #size-cells = <0>;
        spi-max-frequency = <10000000>;
        bosch,mram-cfg = <0x0 0 0 16 0 0 0 1>;
        interrupt-parent = <&gpio1>;
        interrupts = <15 IRQ_TYPE_LEVEL_LOW>;
        reset-gpios = <&gpio1 14 GPIO_ACTIVE_LOW>;
    };
};
```

驱动代码位置：

```text
kernel/drivers/net/can/m_can/tcan4x5x-core.c
```

**关键约束：CAN 与 spidev 只能二选一**。因为两者都接在 spi5 上。如果你在 `config.txt` 里加了：

```text
dtoverlay=dtoverlay_spi5_spidev
```

那 `can0` 就没了。这是硬件设计的既定事实，不是配置错误。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__can、System_configuration__config_txt（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/config_txt）

### can-utils 工具集

| 工具 | 用途 | 典型命令 |
| --- | --- | --- |
| `candump` | 捕获并显示 CAN 数据 | `candump can0` |
| `cansend` | 发送单个 CAN 帧 | `cansend can0 123#1122334455667788` |
| `canplayer` | 回放 candump 录制的日志 | `canplayer -I candump.log` |
| `cangen` | 生成随机或规则 CAN 流量 | `cangen can0 -I 1A -L 8 -D i -g 10 -n 100` |
| `cansequence` | 发送递增载荷帧并检查丢帧 | `cansequence can0` |
| `cansniffer` | 只显示变化的数据 | `cansniffer can0` |

常用过滤与录制：

```bash
# 只显示 ID 为 123 的帧
candump can0,123:7FF

# 记录到文件，默认文件名格式 candump-日期.log
candump -l can0

# 回放
canplayer -I candump.log
```

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__can

### 回环测试（经典 CAN）

```bash
sudo ip link set down can0
sudo ip link set can0 type can bitrate 125000
sudo ip link set can0 type can loopback on
sudo ip link set up can0

# 查看配置是否生效
ip -details link show can0

# 后台接收（不能阻塞串口，后面还要发）
candump can0 -L &

# 发送
cansend can0 123#1122334455667788
```

正常情况下发送后会立即收到自己发的帧。回环模式的作用是把收发关在芯片内部，**完全排除外部接线与终端电阻的干扰**，是验证驱动是否正常工作的第一步。

### CAN FD 回环测试

仲裁段 500K、数据段 2M：

```bash
sudo ip link set can0 down
sudo ip link set can0 type can bitrate 500000 dbitrate 2000000 fd on
sudo ip link set can0 type can loopback on
sudo ip link set can0 up

candump can0 -L &
# CAN FD 帧用 ## 表示，后面跟长度码与数据
cansend can0 123##300112233445566778899aabbccddeeff
```

**注意 CAN 与 CAN FD 的帧格式差异**：经典 CAN 用 `#`，CAN FD 用 `##`。写成 `#` 发 FD 数据会被按经典帧解析，长度截断到 8 字节。

### 双设备通信

硬件连接：GND 接 GND，L 接 L，H 接 H。两台设备配置相同的位速率：

```bash
# 两台都执行
sudo ip link set can0 down
sudo ip link set can0 type can bitrate 125000
sudo ip link set can0 up

# 一台接收
candump can0 -L

# 另一台发送
cansend can0 123#1122334455667788
```

### 实战配置：加 restart-ms

社区帖 35199 给的 DJI 电调场景配置值得作为模板，因为它的三个参数各有明确用途：

```bash
sudo ip link set can0 down 2>/dev/null
sudo ip link set can0 type can bitrate 1000000 restart-ms 100
sudo ip link set can0 up
ip -details link show can0
```

| 参数 | 作用 |
| --- | --- |
| `bitrate 1000000` | DJI 电调波特率写死 1M，不能改 |
| `restart-ms 100` | bus-off 后 100ms 自动恢复，调试期间拔插不至于手动重启 |
| `ip -details` 里的 `state` | 正常应为 `ERROR-ACTIVE`；若是 `BUS-OFF` 基本就是终端电阻或接线问题 |

把它写进 `/etc/network/interfaces.d/can0` 或做成 systemd 服务，开机自动配置。

> 来源：社区帖 35199（https://forum.d-robotics.cc/t/topic/35199）

### CAN 卡死问题：一个必须知道的已知缺陷

社区帖 34260 是一个浏览量 955、回复 70 的长帖，标题就是「RDK X5 can 卡死问题」：

> RDK X5 的 CAN 有遇到过卡死的问题吗 500khz 120欧姆 双绞都测试了 每5ms下发一个CAN帧 持续个10多分钟 rdk 的 can 收发就会卡死

这是**驱动层缺陷**，不是接线问题。社区帖 35199 给出了确切的处置方案：

> RDK X5 出厂的 hobot-boot 包对 m_can 的中断处理有个小问题。D-Robotics 后来发布了修复版的 boot 包，装上就好了。

```bash
# 下载修复包
wget https://archive.d-robotics.cc/downloads/fix_deb/hobot-boot_3.1.0-20260518154347_arm64.deb

# 安装并重启
sudo dpkg -i hobot-boot_3.1.0-20260518154347_arm64.deb
sudo reboot
```

重启后 `can0` 的 RX 恢复正常。

**识别特征**：高频周期发送（如 5ms 一帧）、持续十几分钟以上、收发突然完全停止、`dmesg | grep can` 里能看到错误。接线和终端电阻全部正确的情况下依然复现，就该怀疑这个缺陷。判断方法是把发送间隔放慢到 10~20ms 观察是否还卡——如果慢了就不卡，八成就是这个中断处理问题，直接上补丁包，不要在接线和配置上继续耗。

另外社区还提到一条线索：`LNX6.1.83_PL5.1_V1.1.1` 版本更新了 CAN 驱动，若使用旧版 SDK（V1.0.x）建议升级。

> 来源：社区帖 34260（https://forum.d-robotics.cc/t/topic/34260）、社区帖 35199（https://forum.d-robotics.cc/t/topic/35199）

### SocketCAN 编程

Linux 把 CAN 总线抽象成网络接口，用标准 socket API 就能收发，不需要额外 SDK。

```c
#include <linux/can.h>
#include <linux/can/raw.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>

int main(void)
{
    int sock;
    struct sockaddr_can addr;
    struct ifreq ifr;
    struct can_frame frame;

    sock = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    strcpy(ifr.ifr_name, "can0");
    ioctl(sock, SIOCGIFINDEX, &ifr);

    addr.can_family = AF_CAN;
    addr.can_ifindex = ifr.ifr_ifindex;
    bind(sock, (struct sockaddr *)&addr, sizeof(addr));

    frame.can_id = 0x123;
    frame.can_dlc = 8;
    memset(frame.data, 0x11, 8);
    write(sock, &frame, sizeof(frame));

    while (read(sock, &frame, sizeof(frame)) > 0) {
        printf("Received: ID: 0x%X Data: ", frame.can_id);
        for (int i = 0; i < frame.can_dlc; i++)
            printf("%02X ", frame.data[i]);
        printf("\n");
    }
    close(sock);
    return 0;
}
```

```bash
gcc -o can_loopback can_loopback.c
sudo ./can_loopback
```

Python 版本（来自社区实战）：

```python
import socket, struct

s = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
s.bind(('can0',))

# SocketCAN 帧格式：can_id(4B) + dlc(1B) + pad(3B) + data(8B)
data = struct.pack('>hhhh', 1000, 0, 0, 0)     # 4 个 int16 大端
frame = struct.pack('=IB3x8s', 0x200, 8, data) # '=' 强制 native byte order
s.send(frame)

raw = s.recv(16)
can_id, dlc, _, data = struct.unpack('=IB3x8s', raw)
```

社区特别提醒的两个要点：

- `struct.pack('=IB3x8s', ...)` 里的 `=` 是关键，强制 native byte order，否则在 ARM64 上对齐会错位；
- CAN socket 默认会收到总线上所有帧，可以用 `s.setsockopt(socket.SOL_CAN_RAW, socket.CAN_RAW_FILTER, ...)` 做硬件级过滤，减少 CPU 开销。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__can、社区帖 35199

## 二、PoE 供电

### X5 在 PoE 系统里的真实角色

这是最容易误解的一点。官方原文：

> RDK X5 支持通过 PoE 系统供电，但是其本身并非完整的 PSE 设备或 PD 设备。RDK X5 在其中扮演的角色为：PD 设备的前端、PD 设备的后端负载。

拆开讲：

- **PSE**（Power sourcing equipment）：供电设备，比如 PoE 交换机；
- **PD**（Powered device）：受电设备，即被 PoE 供电的终端。

X5 既不是 PSE 也不是完整的 PD，它是「PD 的前半段 + 后半段的负载」。所以**必须外接一个第三方 PoE Hat（PD 电路）才能工作**，X5 自己不会把线上的 PoE 电压转成 5V。

### 电流路径

X5 板载的 RJ45 座内置变压器，可以输出 AC 交流电源，接口位于以太网连接器旁边的 **4PIN 针脚**。

完整路径分两步：

| 路径 | 从 | 到 | 说明 |
| --- | --- | --- | --- |
| ① | RJ45 旁的 4PIN 针脚 | 外部 PoE Hat 输入 | 送 AC 电源进 PD 电路 |
| ② | PoE Hat 输出 DC | X5 40PIN 的 5V 针脚 | 给板子供电 |

PoE Hat 的核心功能是把输入的 AC 电源转成 DC 电源。**对 X5 而言，要求该 DC 电源为 5V（MAX 5.2V）**。

### 标准选择

常见 PoE 协议：

| 标准 | 最高功率 | 用途 |
| --- | --- | --- |
| IEEE 802.3af | 15W | 基础 PoE |
| IEEE 802.3at | 30W | PoE+ |

**地瓜推荐使用 IEEE 802.3at 标准**的 PoE 方案，以保证 RDK X5 及相关外设的可靠使用。原因很直接：X5 的 40PIN 上 3.3V 最大输出 800mA、5V 最大输出 500mA，在这个负载下要求输入适配器至少 25W 带载能力。802.3af 的 15W 上限覆盖不住 25W 的需求，只能勉强点亮板子，接外设就掉电重启。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__POE（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/POE）、Basic_Application__01_40pin_user_sample__40pin_define（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/40pin_define）

## 三、ISP 与摄像头

### HBN 框架与四个关键模块

HBN 框架覆盖 Camera Sensor 采集链路的大部分模块，包括 VIN、ISP、VSE、GDC、N2D。其中 **VIN、ISP、VSE 可以通过 V4L2 接口访问**。

| 模块 | 全称 | 解释 |
| --- | --- | --- |
| VIN | Video Input | 软件概念，包含 MIPI、SIF，接收单路或多路 Camera sensor 数据，直接送下游 ISP 或写 DDR |
| SIF | Sensor Interface | 衔接 MIPI 口，把 MIPI 收到的数据帧送下游 ISP 或直接写 DDR |
| ISP | Image Signal Processor | 图像信号处理器 |
| VSE | Video Scaler | 图像的裁剪、缩放、颜色空间转换 |

VIN 用于图像采集，可以从 4 路 SIF 接口采集原生图像（一般为 RAW 格式）；ISP 输出处理后的 NV12；VSE 负责缩放。

VSE 的硬件能力（X5）：

| 项 | 规格 |
| --- | --- |
| 最大处理能力 | 3840x2160@60fps |
| 通道构成 | 5 个 downscale + 1 个 upscale |
| downscale 最大分辨率 | 4K / 1080P / 1080P / 720P / 720P |
| 最小分辨率 | 64x64，支持任意 downscale factor |
| upscale 最大分辨率 | 4K，最大放大倍数 4X（支持 0~4） |

通道编号与功能：

| 输出通道 | 类型 | 功能 |
| --- | --- | --- |
| 0 | offline | 4K Downscale |
| 1 | offline | 1080P Downscale |
| 2 | offline | 1080P Downscale |
| 3 | offline | 720P Downscale |
| 4 | offline | 720P Downscale |
| 5 | offline | 4K Upscale |

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__V4l2（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/V4l2）

### 三种工作模式

| 模式 | 说明 | 适用场景 |
| --- | --- | --- |
| HBN 常规模式 | Camera 单独一套 API，VIN/ISP/VSE/GDC/Codec 用 vnode 抽象，多个 vnode 组成 vflow；Camera 与 VIN 通过 attach 绑定 | 官方示例、TROS 应用 |
| V4L2 sif-isp-vse | camera 通过 V4L2 sensor 驱动添加，VIN/ISP/VSE 都提供对应 video 设备节点，直接走 V4L2 API | 需要标准 V4L2 接口的第三方应用 |
| V4L2 vse alone | 只提供 VSE 通道的 video 设备节点，用户回灌图像给 VSE 处理 | 独立做缩放/色彩转换 |

HBN 常规模式的特点：用户只需调用 HBN 接口完成模块初始化与绑定，vflow 建立并启动后**不需要关心数据帧的传递**，X5 内部会把数据帧由上游传到下游。这是官方推荐的默认路径，也是性能最好的路径（走内部 zero-copy）。

### 切换到 V4L2 模式

```bash
sudo srpi-config
# 3 Interface Options -> I7 V4L2
# I1 V4L2 Enable/disable V4L2 interface for camera
```

选择 `sif-isp-vse` 后会弹出 CAM0 / CAM1 摄像头选择：

- **X5 RDK**：cam0 靠近网口，cam1 远离网口；
- **X5 MD**：观察载板丝印。

**配置完成后必须重启板卡**。

确认 V4L2 模式生效：

```bash
lsmod | grep -E "v4l|imx|ov|sc"
```

应能看到 v4l 相关驱动和 sensor 相关驱动。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__V4l2

### 设备节点映射表（必须记）

X5 的 V4L2 video 节点数量很多，四路 CSI 各有一套 SIF/ISP/VSE，编号不连续，**必须查表不能猜**：

| 通道 | SIF | ISP | VSE0 | VSE1 | VSE2 | VSE3 | VSE4 | VSE5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CSI0 | `/dev/video0` | `/dev/video4` | `/dev/video8` | `/dev/video9` | `/dev/video10` | `/dev/video11` | `/dev/video12` | `/dev/video13` |
| CSI1 | `/dev/video1` | `/dev/video5` | `/dev/video14` | `/dev/video15` | `/dev/video16` | `/dev/video17` | `/dev/video18` | `/dev/video19` |
| CSI2 | `/dev/video2` | `/dev/video6` | `/dev/video20` | `/dev/video21` | `/dev/video22` | `/dev/video23` | `/dev/video24` | `/dev/video25` |
| CSI3 | `/dev/video3` | `/dev/video7` | `/dev/video26` | `/dev/video27` | `/dev/video28` | `/dev/video29` | `/dev/video30` | `/dev/video31` |

注意 **ISP 节点是 4~7，不是 1~3**——`/dev/video1`/`2`/`3` 是 CSI1/2/3 的 SIF。这是新手最常取错节点的地方：想取 ISP 输出却打开了 `/dev/video1`，拿到的是 RAW。

查看实际拓扑：

```bash
media-ctl -d /dev/media0 --print-dot > media0.dot
dot -Tpng media0.dot -o media0.png
```

这条命令展示 `/dev/media0` 的 Media Pipeline 结构，包括传感器、ISP、视频节点、数据流路径。**改 sensor 配置或怀疑链路断开时，先看这张图**。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__V4l2

### V4L2 抓图

```bash
# 1. 查支持的分辨率与编码方式，同时让驱动完成初始化
v4l2-ctl --list-formats-ext --device /dev/video4

# 2. 抓一帧 NV12
v4l2-ctl -d /dev/video4 \
  --set-fmt-video=width=640,height=480,pixelformat=NV12 \
  --stream-mmap=3 \
  --stream-skip=3 \
  --stream-to=/tmp/nv12.yuv \
  --stream-count=1 \
  --stream-poll
```

`--stream-skip=3` 是必要的：前几帧 ISP 的 3A 还没收敛（AE 未稳定、AWB 未收敛），直接取第 1 帧会得到一张过暗或偏色的图。跳过 3 帧再取，是拿「可用图像」的最小代价。

官方 C 示例：

```bash
cd /app/cdev_demo/v4l2/
sudo make
```

参数说明：

| 参数 | 含义 |
| --- | --- |
| `-w` | sensor 输出宽 |
| `-h` | sensor 输出高 |
| `-c` | 采集图片数量 |
| `-n` | sensor 采集 video 节点 |
| `-o` | 输入 NV12 图像 video 节点 |
| `-i` | 输入 NV12 图像路径 |

```bash
# sif-isp-vse 模式采集图像存盘
./v4l2 -w 1920 -h 1080 -c 10 -n 4

# vse alone 模式：拿 1080p.yuv 作输入，缩放后存盘
./v4l2 -w 1920 -h 1080 -c 10 -n 2 -o 2 -i ./1080p.yuv
```

### V4L2 的两个已知限制

官方明确列出的已知问题，遇到时不要当 bug 查：

1. **取 VSE 流时，强制选择 1920x1080 分辨率的 ISP sensor 配置文件**。也就是说想用 VSE 就得让 sensor 跑 1080p，不能配低分辨率省带宽。
2. **V4L2 vse alone 模式仅支持使用 VSE 通道 2** 回灌图像、获取处理结果。其他通道在这个模式下不可用。

另外，多媒体示例会根据 `srpi-config` 的配置自动选择摄像头，**如果 cam0 和 cam1 都配置了，默认选 cam1**。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__V4l2

### ISP 系统结构

ISP 是整个多媒体链路里最复杂的模块。理解它需要抓住「ISP Firmware 分两部分」这个结构：

- **内核空间 Firmware**：随系统启动而初始化；
- **用户空间 Firmware**（内含默认 3A 算法）：由 `HB_VIN_StartPipe` 接口启动。

Firmware 启动过程中**会优先选择外部 3A 算法**，如果未注册外部 3A 算法，才启动默认 3A 算法。

每类算法都有对应的两个输入参数和一个输出参数：

| 参数 | 内容 |
| --- | --- |
| 统计数据（stats） | ISP 硬件统计出的直方图、区域均值等 |
| 输入参数（input） | 校准数据、当前状态 |
| 输出参数（output） | 算法计算出的增益、曝光、色温等 |

在每帧统计数据 Ready 后，ISP Firmware 调用 `proc_func` 回调，传入两个输入参数；`proc_func` 是实际的算法实现，算法计算后填充输出参数；ISP Firmware 把输出参数应用到 Sensor 或 ISP 硬件。

### 3A 算法注册

AE、AWB、AF 三类的注册方式完全一致，都实现三个回调：

| 回调 | 说明 |
| --- | --- |
| `init_func` | 算法初始化函数 |
| `proc_func` | 实际算法实现，ISP Firmware 在每帧对应统计数据 Ready 时调用 |
| `deinit_func` | 算法去初始化函数 |

以 AWB 为例：

```c
ISP_AWB_FUNC_S stAwbFunc = {
    .init_func   = awb_init_func,
    .proc_func   = awb_proc_func,
    .deinit_func = awb_deinit_func,
};

HB_ISP_AWBLibRegCallback(0, "libawb.so", &stAwbFunc);

void *awb_init_func(uint32_t ctx_id)
{
    pr_info("ctx id is %d", ctx_id);
    return NULL;
}

int32_t awb_proc_func(void *awb_ctx, awb_stats_data_t *stats,
                      awb_input_data_t *input, awb_output_data_t *output)
{
    awb_acamera_core_obj_t *p_awb_core_obj = (awb_acamera_core_obj_t *)awb_ctx;
    awb_acamera_input_t *p_acamera_input = (awb_acamera_input_t *)input->acamera_input;
    awb_calibration_data_t *p_cali_data = &(p_acamera_input->cali_data);
    awb_acamera_output_t *p_acamera_output = (awb_acamera_output_t *)output->acamera_output;

    /* 具体算法实现，传入 input、统计数据进行计算 */
    awb_calc_avg_weighted_gr_gb_mesh(p_awb_core_obj, stats, input);
    awb_detect_light_source(p_awb_core_obj);
    awb_calculate_warming_effect(p_awb_core_obj, p_cali_data);

    /* 计算结果赋值给输出参数 */
    p_acamera_output->rg_coef = p_awb_core_obj->rg_coef;
    p_acamera_output->bg_coef = p_awb_core_obj->bg_coef;
    p_acamera_output->temperature_detected = p_awb_core_obj->temperature_detected;
    p_acamera_output->p_high = p_awb_core_obj->p_high;
    p_acamera_output->light_source_candidate = p_awb_core_obj->light_source_candidate;
    memcpy(p_acamera_output->awb_warming, p_awb_core_obj->awb_warming,
           sizeof(p_acamera_output->awb_warming));
    p_acamera_output->awb_converged = p_awb_core_obj->awb_converged;
    return 0;
}

int32_t awb_deinit_func(void *awb_ctx)
{
    pr_info("done");
    return 0;
}
```

### 算法的输入输出数据契约

这张表是开发自定义 3A 算法时最重要的一张，它规定了每个模块能拿到什么、必须给出什么：

| 模块 | ISP Fw → 算法库 | 算法库 → ISP Fw |
| --- | --- | --- |
| AE | `stats_data[ISP_FULL_HISTOGRAM_SIZE]`、`histogram_sum`、`hist4[33*33]` | `ae_exposure`、`ae_exposure_ratio`、`frame_id` |
| AWB | `stats_data[MAX_AWB_ZONES]`、`curr_AWB_ZONES` | `awb_red_gain`、`awb_green_even_gain`、`awb_green_odd_gain`、`awb_blue_gain`、`temperature_detected`、`p_high`、`light_source_candidate`、`awb_warming[3]`、`mix_light_contrast`、`frame_id` |
| AF | `stats_data[AF_ZONES_COUNT_MAX][2]`、`zones_horiz`、`zones_vert`、`frame_num`、`skip_cur_frame`、`zoom_step_info` | `frame_to_skip`、`af_position`、`af_last_sharp` |
| Gamma | `stats_data[ISP_FULL_HISTOGRAM_SIZE]`、`fullhist_sum` | `gamma_gain`、`gamma_offset`、`frame_id` |
| Iridix | N/A（复用 AE 的统计数据） | `strength_target`、`iridix_dark_enh`、`iridix_global_DG`、`iridix_contrast`、`frame_id` |

> 来源：官方文档 Advanced_development__multimedia_development__isp_system（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/multimedia_development/isp_system）

### ISP 的主要处理模块

理解每个模块干什么，才能判断调参时该动哪一块：

| 模块 | 作用 |
| --- | --- |
| AE | 分析直方图，计算相对于校准中 AE target 的新 EV 值。低动态场景基于 `AE_LDR_Target`（18% 灰度目标）；高动态场景动态修改 target 保证亮区不过曝 |
| AWB | 色彩稳定。传感器对中性色调的响应随光照变化，AWB 把「人眼看来白色」的物体在图上还原为白色 |
| Demosaic | 从 CFA（拜耳阵列）欠采样颜色样本重建全彩图像。2x2 像素组 RGGB 排列，一半绿、四分之一红、四分之一蓝 |
| Sharpen | 后端锐化，与 Demosaic 的锐化协同。暗区用 `luma thresh low` + `luma slope low`，亮区用 `luma thresh high` + `luma slope high` |
| Gamma | 色调曲线映射 |
| Iridix | 本地色调映射引擎，确保阴影被显示并正确曝光 |
| CNR | 色度降噪 |
| CCM | 颜色校正矩阵 |
| Sinter | 去噪 |
| Temper | 时域降噪 |
| Mesh Shading | 网格阴影校正（镜头暗角） |
| Radial Shading | 径向阴影校正 |
| CSC | 颜色空间转换 |

**关键概念**（调参前必须分清）：

- **曝光时间**：图像传感器内部积累电荷的时间，从开始曝光到电量被读出，决定 sensor 受光时间长短，可以以行长为单位；
- **曝光增益**：对 sensor 输出电荷的总放大系数，分数字增益与模拟增益。**模拟增益引入的噪声稍小，所以一般优先用模拟增益**。

这条「优先模拟增益」是暗光调参的第一原则。同样要提升 2 倍亮度，先加模拟增益、加满了再加数字增益，画质差异会非常明显。

### ISP 调试信息接口

怀疑链路有问题时，这些节点能直接看到硬件状态：

```bash
# SIF 调试信息
cat /sys/devices/platform/soc/a4001000.sif/cfg_info

# ISP 调试信息
cat /sys/devices/platform/soc/b3000000.isp/isp_status

# 当前哪些 pipe 使能
cat /sys/devices/platform/soc/a4040000.ipu/info/enabled_pipeline
```

驱动与多媒体系统的交互结构：camera 相关的控制全部在用户态完成，而 mipi/ISP 的控制在驱动中完成，通过把用户态配置传给驱动、由驱动设置硬件。相关设备节点：

| 节点 | 作用 |
| --- | --- |
| `mipi_host0~4` | mipi host 配置节点，完成 mipi_host 初始化 |
| `mipi_dphy` | dphy 相关节点 |
| `mipi_dev0` | 在配置中使能，配置 mipi_dev 输出 |
| `sif_capture` | 设置 sif 属性、初始化 sif，可 dump sif 输出的图像 |
| `sif_ddrin` | 设置 ddrin 节点属性/尺寸/格式，仅 sif-offline-isp 场景使用 |
| `ac_calib` | calibration 效果库设置 |
| `ac_isp` | isp 效果调节接口 |
| `ac_isp4uf0~7` | isp 驱动算法库发 command |
| `ac_sbuf0~7` | 算法库与 isp 驱动同步算法数据 |
| `video0~7` | isp v4l2 设备节点，设置尺寸/格式/大小，内存映射 |

配置代码里的两个关键字：`ispAlgoState` 标签表示使用 3A 算法（会加载 `lib_algo.so`）；`calib` 是不同 sensor 配置出的效果库，用于调整 sensor 效果。

> 来源：官方文档 Advanced_development__multimedia_development__debug_info（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/multimedia_development/debug_info）

### sensor 适配：为什么你的摄像头点不亮

社区帖 34950 是一个信息量很高的失败案例，值得完整分析。用户配置树莓派 5 CSI 摄像头 OV5647，系统 `rdk-x5-ubuntu22-preinstalled-desktop-3.4.1-arm64`：

**现象**：摄像头红灯亮后熄灭，`/dev/video*` 不存在，`mipi_cam` 启动报 `cap capture init failure`。

**已排除的**：

- I2C 检测正常：`i2cdetect -y -r 4` 在 Bus 4 地址 `0x36` 能看到传感器，说明硬件连接和供电正常；
- 内核驱动存在：`/lib/modules/6.1.83/kernel/drivers/media/i2c/ov5647.ko` 存在，`sudo modprobe ov5647` 可加载，但**不产生 `/dev/video*`**；
- 设备树 overlay 存在：`/boot/overlays/dtoverlay_cam0_ov5647.dtbo` 和 `.dts` 源文件都在，`config.txt` 里写过 overlay 名称（试过 `overlays/dtoverlay_cam0_ov5647` 与 `dtoverlay_cam0_ov5647` 两种格式），重启后无效。

**真正的根因**在于另一条线索：

> `/opt/tros/humble/lib/mipi_cam/config/` 仅包含 F37、GC4663、SC132GS、SC230ai、Senyun 的校准文件，**无 OV5647 的校准 YAML**。

这就是 X5 摄像头适配的完整依赖链：**sensor 驱动模块 + 设备树 overlay + ISP 校准文件（效果库）三者缺一不可**。

- 驱动模块在，只是内核认了这个 I2C 设备；
- overlay 在，只是设备树有了节点；
- 但 ISP 没有对应的校准 YAML，ISP Firmware 无法完成初始化，video 节点就不会创建。

这个链条解释了为什么「`modprobe` 成功但没有 `/dev/video*`」看起来矛盾——加载驱动只是第一环，ISP 初始化失败会让整个 pipeline 起不来。

推论：**接官方支持列表之外的 sensor，只装驱动和 overlay 是不够的**。要么拿到该 sensor 的校准文件，要么自己做 ISP 校准。这也是社区帖 35791 里自研 TOF sensor 用户得到的结论方向——自研 sensor 在 SDK 里没有包含，需要走官方定制支持。

> 来源：社区帖 34950（https://forum.d-robotics.cc/t/topic/34950）、社区帖 35791（https://forum.d-robotics.cc/t/topic/35791）

### 摄像头相关的几个现场排查点

| 现象 | 优先检查 | 说明 |
| --- | --- | --- |
| `/dev/video*` 不存在 | `lsmod` + 校准文件目录 | 驱动、overlay、校准三选一缺失 |
| `i2cdetect` 能扫到但取不到图 | sensor 校准 YAML 是否存在 | 见上节 |
| `cap capture init failure` | 排线接触 | 社区帖 33617 里用户最终确认是摄像头端排线接触不良，重新接好即恢复 |
| 桌面版看不到渲染效果 | `sudo systemctl stop lightdm` | Desktop 版本必须先关桌面服务才能独占显示 |
| 检测结果只在板端屏显示 | 需接 HDMI 屏 | 不会在 SSH 远程电脑上显示；想远端看用 TROS 网页端可视化 |

关于第 4 条要理解清楚：Desktop 版跑 MIPI 示例时必须 `sudo systemctl stop lightdm`，之后本地桌面消失是**正常现象**，不是系统坏了。社区帖 33617 里用户就误以为「连桌面都没有了」。想恢复桌面重启即可。

> 来源：社区帖 33617（https://forum.d-robotics.cc/t/topic/33617）、官方文档 Basic_Application__vision__RDK_X5__mipi_camera（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/vision/RDK_X5/mipi_camera）

### 多媒体示例的运行前提

以下示例涉及 HDMI 显示，**必须先关闭桌面**：

```bash
sudo systemctl stop lightdm
```

```bash
/app/cdev_demo/vio2display
/app/cdev_demo/vio_capture
/app/cdev_demo/vio2encoder
/app/cdev_demo/bpu ./sample -f /app/model/basic/yolov5s_672x672_nv12.bin -m 0
/app/pydev_demo/03_mipi_camera_sample
```

`hbn` 模式和 `V4L2 sif-isp-vse` 模式使用**同一套示例程序**：`hobot-spdev` 会根据当前驱动自动选择工作模式，两者打印信息略有不同。

> 来源：官方文档 Advanced_development__hardware_development__rdk_x5__V4l2

## 常见误区

1. **把 CAN 卡死当成接线问题反复换线**。社区帖 34260 已经明确定位到出厂 `hobot-boot` 包对 `m_can` 中断处理有缺陷，修复包是 `hobot-boot_3.1.0-20260518154347_arm64.deb`。特征是 500K 波特率、5ms 周期发送、持续十几分钟后收发停止。判断方法：把发送间隔放慢到 10~20ms，如果不卡了就说明是这个问题，直接装补丁包。

2. **以为 X5 自己就能吃 PoE**。X5 既不是 PSE 也不是完整 PD，它是「PD 的前端 + 后端负载」。必须外接第三方 PoE Hat，路径是 RJ45 旁 4PIN 出 AC → Hat 转 DC 5V（MAX 5.2V）→ 40PIN 的 5V 针脚。而且必须选 IEEE 802.3at（30W），因为 X5 在 40PIN 满载时要求适配器至少 25W 带载，802.3af 的 15W 上限定不住。

3. **在 V4L2 模式下取错 video 节点**。想拿 ISP 输出却打开了 `/dev/video1`（那是 CSI1 的 SIF，输出 RAW）。ISP 节点是 `/dev/video4~7`，VSE 节点是 `/dev/video8` 起。节点编号不连续，必须查表或用 `media-ctl -d /dev/media0 --print-dot` 看拓扑。

4. **以为 `modprobe` 成功、overlay 存在，摄像头就该能出图**。X5 的 camera 链路是「驱动模块 + 设备树 overlay + ISP 校准 YAML」三者缺一不可。社区帖 34950 里 OV5647 三项中缺第三项，结果就是不产生 `/dev/video*`、`mipi_cam` 报 `cap capture init failure`。接非官方支持列表的 sensor 前，先确认 `mipi_cam/config/` 下有没有对应校准文件。

5. **同时要 CAN 和 spidev**。两者都挂在 spi5 上，`dtoverlay=dtoverlay_spi5_spidev` 一开 `can0` 就没了，反之亦然。这是硬件约束，不存在两者共存的办法。

6. **暗光调参一上来就加数字增益**。模拟增益引入的噪声更小，应该先加模拟增益、加到上限再动数字增益。顺序反了会得到一张噪声明显更多的图，而且这种画质损失在后期无法挽回。

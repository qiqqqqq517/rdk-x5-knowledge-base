---
id: 02-基础开发-03-显示HDMI与MIPI-DSI
volume: 2
volume_title: 基础开发
title: 显示：HDMI 与 MIPI-DSI
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [显示, HDMI, MIPI DSI, 触摸屏, overlay]
summary: HDMI 分辨率与时序、MIPI DSI 屏适配清单、触摸坐标问题、DSI 与 HDMI 双 ignore 文件互斥机制。
source_policy: "official-first, community-verified"
---
# 2.3 显示：HDMI 与 MIPI-DSI

## 本章解决什么

RDK X5 有 HDMI 与 MIPI DSI 两条显示通路，**两者互斥，不能同时使用**，系统默认走 HDMI。这带来三个高频问题：想在 DSI 屏上跑桌面要怎么切、切过去之后 HDMI 为什么再也不亮、以及"屏幕接了但没画面"。本章给出两条通路的硬件与软件配置、10 款官方已适配 DSI 屏的型号与 `dtoverlay` 参数对照、触摸与背光的配置方式，并给出一条贯穿全章的关键规则——**任何"直出 HDMI"的多媒体示例都要求先关掉桌面服务**，这条不了解就会把"黑屏"误判成硬件故障。

---

## 2.3.1 通路约束：HDMI 与 DSI 互斥

### 2.3.1.1 官方明确的两条限制

- RDK X5 支持 HDMI 和 MIPI DSI 两种显示输出方式，**不能同时使用**，系统默认采用 HDMI 输出；
- HDMI 接口支持的最大分辨率为 **1080P60**。

DSI 接口是 22PIN 排针，需要专用排线（官方用 DSI-Cable-12cm）。这条"互斥"不是软件限制，是硬件设计——社区的 DSI 适配记录里也独立确认了同一点。

### 2.3.1.2 互斥的实现机制

互斥靠一对 `xorg.conf.d` 配置文件互斥实现，文件名里带 `ignore`：

| 文件 | 状态含义 |
| --- | --- |
| `xorg_hdmi_ignore.conf` | 存在（无 `.disable`）→ **忽略 HDMI** |
| `xorg_dsi_ignore.conf` | 存在（无 `.disable`）→ **忽略 DSI** |

所以"切到 HDMI"= 让 dsi_ignore 生效 + 让 hdmi_ignore 失效；反之亦然。官方给的两组命令是镜像对称的。

**切到 HDMI**：

```bash
# 需要 sudo（改 /etc 下的文件）
sudo mv /etc/X11/xorg.conf.d/xorg_hdmi_ignore.conf \
        /etc/X11/xorg.conf.d/xorg_hdmi_ignore.conf.disable
sudo mv /etc/X11/xorg.conf.d/xorg_dsi_ignore.conf.disable \
        /etc/X11/xorg.conf.d/xorg_dsi_ignore.conf
```

**切到 DSI**：

```bash
sudo mv /etc/X11/xorg.conf.d/xorg_dsi_ignore.conf \
        /etc/X11/xorg.conf.d/xorg_dsi_ignore.conf.disable
sudo mv /etc/X11/xorg.conf.d/xorg_hdmi_ignore.conf.disable \
        /etc/X11/xorg.conf.d/xorg_hdmi_ignore.conf
```

执行后**必须重启**才生效。

> 来源：官方文档 Quick_start/display_use/display_rdkx5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/display_use/display_rdkx5）

---

## 2.3.2 `srpi-config` 里的显示选项

官方 `srpi-config` 的 `Display Options` 菜单下有三个与显示直接相关的项：

| 菜单项 | 作用 | 生效方式 |
| --- | --- | --- |
| `FB Console Resolution` | 设置 **Server 系统与 console 模式**下的 HDMI 分辨率 | 重启 |
| `Display Chose DSI or HDMI` | DSI 与 HDMI 显示切换 | 重启 |
| `D3 MIPI LCD Choice` | 选择具体 DSI 屏型号 | 重启 |

三个要点：

1. `Display Chose DSI or HDMI`（官方原文就是这个拼写，`Chose`）**仅 RDK X5 支持**；
2. `FB Console Resolution` 只作用于 Server 系统 / console 模式——Desktop 版的分辨率不走这里，要走 `1-resolution.conf`；
3. `D3 MIPI LCD Choice` 是**较新版本才有的**。老版本 `srpi-config` 没有这一项，官方给的处理方式是先升级工具。

```bash
# 需要 sudo，全屏终端
sudo srpi-config
```

### 2.3.2.1 老版本没有 `D3 MIPI LCD Choice` 怎么办

两条路：

**路一：升级 `srpi-config`**。`srpi-config` 主菜单里有 `Update` 项，会把工具更新到最新版本。

**路二：手工配置**（等效做法，官方给了完整步骤）：

```bash
# 1) 切到 DSI（命令见 1.2 节"切到 DSI"）
# 2) 在 /boot/config.txt 末尾追加 dtoverlay 行，以 2.8 寸屏为例
dtoverlay=dsi-waveshare-panel-overlay-2_8_inch
```

改完保存、退出、重启。

> 来源：官方文档 System_configuration/srpi-config（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/srpi-config）、Quick_start/display_use/display_rdkx5

---

## 2.3.3 HDMI

### 2.3.3.1 默认分辨率

Desktop 版的默认分辨率由 `/etc/X11/xorg.conf.d/1-resolution.conf` 控制，官方给出的模板是 1280x720：

```ini
Section "Screen"
    Identifier "Screen0"
    Device "Device0"
    Monitor "Monitor0"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1280x720"
    EndSubSection
EndSection
```

把 `Modes` 改成想要的分辨率即可。**注意**：官方文档里这个文件在部分系统上是以 `.disable` 后缀存在的（如 `1-resolution.conf.disable`），不生效。要它生效必须去掉 `.disable`。

### 2.3.3.2 HDMI 时序优化（版本差异）

3.5.0 版本发布说明里明确列了一条：

> 优化 HDMI Timing 参数，大幅提升多分辨率兼容性 与显示稳定性。

3.4.1 版本也有类似条目：

> HDMI 输出能力增强：改进多分辨率支持与兼容性，提升显示稳定性。

这意味着：**如果你在 3.3.x 及更早版本上遇到 HDMI 不识别某款显示器，很可能在 3.4.1/3.5.0 上就好了**。判断"是硬件坏了还是系统旧了"的手段就是先升级系统再看。

### 2.3.3.3 非标准分辨率的显示器：一个完整案例

社区有一个典型场景：ADKEFOX 1280x800@60 屏接 X5 无信号，而在 PC 上正常。

**现象链**：

- HDMI 接该屏无信号；
- 板端执行 `xrandr` 输出 `Can't open display`（**即使换成能出图的显示器也一样**——说明这句报错与显示器无关，是 X Server 没跑起来或没有有效输出）；
- `/etc/X11/xorg.conf.d/1-resolution.conf.disable` 是 disable 状态；
- 把 `.disable` 去掉改成 `.conf` → **系统反复重启**。

**根因**

1. `xrandr` 的 `Can't open display` 是 X Server 侧问题，不是显示器问题。在 Desktop 版能出图的情况下仍报这句，通常是在 SSH 会话里执行——SSH 没有 `DISPLAY` 环境变量。
2. 直接启用 `1-resolution.conf` 导致重启循环，是因为里面 `Modes` 写的是该配置文件模板里的默认值（如 `1280x720`），而实际请求的模式在 X Server 侧初始化失败，`lightdm` 反复重启。
3. 1280x800 不是标准 HDMI 模式，X Server 若拿不到正确 EDID 就不会自动生成这个模式。

**处置**

正确做法是**自己算 Modeline**，不要指望自动识别：

```bash
# 在 PC 上（或装了 x11-xserver-utils 的板子上）算 CVT 时序
cvt 1280 800 60
```

```
# 1280x800 59.81 Hz (CVT) hsync: 49.31 kHz; pclk: 83.50 MHz
Modeline "1280x800_60.00"  83.50  1280 1352 1480 1680  800 803 809 831 -hsync +vsync
```

然后把完整的 `Device` / `Monitor` / `Screen` 三段写进 `/etc/X11/xorg.conf.d/1-resolution.conf`：

```ini
Section "Device"
    Identifier "Card0"
    Driver     "modesetting"
EndSection

Section "Monitor"
    Identifier   "Monitor0"
    Modeline     "1280x800_60.00" 83.50 1280 1352 1480 1680 800 803 809 831 -hsync +vsync
    Option       "PreferredMode" "1280x800_60.00"
EndSection

Section "Screen"
    Identifier "Screen0"
    Device     "Card0"
    Monitor    "Monitor0"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1280x800_60.00"
    EndSubSection
EndSection
```

**关键提醒**：`Modeline` 的数值必须来自 `cvt` 的实际输出，不能手抄别人的。这条案例里社区助手给出的示例值（`83.75 1280 1328 1472 1688 800 803 809 825`）与 `cvt 1280 800 60` 的真实输出（pclk 83.50、后沿 1352/1480/1680、垂直 803/809/831）不一致——**用了错的 Modeline 会继续黑屏甚至重启循环**。以 `cvt` 输出为准。

**预防**

- 优先选 1920x1080 的显示器。官方回复明确："为保持兼容性，一般需要 1920 1080 的显示器"；
- 升级到 3.4.1 及以上，HDMI 时序有针对性优化；
- 改 `xorg.conf.d` 前先备份，出问题能立刻用串口登进去还原：

```bash
sudo cp /etc/X11/xorg.conf.d/1-resolution.conf /etc/X11/xorg.conf.d/1-resolution.conf.bak
```

> 来源：社区帖 34076（https://forum.d-robotics.cc/t/topic/34076）、官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

### 2.3.3.4 验证 HDMI 是否真的连上

```bash
# 1) DRM 侧看连接器状态
modetest -M vs-drm -c

# 2) 内核日志
sudo dmesg | grep -iE "hdmi|drm" | tail -30

# 3) X Server 侧（必须在图形环境或显式指定 DISPLAY）
DISPLAY=:0 xrandr

# 4) X Server 日志里的错误
sudo grep -i error /var/log/Xorg.0.log
```

`modetest -M vs-drm -c` 会打印每个连接器的 `connected` / `disconnected` 状态与 EDID。社区里处理 HDMI 问题首先要求的就是这条命令的输出。

**读 EDID 的常见失败**：`get-edid` 报 `No EDID on bus 0`、或脚本报 `Error: Could not open file '/dev/i2c-1'`，本质是 I2C 总线号不对——X5 上 HDMI 的 DDC 总线不是 `i2c-1`。这时改用 `modetest -M vs-drm -c`（它直接问 DRM，不走 I2C 用户空间）。

> 来源：社区帖 29080（https://forum.d-robotics.cc/t/topic/29080）

---

## 2.3.4 MIPI DSI 屏

### 2.3.4.1 已适配的型号与 `dtoverlay` 参数

官方已适配 10 款微雪 DSI 屏。`srpi-config` 菜单路径统一是 `2 Display Options` → `D3 MIPI LCD Choice`，选完重启。

| 屏型号 | 分辨率 | 屏幕类型 | `dtoverlay` 参数 | 额外供电 |
| --- | --- | --- | --- | --- |
| 2.8inch DSI LCD | 480×640 | IPS 全贴合电容触控 | `dsi-waveshare-panel-overlay-2_8_inch` | DSI 排线供电 |
| 3.4inch DSI LCD (C) | 800×800 | 圆形电容触控，IPS，十点触控 | `dsi-waveshare-panel-overlay-3_4_inch` | 4PIN 顶针 5V |
| 4.3inch DSI LCD | 800×480 | 电容触控，IPS 广视角 | `dsi-waveshare-panel-overlay-4_3_inch` | DSI 排线供电 |
| 7inch DSI LCD (C) | 1024×600 | 电容触控，IPS 广视角 | `dsi-waveshare-panel-overlay-7_0_inchC` | 4PIN 顶针 5V + I2C |
| 7.9inch DSI LCD | 400×1280 | 电容触控，IPS 广视角，超长屏 | `dsi-waveshare-panel-overlay-7_9_inch` | 5V/3A Type-C |
| 8inch DSI LCD (C) | 1280×800 | 电容触控，IPS 广视角 | `dsi-waveshare-panel-overlay-8_0_inch` | 5V/3A Type-C |
| 10.1inch DSI LCD (C) | 1280×800 | 电容触控，IPS 广视角 | `dsi-waveshare-panel-overlay-10_1_inch` | 5V/3A Type-C |
| 11.9inch DSI LCD | 320×1480 | 电容触控，IPS 广视角，超长屏 | （3.4.1 新增适配） | 5V/3A Type-C |

**注意官方文档两个地方不一致**：

- `display_rdkx5.md` 给的 `dtoverlay` 表只列了 7 项（缺 11.9 寸），且 8 寸写的是 `dsi-waveshare-panel-overlay-8_0_inch`；
- `accessory.md` 的屏幕清单列了 8 项（含 11.9 寸），但描述里的名字是"8 英寸 MIPI LCD"而不是"8inch DSI LCD (C)"。

**判断依据**：`dtoverlay` 的实际值以 `/boot/overlays/` 目录下的文件名和 `srpi-config` 菜单显示为准。11.9 寸是 3.4.1 才新增的适配，老系统上既没有菜单项也没有对应的 `.dtbo`。

### 2.3.4.2 各屏的供电与接线差异

这是最容易漏的一步：**不同尺寸的 DSI 屏供电方式不同**，不是插上排线就完事。

| 类型 | 屏型号 | 接线要点 |
| --- | --- | --- |
| DSI 排线自供电 | 2.8inch、4.3inch | 只用 DSI-Cable-12cm 连 22PIN，无需额外供电 |
| 需 4PIN 顶针供 5V | 3.4inch、7inch | 顶针连 5V 与 GND；40PIN 上**第 4 脚为 5V、第 6 脚为 GND** |
| 需 4PIN 顶针供 5V + I2C | 7inch | 除供电外还要顶针连 I2C，接到 40PIN 的 **I2C5**：**第 3 脚 SDA5、第 5 脚 SCL5** |
| 需独立 Type-C 供电 | 7.9inch、8inch、10.1inch、11.9inch | 用 5V/3A 的 Type-C 电源单独给屏供电 |

7inch 屏那个组合是最容易出错的：既要 4PIN 顶针供 5V（4/6 脚），又要 4PIN 顶针接 I2C（3/5 脚）。**触摸功能依赖 I2C**，只接 DSI 排线和 5V 的话屏幕会亮但触摸完全无响应。

排线安装还有一个细节：**用接口的卡扣把没有触点的背面压紧**。这句话在官方每个屏的接线说明里都出现，说明压反/压不紧是常见操作失误。

### 2.3.4.3 非官方屏的适配（以 DFRobot 5 寸为例）

官方列表里没有 5 寸。社区有完整的从零适配记录，流程可复用：

**第一步：确认现象与层次**

接上后是**白屏，背光也不亮**。这时不要急着换屏，先分层确认：

```bash
# 驱动层面：DSI 控制器节点在不在
ls /proc/device-tree/soc/disp_apb/mipi_dsi0@3e060000/

# 内核日志：驱动加载了但初始化失败？
sudo dmesg | grep -i dsi
```

该案例的结论是"驱动加载了，但初始化失败"，指向面板驱动配置。

**第二步：找可复用的面板驱动**

```bash
find /lib/modules -name "*.ko" | xargs grep -l "panel"
```

DFRobot DFR0550-V1 用的驱动 IC 是 ILI9881C，但其初始化时序与内核里已有的 `wh-cm480` 兼容。实测 `wh-cm480` 能正确点亮该屏——**这说明适配一块屏不一定需要写新驱动，先找时序兼容的现成驱动**。

**第三步：写 overlay**

一个 DSI 屏适配要处理四个层面（该案例总结）：MIPI DSI 控制器、面板驱动绑定、背光控制、显示比例修正。overlay 里的 `fragment@0` 负责把 DSI 控制器绑定到 `wh-cm480` 面板。

**第四步：显示比例修正**

800×480 的屏在桌面里可能被当成别的比例，需要横向拉伸修正（案例中用 1.067 倍）。

> 来源：社区帖 34342（https://forum.d-robotics.cc/t/topic/34342）

### 2.3.4.4 触摸配置

DSI 屏的触摸有两种接入方式，配置位置完全不同：

| 触摸方式 | 接入 | 配置位置 |
| --- | --- | --- |
| I2C 触摸（如 GT911） | 40PIN I2C5（3/5 脚）或屏自带排线 | 设备树 overlay + X11 `InputClass` |
| USB 触摸 | USB 口 | 通常免驱，直接是 `/dev/input/eventX` |

**X11 侧的坐标修正**用 `CalibrationMatrix`，写在 `/etc/X11/xorg.conf.d/90-touchscreen.conf`：

```ini
Section "InputClass"
    Identifier "Goodix TouchScreen Calibration"
    MatchProduct "Goodix Capacitive TouchScreen"
    MatchDriver "libinput"
    Option "CalibrationMatrix" "0 -0.6667 1 1 0 0 0 0 1"
EndSection
```

矩阵含义是把触摸坐标做仿射变换：

```
屏幕X = 0 * touchX + (-0.6667) * touchY + 1
屏幕Y = 1 * touchX + 0        * touchY + 0
```

即"竖屏触摸坐标旋转映射到横屏显示"。方向不对时社区给过几组可用组合：

| 效果 | 矩阵 |
| --- | --- |
| 180° 翻转 | `0 1 0 -1 0 1 0 0 1` |
| 旋转 + 双轴翻转 | `0 -1 1 -1 0 1 0 0 1` |
| 翻转 Y 轴 | `0 1 0 1 0 0 0 0 1` |

**一条重要纪律**：坐标变换**只在 X11 层做**，不要在设备树里加 `touchscreen-inverted-x` 之类的属性。该案例的结论是——DTS 里写这些属性会让 libinput 的归一化出错，DTS 应保持屏幕的原始（竖屏）参数，所有旋转/镜像通过 `CalibrationMatrix` 完成。

**验证触摸是否被识别**：

```bash
# 列出所有输入设备
cat /proc/bus/input/devices

# 看 X Server 是否加载了触摸设备
grep -iE "Goodix|CalibrationMatrix|libinput" /var/log/Xorg.0.log

# 直接读事件，能看到坐标输出就说明驱动层通了
sudo evtest /dev/input/eventX
```

桌面版还需要虚拟键盘（触摸屏没有物理键盘时无法输入）：

```bash
# 需要 sudo
sudo apt update
sudo apt install onboard -y
onboard
```

> 来源：社区帖 35211（https://forum.d-robotics.cc/t/topic/35211）、35479（https://forum.d-robotics.cc/t/topic/35479）

### 2.3.4.5 背光

背光有两种归属：

| 方式 | 机制 | 检查 |
| --- | --- | --- |
| DRM 管理（推荐） | 面板驱动的 `gpio-backlight`，由 DRM 自动控制 | `ls /sys/class/backlight/` 应有条目 |
| 独立 systemd 服务 | 手动 export GPIO，开机拉高 | 见下方脚本骨架 |

如果 `gpio-backlight` 模块没加载，面板 probe 会失败并报 `deferred probe pending`——因为面板在等背光设备就绪。所以看到这个报错，先查 `gpio_backlight` 模块是否已加载。

独立背光服务的骨架（把 GPIO 号换成本板实际值）：

```bash
sudo tee /etc/systemd/system/backlight.service > /dev/null <<'EOF'
[Unit]
Description=Panel Backlight
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'echo 421 > /sys/class/gpio/export 2>/dev/null; \
  echo out > /sys/class/gpio/gpio421/direction; \
  echo 1 > /sys/class/gpio/gpio421/value'
ExecStop=/bin/sh -c 'echo 0 > /sys/class/gpio/gpio421/value'

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now backlight.service
```

> 来源：社区帖 35211（https://forum.d-robotics.cc/t/topic/35211）

### 2.3.4.6 触摸屏供电不足的表现

社区对 HDMI 触控屏有一条经验值得记下来：**屏幕在不断"有背光/无背光"之间切换闪烁，且不显示"无信号"**，这个现象优先怀疑供电不足，而不是分辨率不匹配。判据是——拔掉 HDMI 线后屏幕应该显示"无信号"，如果仍然闪烁，说明屏的 MCU 在掉电重启，与信号无关。

处置：给屏独立供电（多数带触控的大屏有独立 Type-C 或 micro-USB 供电口）。

> 来源：社区帖 29080（https://forum.d-robotics.cc/t/topic/29080）

---

## 2.3.5 多媒体示例的显示前提：先关桌面

### 2.3.5.1 规则本身

**在 Desktop 版系统上，所有"直出 HDMI"的示例都必须先停掉 `lightdm`。**

```bash
# 需要 sudo
sudo systemctl stop lightdm
```

原因：这些示例走 DRM/KMS 直接渲染（打开 `/dev/dri/card0`），与 X 桌面争抢同一套显示资源。桌面占着，示例能跑、能打印日志、甚至能算完推理，但屏幕上什么都不显示。

### 2.3.5.2 哪些示例需要这一步

官方在不同章节反复写了这条，说明是共性要求：

| 示例 | 官方原文要求 |
| --- | --- |
| `vio2display` | "我们首先要关闭 light 服务，然后再执行 vio2display" |
| `bpu` | "通过 `systemctl stop lightdm` 命令关闭图形界面服务" |
| `decode2display` | "我们使用 `systemctl stop lightdm` 来关闭显示服务" |
| `rtsp2display` | "通过 `systemctl stop lightdm` 命令来关闭显示服务，达到最佳显示效果" |
| `01_mipi_camera_yolov5s.py` | "Desktop 版特殊处理：需要先执行 `sudo systemctl stop lightdm`" |
| `05_mipi_camera_streamer.py` | "注意 Desktop 版本需要先执行 `sudo systemctl stop lightdm`" |

官方 V4L2 文档里有一句总括："涉及到 hdmi 显示，需要先关闭桌面。"

要恢复桌面：

```bash
sudo systemctl start lightdm
```

### 2.3.5.3 不关桌面会怎样：完整案例

**现象**：Desktop 版系统运行 USB 摄像头示例 `usb_camera_fcos.py`，日志显示 USB 摄像头打开成功、能识别到物体，但实时显示窗口一直黑屏。

已排查过：`apt update && apt upgrade` + 重启无效；`sudo python3` 运行无效；运行前后插拔 HDMI 无效；`usb_camera_snap.py`（存图不显示）能正常保存图片——**证明摄像头与采集链路完全正常**。

**根因**：`lightdm` 占着 DRM 显示通道。

**处置**：

```bash
sudo systemctl stop lightdm
cd /app/pydev_demo/07_usb_camera_sample
sudo python usb_camera_yolov5x.py
```

**预防**：建立条件反射——**"存图能存、上屏黑屏"= 显示资源被占，不是采集失败**。这个判据可以在 10 秒内定位问题，避免去查摄像头驱动。

> 来源：社区帖 28147（https://forum.d-robotics.cc/t/topic/28147）、官方文档 Basic_Application/cdev_demo_sample/vio2display、Advanced_development/hardware_development/rdk_x5/V4l2

---

## 2.3.6 双屏：哪些组合真的能同时用

"双屏"在 X5 上要看具体是哪两块屏，答案完全不同。

### 2.3.6.1 HDMI + MIPI DSI：不能

这是本章开头就写死的硬件约束。两条通路在 X5 上互斥，`srpi-config` 的 `Display Chose DSI or HDMI` 只能二选一，底层靠两个 `xorg_*_ignore.conf` 互斥实现。**不要在项目规划阶段假设可以"HDMI 接大屏做监控 + DSI 做本地操作面板"**。

### 2.3.6.2 HDMI + SPI LCD：可以

SPI 屏走的是完全不同的驱动栈（`panel-mipi-dbi` + `drm_mipi_dbi`），不占用 DSI 控制器，因此可以与 HDMI 并存。社区的 SPI LCD 适配记录给出了确认方法：

```bash
ls /dev/dri/
# 预期：card0（SPI LCD）、card1（HDMI）——两个 DRM card 同时存在
```

这时 X11 需要显式指定把桌面输出到哪个 card：

```ini
# /etc/X11/xorg.conf.d/99-spi-lcd.conf
Section "Device"
    Identifier "SPI LCD"
    Driver     "modesetting"
    Option     "kmsdev" "/dev/dri/card0"
EndSection
```

关键点两条：

1. **必须用 `modesetting` 驱动，不能用 `fbdev`**。用 fbdev 会出现 X11 渲染异常或 GLX 错误。
2. 要禁用冲突的默认配置，否则 HDMI 的分辨率配置会覆盖 SPI 屏的设置：

```bash
sudo mv /etc/X11/xorg.conf.d/1-resolution.conf \
        /etc/X11/xorg.conf.d/1-resolution.conf.disable
sudo mv /etc/X11/xorg.conf.d/2-dr-accel.conf \
        /etc/X11/xorg.conf.d/2-dr-accel.conf.disable
```

### 2.3.6.3 HDMI + USB 显示：取决于驱动

USB 转 HDMI 的显示适配器依赖 DisplayLink 一类内核驱动，官方镜像未预装。这不是"配置一下就能用"的场景，需要自行编译驱动，不属于本章范围。可行的替代是用 VNC 把桌面远程投到另一台设备上。

### 2.3.6.4 多屏场景的务实选择

| 需求 | 可行方案 | 说明 |
| --- | --- | --- |
| 本地操作面板 + 外接大屏 | HDMI 单屏 + VNC 远程 | 最省事，不涉及驱动 |
| 嵌入式设备无 HDMI | 只用 DSI | 必须先在 `srpi-config` 里切 |
| 需要触摸 + 大画面 | DSI 触摸屏（7/10.1/11.9 寸） | 触摸依赖 I2C，注意接线 |
| 需要双物理屏 | HDMI + SPI LCD（第二块） | 需自己写 SPI 屏 overlay |

### 2.3.6.5 SPI 屏的一个隐藏冲突

社区案例里踩到过一条：**SPI 屏的 CS0 可能被板载 IMU 占用**。X5 板载 BMI088 走 SPI，CS0 已被它有主。这时 SPI 屏必须改用 CS1：

```dts
/* 在 SPI 屏的 overlay 里 */
reg = <1>;              /* 用 CS1，不是 CS0 */
```

同时要显式禁用 CS1 上原有的 spidev 节点，否则两个驱动抢同一个片选。

判据：SPI 屏 probe 失败、`dmesg` 里出现片选相关错误、或 IMU 数据变成全 0，都要回头查 CS 分配。

> 来源：社区帖 35211（https://forum.d-robotics.cc/t/topic/35211）

---

## 2.3.7 显示异常排查总表

按现象对照，避免乱试：

| 现象 | 优先怀疑 | 判据命令 |
| --- | --- | --- |
| 完全无信号（显示器进省电） | HDMI 线 / 非标分辨率 / 系统版本旧 | `modetest -M vs-drm -c` 看 connector 是否 `connected` |
| 反复重启 | `1-resolution.conf` 里的 Modes 屏不支持 | 进串口，看 `/var/log/Xorg.0.log` |
| 背光一闪一闪、不显示"无信号" | **供电不足** | 换独立供电；拔 HDMI 后仍闪烁即坐实 |
| 屏幕亮但黑 | 显示资源被桌面占用 | `systemctl status lightdm` |
| DSI 白屏、背光不亮 | 面板驱动未适配 / overlay 未加载 | `ls /proc/device-tree/soc/disp_apb/`、`dmesg \| grep -i dsi` |
| DSI 亮但触摸无反应 | I2C 未接（7 寸屏需 3/5 脚） | `i2cdetect -y -r 5` 看触摸 IC 地址 |
| 触摸方向反了 | `CalibrationMatrix` 取值不对 | 换矩阵组合；不要在 DTS 里加 `touchscreen-inverted-*` |
| `xrandr` 报 `Can't open display` | SSH 会话没有 `DISPLAY` | `DISPLAY=:0 xrandr` |
| `deferred probe pending` | `gpio_backlight` 模块未加载 | `lsmod \| grep backlight` |
| 切到 DSI 后 HDMI 再也点不亮 | `xorg_hdmi_ignore.conf` 仍在生效 | 按 1.2 节做反向 mv |

### 2.3.7.1 `xrandr` 报 `Can't open display` 的正确读法

这条报错**与显示器无关**，是 X Server 侧的问题。两种情形：

1. 在 SSH 会话里执行，没有 `DISPLAY` 环境变量 → 用 `DISPLAY=:0 xrandr`；
2. X Server 没起来（`lightdm` 停了、或配置崩了）→ `systemctl status lightdm`，再看 `/var/log/Xorg.0.log`。

社区案例里出现"换能出图的显示器也报同一句"，正是第 1 种情形——不是屏幕不行，是命令执行环境不完整。

> 来源：社区帖 34076（https://forum.d-robotics.cc/t/topic/34076）

---

## 2.3.8 四段式排障：切到 DSI 后开机黑屏，HDMI 也不亮
**现象**

按官方步骤用 `srpi-config` 切到 MIPI DSI 屏，重启后 DSI 屏黑、HDMI 也不亮，等于两头都没画面。串口能进系统。

**根因**

三个可能，按概率排序：

1. **DSI 屏的 overlay 没加载成功**（型号选错、`.dtbo` 不存在、`/boot/config.txt` 末尾缺空行导致最后一行 `dtoverlay` 不生效）；
2. **DSI 屏供电没接**（3.4/7 寸需 4PIN 顶针 5V，7.9/8/10.1/11.9 寸需独立 Type-C）；
3. **`xorg` 的两个 ignore 文件状态不匹配**——切 DSI 时只做了第一步 mv、漏了第二步，结果两个 ignore 同时生效，两条通路都被忽略。

**处置**

```bash
# 1) 串口登录后先看 overlay 状态
cat /boot/config.txt | tail -20
#    末尾必须有空行，否则最后一个 dtoverlay 不生效
sudo tail -c 1 /boot/config.txt | xxd

# 2) 看 DSI 控制器与面板驱动
ls /proc/device-tree/soc/disp_apb/
sudo dmesg | grep -iE "dsi|panel|backlight"

# 3) 核对两个 ignore 文件的状态（应有且只有一个 .conf 生效）
ls -l /etc/X11/xorg.conf.d/ | grep -E "hdmi|dsi"

# 4) 实在起不来，先回 HDMI 保命
sudo mv /etc/X11/xorg.conf.d/xorg_hdmi_ignore.conf \
        /etc/X11/xorg.conf.d/xorg_hdmi_ignore.conf.disable
sudo mv /etc/X11/xorg.conf.d/xorg_dsi_ignore.conf.disable \
        /etc/X11/xorg.conf.d/xorg_dsi_ignore.conf
sudo reboot
```

**预防**

- 改 `/boot/config.txt` 后**确认文件末尾有空行**——社区案例里"最后一个 `dtoverlay` 不生效"就是这个原因；
- 切换前先用 `ls /boot/overlays/ | grep dsi` 确认目标 `.dtbo` 存在，不存在说明系统版本太旧；
- 切 DSI 前先确保有串口或 SSH 可用，否则切坏了只能重新烧卡。

> 来源：社区帖 35211（https://forum.d-robotics.cc/t/topic/35211）、官方文档 Quick_start/display_use/display_rdkx5

---

## 9. 常见误区

1. **"HDMI 和 DSI 都能接，双屏更好"**——不行。X5 的 HDMI 与 DSI 硬件互斥，系统默认走 HDMI，切换靠 mv 两个 ignore 文件。同时接两块屏不会双显。

2. **"直出 HDMI 的示例黑屏 = 摄像头/驱动坏了"**——先看是不是没关 `lightdm`。"存图能存、上屏黑屏"是显示资源被占的确定判据，与采集无关。

3. **"DSI 屏插上排线就能用"**——多数屏还需要额外供电。3.4/7 寸要 4PIN 顶针 5V（40PIN 第 4 脚 5V、第 6 脚 GND），7 寸还要额外接 I2C5（第 3 脚 SDA5、第 5 脚 SCL5）才有触摸，7.9/8/10.1/11.9 寸要独立 5V/3A Type-C。

4. **"`xrandr` 报 `Can't open display` 说明显示器不兼容"**——这句是 X Server 侧的，与显示器无关。SSH 里执行必然报这句，加 `DISPLAY=:0` 再试。

5. **"Modeline 可以抄一份现成的"**——不行。`cvt 1280 800 60` 的真实输出是 `83.50 1280 1352 1480 1680 800 803 809 831`，与网上流传的 `83.75 1280 1328 1472 1688 ...` 不同。抄错会继续黑屏甚至重启循环。

6. **"触摸方向不对，在设备树里加 `touchscreen-inverted-x` 修"**——不要在 DTS 里做坐标变换，会让 libinput 归一化出错。所有旋转/镜像统一走 X11 的 `CalibrationMatrix`。

7. **"背光闪烁是分辨率问题"**——背光在"有/无"之间切换、且不显示"无信号"，是供电不足的典型表现。拔掉 HDMI 线后仍闪烁即可确诊。

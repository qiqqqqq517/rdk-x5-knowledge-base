---
id: 02-基础开发-02-摄像头MIPI与USB
volume: 2
volume_title: 基础开发
title: 摄像头：MIPI 与 USB
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [摄像头, MIPI, USB, V4L2, sensor]
summary: MIPI CSI 双路与 sensor 选型清单、srpi-config 使能、V4L2 用法、USB UVC、摄像头不出图的 L1-L5 分层判据。
source_policy: "official-first, community-verified"
---
# 2.2 摄像头：MIPI 与 USB

## 本章解决什么

RDK X5 有两路 MIPI CSI 和四个 USB 3.0 Type-A 口，摄像头接入方式不同，软件栈也完全不同：MIPI 走 VIN → ISP → VSE 的硬件通路，需要在 `srpi-config` 里选模式、选 sensor、选 CAM 口；USB 走标准 UVC 内核驱动，插上就是 `/dev/videoN`。本章给出官方支持的 sensor 型号与分辨率清单、V4L2 与 HBN 两种采集模式的用法、USB 摄像头的确认步骤，以及"能识别 sensor 但出不了图"这一类故障的分层判据——这是社区里最耗时的一类问题，判错层次会让人反复换摄像头而问题依旧。

---

## 2.2.1 硬件通路与两个 CAM 口

### 2.2.1.1 通路结构

X5 的摄像头采集链路是一串硬件模块，官方术语如下：

| 模块 | 全称 | 作用 |
| --- | --- | --- |
| VIN | Video Input | 软件概念，含 MIPI 与 SIF，接收一路或多路 sensor 数据 |
| SIF | Sensor Interface | 衔接 MIPI 口，把收到的帧交给下游 ISP 或直接写 DDR |
| ISP | Image Signal Processor | 图像信号处理，输出 NV12 |
| VSE | Video Scaler | 裁剪、缩放、颜色空间转换，6 个通道 |
| GDC | Geometric Distortion Correction | 几何畸变校正（双目/RoI 用） |
| N2D | 2D 加速 | 2D 图形处理 |

VSE 的通道能力（决定你能同时拿几路不同分辨率的图）：

| 输出通道 | 类型 | 功能 | 最大分辨率 |
| --- | --- | --- | --- |
| 0 | offline | 4K Downscale | 4K |
| 1 | offline | 1080P Downscale | 1080P |
| 2 | offline | 1080P Downscale | 1080P |
| 3 | offline | 720P Downscale | 720P |
| 4 | offline | 720P Downscale | 720P |
| 5 | offline | 4K Upscale | 4K，最大放大 4 倍 |

整体最大处理能力 3840x2160@60fps，最小分辨率 64x64，支持任意 downscale factor（5 路缩小 + 1 路放大）。

> 来源：官方文档 Advanced_development/hardware_development/rdk_x5/V4l2（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/hardware_development/rdk_x5/V4l2）

### 2.2.1.2 CAM0 与 CAM1 的物理区分

RDK X5 板上有两路 22PIN MIPI 摄像头接口。官方给出的定位方法：

- **X5 RDK：cam0 靠近网口，cam1 远离网口**；
- **X5 MD（Module + 载板）：看载板丝印**，载板上 CAM1、CAM2 分别标注，均为 4lane。

这里有一个容易混淆的点：**软件里的 cam0/cam1 与载板丝印的 CAM1/CAM2 不是同一套编号**。载板丝印从 1 开始，软件日志从 0 开始。社区里有用户把"板端 CAM1 接相机 CAM1、板端 CAM2 接相机 CAM2"当作排查项，说明接反确实发生过。

官方还有一条硬性提醒：X5 上也有 MIPI 丝印信息，**插反对当前的单路连接测试可能没有影响，但会影响后续双目算法开发**——因为双目依赖左右目与 IMU 的固定空间关系。

> 来源：官方文档 Advanced_development/hardware_development/rdk_x5/V4l2、Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）、社区帖 35592（https://forum.d-robotics.cc/t/topic/35592）

### 2.2.1.3 禁止带电插拔

官方 FAQ 明确：**严禁在开发板通电的情况下插拔 MIPI 摄像头**。带电操作极易因瞬间电流冲击或引脚接触顺序错误，导致摄像头模组或板卡 MIPI 接口电路短路损坏。

这条不是"建议"，是硬约束。社区里那些"换了三块摄像头都不出图"的帖子，有相当比例最终归因于接口已经损伤。

> 来源：官方文档 FAQ/interface（https://developer.d-robotics.cc/rdk_x_doc/FAQ/interface）

---

## 2.2.2 支持的 sensor 与分辨率

### 2.2.2.1 单目摄像头

官方配件清单里已认证测试的型号：

| 供应商 | 型号 | 传感器 | 像素 | FOV（对角） | 支持分辨率 |
| --- | --- | --- | --- | --- | --- |
| 微雪 | OV5647 摄像头 | OV5647 | 500W | 160° | 1920x1080@30fps（默认）、640x480@60fps、1280x960@30fps、2592x1944@15fps（最大） |
| 第三方 | OV5647 摄像头 | OV5647 | 500W | 160° | 同上（效果库优化版） |
| 微雪 | IMX219（Jetson Nano 版） | IMX219 | 800W | 160° | 1920x1080@30fps（默认）、640x480@30fps、1632x1232@30fps、3264x2464@15fps（最大） |
| 微雪 | IMX219（Pi5 版） | IMX219 | 800W | 120° | 1920x1080@30fps（默认）、1632x1232@30fps、3264x2464@15fps（最大） |
| 微雪 | IMX477 摄像头 | IMX477 | 1230W | 160° | 1920x1080@50fps（默认）、1280x960@120fps、2016x1520@40fps、4000x3000@10fps（最大） |
| 亚博 | IMX219 摄像头 | IMX219 | 800W | 77° | 同微雪 IMX219 |
| 第三方 | IMX415 摄像头 | IMX415 | 800W | 123° | 官方标"待测试"，22PIN 无需转接板 |

### 2.2.2.2 双目摄像头

| 型号 | 传感器 | 像素 | FOV | 基线 | 分辨率 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| RDK Stereo Camera Module | SmartSens SC230AI | 200W | 对角 178° / 水平 150° / 垂直 80° | — | 1920x1080 | 1/2.8" CMOS，滚动快门 |
| RDK Stereo Camera GS130W | SC132GS | 130W | 对角 157.2° | 80mm | 1280×1080@120fps | 全局快门 |
| RDK Stereo Camera GS130WI | SC132GS | 130W | 对角 157.2° | 70mm | 1280×1080@120fps | 全局快门，板载 ICM-42688-P 六轴 IMU，HDR、40dB 信噪比、850/940nm 近红外增强 |

GS130WI 在软件里表现为**两颗 SC132GS**，分别挂在 csi0 与 csi2 上，i2c 地址 0x30 / 0x32，配置文件 `linear_1088x1280_raw10_30fps_1lane.c`。

### 2.2.2.3 驱动内部还支持、但未列入配件清单的 sensor

这一点很有用：跑任何 MIPI 示例时，日志会把驱动遍历的 sensor 列表全部打出来，即使识别失败也会打印 `WARN: Sensor Name: xxx, Expected Chip ID: ..., Actual Chip ID Read: 0x00`。从 X5 实测日志里可以读到驱动内置的 sensor 支持面远大于配件清单：

`sc1330t`、`irs2875-tof`、`sc230ai-10fps/30fps`、`sc132gs-1280p`、`sc132gs-hdr-2lane`、`sc035hgs`、`sc035hgs_mono`、`sc035hgs-vc0/vc1`、`ov5640`、`f37`、`imx415-30fps-2lane/4lane`、`imx415-60fps-4lane`、`imx415-20fps-2lane`、`imx477`（4 档）、`imx219`（5 档）、`ov5647`（4 档）、`sc202cs-1600x1200`、`irs2381c-tof`、`sc231ai-30fps`、`imx586-30fps-4lane`、`os08c10-30fps-2lane`、`ov50h40-30fps-4lane`、`ox05b1s`、`sc850sl-30fps`、`shw3g-30fps`、`ar0233-30fps`、`ar0820std-30fps`、`sc1336`、`ov9782-120fps/200fps-2lane`、`dummy`。

**这张表的价值在于反向使用**：如果你的 sensor 型号不在里面，无论怎么接线都不会出图——驱动里没有它的 chip ID 与初始化序列。

### 2.2.2.4 版本对 sensor 支持的影响

| 版本 | 与摄像头相关的变更 |
| --- | --- |
| 3.2.3 | 集成 V4L2 框架，已适配 imx477、ov5647、imx219；修复幻尔载板启动失败 |
| 3.3.3 | 新增御光-SC132GS 双目摄像头模组驱动；srpi-config 支持接口自动管脚复用、新增 MIPI 屏幕选择 |
| 3.4.1 | 媒体链路大规模修复（ISP/VIO/编解码）；示例程序全面清理补齐 |
| 3.5.0 | Python 示例全量重写为 `hbm_runtime`；C++ 新增 `sp_open_camera_v3`；Python Camera 对象新增 `open_cam` 方法；支持打开相机时同步配置裁剪参数 |

**关键判断**：如果要在 3.2.3 之前用 V4L2 抓图，是走不通的——V4L2 框架是 3.2.3 才集成的。而 GS130W/GS130WI 这类 SC132GS 双目，驱动是 3.3.3 才加入的，更早的系统版本上必然识别不到。

> 来源：官方文档 Quick_start/accessory（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/accessory）、Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）、Basic_Application/cdev_demo_sample/vio2display 日志（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/vio2display）

---

## 2.2.3 在 `srpi-config` 里使能

### 2.2.3.1 三种采集模式

官方 V4L2 文档把 X5 的相机工作模式分三种，必须选一种：

| 模式 | 数据通路 | 适用 |
| --- | --- | --- |
| **HBN 常规模式** | Camera → VIN → ISP → VSE，用 vnode 抽象，多个 vnode 组成一条 vflow | 默认，多媒体示例（`vio2display` 等）走这条 |
| **V4L2 sif-isp-vse** | 每个模块都暴露 v4l2 video 设备节点，用户直接调 v4l2 API | 需要自己控 V4L2 参数、或用 `v4l2-ctl` 抓图 |
| **V4L2 vse alone** | 只暴露 VSE 通道节点，回灌图像给 VSE 处理 | 不用摄像头，纯做硬件缩放/裁剪 |

HBN 模式下，Camera 是单独一套 API，Camera 之后的 VIN/ISP/VSE/GDC/Codec 都用 vnode 抽象；Camera 与 VIN 通过 attach 接口绑定，vflow 建起来之后用户不用管帧的传递。

### 2.2.3.2 配置步骤

```bash
# 需要 sudo，且必须全屏终端
sudo srpi-config
```

路径：`3 Interface Options` → `I7 V4L2` → `I1 V4L2 Enable/disable V4L2 interface for camera`。

选择 `sif-isp-vse` 后会弹出 CAM0 / CAM1 选择——这一步就是 1.2 节说的物理接口选择。**如果 cam0 与 cam1 都配置了，官方明确"默认选择 cam1"**。

配置完成后必须重启：

```bash
sync && sudo reboot
```

### 2.2.3.3 确认模式生效

```bash
# 看 v4l 相关驱动与 sensor 驱动是否加载
lsmod | grep -iE "v4l|imx|ov5647|sc132"
```

### 2.2.3.4 sensor 效果库切换（只针对 IMX219）

`srpi-config` 有一个 `Sensor Profiles` 菜单，用于切换 IMX219 的效果库：

| 选项 | FOV | 适配模组 |
| --- | --- | --- |
| 1 | 79.3° | Jetson Nano 摄像头 |
| 2 | 120° | 树莓派 5 代摄像头（120FOV 模组） |

官方原文的说法是"适配 200FOV 和 160FOV 的模组"与"1 FOV 79.3° 对应 Jetson Nano"混在一句里，读起来有歧义；以菜单实际显示的两档为准：**79.3° 对应 Jetson Nano 模组，120° 对应 Pi5 模组**。选错不会报错，只是 ISP 参数与光学不匹配，表现为颜色偏、暗角重、边缘发虚。

> 来源：官方文档 System_configuration/srpi-config（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/srpi-config）、Advanced_development/hardware_development/rdk_x5/V4l2

---

## 2.2.4 V4L2 用法

### 2.2.4.1 设备节点映射表

V4L2 sif-isp-vse 模式生效后，节点是固定的。这张表建议直接抄下来：

| CSI | SIF | ISP | VSE0 | VSE1 | VSE2 | VSE3 | VSE4 | VSE5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CSI0 | video0 | video4 | video8 | video9 | video10 | video11 | video12 | video13 |
| CSI1 | video1 | video5 | video14 | video15 | video16 | video17 | video18 | video19 |
| CSI2 | video2 | video6 | video20 | video21 | video22 | video23 | video24 | video25 |
| CSI3 | video3 | video7 | video26 | video27 | video28 | video29 | video30 | video31 |

注意 CSI0 的 ISP 是 **video4** 而不是 video1——从 VIN 到 ISP 跳了三个号。这是最容易记错的一处。

### 2.2.4.2 查看设备拓扑

```bash
# 需要 root
media-ctl -d /dev/media0 --print-dot > media0.dot
dot -Tpng media0.dot -o media0.png
```

生成的图展示 `/dev/media0` 的媒体管道结构：传感器、ISP、视频节点、数据流路径。

### 2.2.4.3 抓一帧

```bash
# 1) 列出支持的分辨率与像素格式（同时完成驱动初始化）
v4l2-ctl --list-formats-ext --device /dev/video4

# 2) 抓 1 帧 NV12 到文件
v4l2-ctl -d /dev/video4 \
  --set-fmt-video=width=640,height=480,pixelformat=NV12 \
  --stream-mmap=3 \
  --stream-skip=3 \
  --stream-to=/tmp/nv12.yuv \
  --stream-count=1 \
  --stream-poll
```

参数含义：`--stream-mmap=3` 用 3 个 mmap 缓冲；`--stream-skip=3` 丢弃前 3 帧（等自动曝光稳定）；`--stream-count=1` 只存 1 帧。

抓下来的 NV12 用 `yuvplayer` 或 `ffmpeg` 转 PNG 才能看。文件大小应为 `宽 × 高 × 1.5`（NV12 是 Y 全采样 + UV 半采样），尺寸不对说明格式参数没生效。

### 2.2.4.4 官方 C 示例

```bash
cd /app/cdev_demo/v4l2/
sudo make
```

参数：

| 参数 | 含义 |
| --- | --- |
| `-w` | sensor 输出宽 |
| `-h` | sensor 输出高 |
| `-c` | 采集图片数量 |
| `-n` | sensor 采集 video 节点 |
| `-o` | 输入 NV12 图像 video 节点（vse alone 模式用） |
| `-i` | 输入 NV12 图像路径（vse alone 模式用） |

```bash
# sif-isp-vse 模式，抓 10 张 1920x1080
./v4l2 -w 1920 -h 1080 -c 10 -n 4

# vse alone 模式：以 1080p.yuv 为输入，走 VSE 通道 2 缩放
./v4l2 -w 1920 -h 1080 -c 10 -n 2 -o 2 -i ./1080p.yuv
```

### 2.2.4.5 V4L2 模式的两条已知限制

官方在文档末尾直接写了"已知问题"，这两条会直接影响实现方案：

1. **取 VSE 流时，强制选择 1920x1080 分辨率的 ISP sensor 配置文件**——也就是说你不能通过 VSE 拿一个 sensor 原生非 1080p 配置下的缩放流；
2. **V4L2 vse alone 模式仅支持 VSE 通道 2** 回灌图像——不是任意通道都能用。

> 来源：官方文档 Advanced_development/hardware_development/rdk_x5/V4l2

---

## 2.2.5 用 Python / C 采集（HBN 与示例）

### 2.2.5.1 MIPI 示例套件

`/app/pydev_demo/08_mipi_camera_sample` 下有 5 个脚本：

| 脚本 | 功能 | 关键参数 |
| --- | --- | --- |
| `01_mipi_camera_yolov5s.py` | 实时目标检测，HDMI 输出 | 无参数，自动选板载 MIPI 摄像头 |
| `02_mipi_camera_dump.py` | 采集保存 YUV | `-f` 帧率、`-c` 帧数、`-w` 宽、`-h` 高 |
| `03_mipi_camera_scale.py` | 读 YUV，硬件缩放后保存 | `-i` `-o` `-w` `-h` `--iwidth` `--iheight` |
| `04_mipi_camera_crop_scale.py` | 读 YUV，裁剪 + 缩放 | 额外 `-x` `-y` `--crop_w` `--crop_h` |
| `05_mipi_camera_streamer.py` | 摄像头直出到 HDMI | `-w` `-h` |

```bash
cd /app/pydev_demo/08_mipi_camera_sample
sudo python 02_mipi_camera_dump.py -f 30 -c 10 -w 1920 -h 1080
```

**Desktop 版本必须先关桌面服务**，否则 HDMI 上看到的是桌面而不是检测结果：

```bash
# 需要 sudo
sudo systemctl stop lightdm
```

### 2.2.5.2 分辨率改了会怎样：一个真实故障

社区有一个典型案例值得完整复盘，因为它揭示了"改分辨率"这件事的真实成本。

**现象**：用户在 3.4.1 系统上运行 `01_mipi_camera_yolov5s.py`，把原来的

```python
#cam.open_cam(0,-1,-1,[w,disp_w],[h,disp_h],1080,1920)
cam.open_cam(0,-1,-1,1920,1080)
```

改成后者（传宽高两个整数），启动正常、持续运行几分钟后报错退出。

**根因**：两处。

1. `open_cam` 的参数形式被换了。原写法传的是列表 `[w, disp_w]` / `[h, disp_h]`，新写法传两个标量——这两者在库里对应不同的重载语义，不是"简化写法"。3.5.0 才新增了 `open_cam` 支持在打开时同步配置裁剪参数，更早版本上这个接口的参数表更窄。
2. 日志显示驱动自动选到了 `imx415-60fps-4lane`（3840x2160@60fps），然后用 VSE 通道 0 缩到 1920x1080。IMX415 是 4lane 高带宽 sensor，60fps 4K 的持续数据量对 DDR 带宽与 ISP 管线压力很大，长时间运行会触发丢帧累积。

**处置**：

```bash
# 1) 恢复官方原始参数形式，不要自行简化
git -C /app/pydev_demo status 2>/dev/null || echo "非 git 环境，手动恢复"

# 2) 显式指定低帧率 sensor 配置，避免自动挑到 4K60
#    在代码中把 open_cam 的 fps 参数从 -1 改为 30

# 3) 确认当前实际选中的 sensor
sudo python 02_mipi_camera_dump.py -f 30 -c 1 -w 1920 -h 1080 2>&1 | grep -E "Found sensor|Auto-selected"
```

**预防**：`-1` 表示"让驱动自动选"，在多配置 sensor 上它会挑**最高规格**那档。凡是要长时间跑的场景，把 fps 与分辨率显式写死，不要依赖自动选择。

> 来源：社区帖 35422（https://forum.d-robotics.cc/t/topic/35422）

### 2.2.5.3 C 示例：`vio2display` / `vio_capture` / `vio2encoder`

三个示例同属 `/app/cdev_demo/`，都基于 `libspcdev`，都要先关桌面：

```bash
sudo systemctl stop lightdm
```

| 示例 | 作用 | 编译与运行 |
| --- | --- | --- |
| `vio2display` | 摄像头画面直出 HDMI | `make` → `./vio2display -h 1080 -w 1920` |
| `vio_capture` | 采集 YUV/RAW 存文件 | `make` → `./capture -b 16 -c 10 -h 1080 -w 1920` |
| `vio2encoder` | 摄像头编码成 H.264 | `make` → `./vio2encoder -w 1920 -h 1080 --iwidth 1920 --iheight 1080 -o stream.h264` |

`vio2display` 的 `-h` / `-w` **必须匹配摄像头实际分辨率**。日志里会打印可选显示模式列表（`1920x1080`、`1360x768`、`1280x1024`、`1280x720`、`1024x768`、`800x600`、`720x576`、`720x480`、`640x480`），随后 `disp_w=1920, disp_h=1080` 是最终选中的模式。

`vio2encoder` 的输出码率固定 8000（日志 `bit_rate:8000`），H.264，帧率取 sensor 帧率。

> 来源：官方文档 Basic_Application/cdev_demo_sample/vio2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/vio2display）、同目录 vio_capture、vio2encoder

---

## 2.2.6 USB 摄像头（UVC）

### 2.2.6.1 设备节点：两个说法并存

这是一个必须点明的冲突：

- **官方示例日志**（`/app/pydev_demo/07_usb_camera_sample/usb_camera_yolov5x.py`）打印的是：

```
Opening video device: /dev/video0
Open USB camera successfully
```

- **官方 FAQ** 却说：在地瓜 RDK 板卡（如 X3 系列）上，标准 UVC 摄像头创建的视频节点**通常不是** `/dev/video0`，而是 `/dev/video8`，也可能是 `/dev/video9`、`/dev/video10`。

**判断依据**：FAQ 那段明确限定在"RDK X3 系列"，且当时 MIPI 的 video 节点已经占用了 video0~video7 的编号段。X5 上的实际编号取决于是否启用了 V4L2 模式（启用后 video0~video31 会被 MIPI 占满），所以**任何固定编号的写法都不可靠**。

正确做法是先查后写：

```bash
# 插上 USB 摄像头后
ls /dev/video*

# 看哪个节点是新出现的、支持 UVC
v4l2-ctl --list-devices
```

OpenCV 里用 `cv2.VideoCapture(N)`，N 就是这个节点号。

> 来源：官方文档 Basic_Application/vision/RDK_X5/usb_camera（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/vision/RDK_X5/usb_camera）、FAQ/interface

### 2.2.6.2 官方示例

```bash
cd /app/pydev_demo/07_usb_camera_sample
sudo python usb_camera_yolov5x.py
```

用 `q` 退出，**前提是鼠标焦点在显示窗口上**。

该示例会弹窗口显示结果，因此必须有图形环境。Server 版镜像的做法是用 MobaXterm 等支持 X11 转发的工具连板子，把窗口转发到本地。

正常启动日志（注意其中的版本告警是正常的）：

```
Opening video device: /dev/video0
Open USB camera successfully
[BPU_PLAT]BPU Platform Version(1.3.6)!
[HBRT] set log level as 0. version = 3.15.55.0
[DNN] Runtime version = 1.24.5_(3.15.55 HBRT)
[W][DNN]bpu_model_info.cpp:491][Version] ...
  Inconsistency between the hbrt library version 3.15.55.0 and the model build
  version 3.15.47.0 detected, ... recommended to use compilation tools and the
  BPU SDK from the same OpenExplorer package.
```

那条 `Inconsistency ... hbrt library version ... model build version` 是**模型编译版本与运行时版本不一致**的提示，不影响示例运行，但说明模型的编译工具链版本旧于板端运行时。要消除它只能重新编译模型，属于第三卷的范畴。

### 2.2.6.3 USB 摄像头不出图的标准排查

按顺序做，前一步不通不要跳到下一步：

```bash
# 1) 内核有没有认到设备
dmesg | tail -20
#    期望看到 usb X-X: new high-speed USB device + uvcvideo 注册

# 2) 有没有 video 节点
ls /dev/video*
v4l2-ctl --list-devices

# 3) 节点能不能出图（不涉及任何应用代码）
v4l2-ctl -d /dev/video0 --list-formats-ext
v4l2-ctl -d /dev/video0 --set-fmt-video=width=640,height=480,pixelformat=MJPG \
  --stream-mmap=3 --stream-count=1 --stream-to=/tmp/usb.mjpg

# 4) 只有第 3 步通了，才去怀疑示例代码
```

若第 1 步就没有新设备，问题在 USB 侧：换口、换线、去掉 Hub、换一个供电充足的电源适配器。官方 FAQ 提到的 `Micro USB` 冲突（当 Micro USB 接了数据线用于调试时可能影响其他 USB Host 口枚举）在 X5 上表现为调试线插着时 USB 摄像头认不到。

---

## 2.2.7 MIPI 不出图：分层判据

这是本章最有价值的部分。社区里最完整的一个案例（GS130WI 双目不出图）历时两周、12 楼回复，最终把问题定位到硬件/接触层，而不是软件。它的价值在于给出了**可复现的判定顺序**。

### 2.2.7.1 关键信号：不是"初始化成功"，而是"之后有没有帧"

日志出现这两行，都**不代表**出图成功：

```
[mipi_cap]: [init]->cap sc132gs-1280p init success.
INFO: vp_sensor_fixed_mipi_host_1 Found sensor_name:sc132gs-1280p ...
```

前者只说明 sensor 的 I2C 初始化写完了寄存器；后者只说明 chip ID 读对了。真正的判据是：

```bash
# 话题在不在
ros2 topic list | grep image_combine_raw

# 话题里有没有数据（有数据 = 相机硬件与连接都没问题）
ros2 topic echo /image_combine_raw

# 实际帧率
ros2 topic hz /image_combine_raw
```

以及日志里这条：

```
[mipi_node]: grab failed
```

`grab failed` 持续增加 = 取帧链路断了。**它和 `init success` 同时出现是完全可能的**，两者不在同一层。

### 2.2.7.2 分层判据表

| 层 | 现象 | 判据 | 处理方向 |
| --- | --- | --- | --- |
| L1 电气/接触 | `Actual Chip ID Read: 0x00` 全表 | 所有 sensor 都读 0x00，说明 I2C 上根本没有器件 | 排线是否插紧、方向是否正确、接口是否损伤、供电是否有 5V |
| L2 sensor 识别 | 部分 sensor 读到非 0x00 | 有 chip ID 但型号对不上（如读到 0x132 但被当 sc230ai） | EEPROM/固件、是否同款模组 |
| L3 取帧 | init success + `grab failed` 持续 | `ros2 topic hz` 为 0，`echo` 无输出 | 双路 MIPI、LPWM 同步、GDC 配置、供电 |
| L4 编码/推流 | `Hobot_Codec has not received image for more than 5 seconds!` | 上游话题没数据 | 先修 L3，不要动 codec |
| L5 显示 | 编码输出正常但屏幕黑 | HDMI/DRM 侧问题 | 见第三章 |

案例中的完整失败链是这样的：

```
[mipi_cap]: [init]->cap sc132gs-1280p init success.        ← L2 通过
[...] Websocket did not receive image data! ...
[hobot_codec] Hobot_Codec has not received image for more than 5 seconds!  ← L4 报错
[mipi_node]: grab failed  （持续刷屏）                      ← 真正的病灶在 L3
```

如果只看 `codec 收不到图` 就去调编码参数，方向就错了——那是 L4 的症状。

### 2.2.7.3 四组单变量 A/B：把 GDC 与 LPWM 分离

GS130WI 是双 SC132GS，`lpwm_enable=True` 对应硬件同步，`False` 是软件同步。社区实测者给出的四组对照（每组长跑 ≥ 60 秒，覆盖故障窗口）：

| 模式 | `gdc_enable` | `lpwm_enable` | 用途 |
| --- | --- | --- | --- |
| A | True | False | 软件同步基线 |
| B | False | False | 隔离 GDC，尺寸须匹配 sensor 原生输出 |
| C | True | True | 对照 LPWM 硬件同步 |
| D | False | True | GDC-off 下对照 LPWM |

实测结论（同版 X5 OS 3.5.0 / kernel 6.1.83 / TROS 2.5.2、同款 GS130WI）：

| 配置 | 实测帧率 | `grab failed` |
| --- | --- | --- |
| 双路 GDC-on、LPWM-off | 约 49–52 Hz | 0 |
| 双路 GDC-off、LPWM-off | 约 52 Hz | 0 |
| 双路 GDC-on、LPWM-on | 约 10 Hz | 0 |
| 仅 channel 0 或仅 channel 2（GDC-off） | 各约 60 Hz | 0 |
| 四组自动轮测 | 52.826 / 60.379 / 29.850 / 29.942 Hz | 全部 0 |

这说明**"2.5.2 软件栈必然不支持 GS130WI"这个结论是错的**——同版本硬件上能稳定出帧。差异于是收敛到：相机/FFC 接触、板端接口、供电、EEPROM/固件、启动时残留的相机进程。

### 2.2.7.4 GDC-off 时的一个陷阱：尺寸必须匹配原生输出

同一位实测者还给了反例：用 SC230AI 时，**GDC 关闭后如果仍强行用 1088×1280，会立即报**

```
creat_vse_node ret -10
```

改成 sensor 原生 1920×1080 后即正常。所以：

- `creat_vse_node ret -10` 是**尺寸不匹配**的信号，不是"相机坏了"；
- GDC-on 时输入是旋转后的尺寸（如 1088×1280），GDC-off 时要用未旋转的原生尺寸（如 1920×1080）。

把 `-10` 和"长时间 `grab failed`"当成同一个根因，是这类排查里最常见的误判。

### 2.2.7.5 完整检查清单

```bash
# ── L0：环境 ──────────────────────────────
cat /etc/version                 # 系统版本，确认 sensor 驱动是否已在该版本引入
apt show tros-humble | head -3   # TROS 版本

# ── L1：残余进程（会抢占相机）──────────────
ps aux | grep -E "mipi_cam|vio2display|capture" | grep -v grep
# 如按住摄像头，先杀掉再重试
sudo pkill -9 -f mipi_cam

# ── L2：sensor 识别 ────────────────────────
sudo dmesg | grep -iE "sensor|chip id|mipi" | tail -40
# 关注 Actual Chip ID Read 是否为 0x00

# ── L3：配置与帧率 ─────────────────────────
cat /proc/device-tree/soc/cam/vcon@0/status 2>/dev/null
ros2 topic hz /image_combine_raw

# ── L4：接触与供电 ─────────────────────────
# 断电后重新插拔排线（严禁带电插拔）
# 万用表量相机接口 5V 引脚
```

> 来源：社区帖 35592（https://forum.d-robotics.cc/t/topic/35592）

### 2.2.7.6 另一个常见误配：OV5647 想要 60 帧

**现象**：OV5647 用不上 60fps，`vio2display` 起来后帧率只有 30。

**根因**：不是驱动问题。OV5647 的四档配置里，**只有 640x480 支持 60fps**：

```
ov5647-640x480-60fps
ov5647-1280x960-30fps
ov5647-1920x1080-30fps
ov5647-2592x1944-15fps
```

1920x1080 只有 30fps 这一档，想要 1080p@60 在硬件上就不可能。

**处置**：

```bash
cd /app/cdev_demo/vio2display
./vio2display -h 480 -w 640
```

**预防**：把分辨率与帧率当成**成对**的配置项，去官方分辨率表里查是否存在这一组合，而不是先把分辨率定死再问帧率为什么上不去。

> 来源：社区帖 35560（https://forum.d-robotics.cc/t/topic/35560）、官方文档 Quick_start/accessory

---

## 2.2.8 四段式排障：USB 摄像头画面黑屏

**现象**

运行 `usb_camera_fcos.py`，日志显示 `USB摄像头打开成功`、也能打印识别到的物体信息，但实时显示窗口全黑。已经 `apt update && apt upgrade`、重启、`sudo python3` 运行、运行前后插拔 HDMI 显示器，现象不变。用 `usb_camera_snap.py` 能正常保存图片，说明摄像头本身没问题。

**根因**

`lightdm` 桌面服务占着 DRM/KMS 显示通道。示例程序要直接渲染到 HDMI（走 `/dev/dri/card0`），与 X 桌面争抢同一个显示资源，结果是应用层拿到了画面但显示层不呈现。

判据就是这一句：**`snap`（存文件）能跑、`display`（上屏）黑屏** —— 说明采集链路通、只有显示链路被占。

**处置**

```bash
# 需要 sudo；停掉桌面显示管理器
sudo systemctl stop lightdm

# 再运行示例
cd /app/pydev_demo/07_usb_camera_sample
sudo python usb_camera_yolov5x.py
```

要恢复桌面：

```bash
sudo systemctl start lightdm
```

**预防**

记住一条规则：**凡是"直出 HDMI"的示例（`vio2display`、`decode2display`、`rtsp2display`、`bpu`、各类 `*_streamer.py`、`*_display`），在 Desktop 版系统上都要先 `sudo systemctl stop lightdm`**。Server 版没有 `lightdm`，不用这一步。官方在 MIPI 示例、`vio2display`、`bpu`、`rtsp2display` 等多篇文档里都重复了这句，是共性要求而非个例。

> 来源：社区帖 28147（https://forum.d-robotics.cc/t/topic/28147）、官方文档 Basic_Application/vision/RDK_X5/mipi_camera（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/vision/RDK_X5/mipi_camera）

---

## 9. 常见误区

1. **"日志打 `init success` 就说明摄像头好了"**——不是。`init success` 只代表 I2C 寄存器写完了；真正判据是 `ros2 topic hz` 有帧率、`v4l2-ctl` 能抓到数据。`init success` 与 `grab failed` 同时出现是常态。

2. **"codec 报 `has not received image`，所以要调编码参数"**——方向反了。那是上游没帧的症状，属于最下游的报错。修 L4 之前必须先确认 L3（取帧）通。

3. **"换个摄像头型号就能解决不出图"**——换了也没用的场景很常见。如果 `Actual Chip ID Read` 全是 `0x00`，说明 I2C 上一个器件都没应答，问题在排线/接触/供电，换型号不会改变这一点。

4. **"USB 摄像头一定是 `/dev/video0`"**——FAQ 明确说 X3 上通常是 `/dev/video8`；X5 上如果启用了 V4L2 模式，video0~video31 会被 MIPI 占满，USB 摄像头的编号会更大。必须先 `v4l2-ctl --list-devices` 查。

5. **"OV5647 上不了 60 帧是驱动 bug"**——只有 640x480 有 60fps 档，1080p 硬件上就只有 30fps。

6. **"cam0 和 cam1 都配置了更保险"**——官方明确两者都配时默认选 cam1。多配一路不会更保险，只会让你搞不清实际用的是哪一路。

7. **"GDC 关了只要把尺寸改小就行"**——GDC-off 必须用 sensor **原生**输出尺寸。用旋转后的尺寸会报 `creat_vse_node ret -10`。

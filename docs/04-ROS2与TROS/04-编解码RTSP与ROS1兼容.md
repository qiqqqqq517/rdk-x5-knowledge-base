# 编解码、RTSP 与 ROS1 兼容

## 本章解决什么

这一章处理三类「跨越边界」的问题：**格式边界**（H.264/H.265/MJPEG 与 NV12/BGR8 之间互转）、**网络边界**（把摄像机码流拉进板子、把板子画面推出去）、**ROS 版本边界**（ROS1 算法与 ROS2 生态共存）。

三段各有各的坑：编解码的坑在硬件资源上限与帧率计算，RTSP 的坑在网络抖动导致解码器崩溃，ROS1 兼容的坑在 Ubuntu 20.04 这个硬约束上。本章逐段给出可用配置和已知限制。

## hobot_codec：硬件编解码

### 能力边界

`hobot_codec` 调的是 X5 的硬件编解码单元（VDEC/VENC/JPEG）。硬件本身的规格：

> 「支持 H.265（HEVC）编码和解码：Main profile @ L5.1。支持 H.264（AVC）编码和解码：Baseline/Constrained Baseline/Main/High profiles @ L5.2。H.264 支持 SVC-T 编码。H265/H264 编解码性能：最大支持 3840 x 2160@60fps 编码，最大支持 3840 x 2160@60fps 解码，编码器和解码器同时支持 3840 x 2160@30fps。支持 JPEG 编码和解码：支持 JPEG baseline/extended，支持 3840 x 2160@30fps 的同时编码和解码，最大支持编解码分辨率 32768 x 32768 像素，最小支持编解码分辨率 16 x 16 像素。」
> 来源：社区帖 28470（https://forum.d-robotics.cc/t/topic/28470）

把这段规格整理成选型表：

| 能力 | 上限 | 备注 |
| --- | --- | --- |
| H.265 解码 | 3840×2160 @ 60fps | Main @ L5.1 |
| H.264 解码 | 3840×2160 @ 60fps | L5.2，支持 SVC-T |
| JPEG 解码 | 3840×2160 @ 30fps | baseline/extended |
| 编+解同时 | 3840×2160 @ 30fps | 编解码共享硬件 |
| 单方向最大分辨率 | 32768×32768 | 极端值，实际受内存限制 |
| 最小分辨率 | 16×16 | — |

**"编解码同时"这条是资源规划的关键**：如果你既要解码一路 RTSP、又要编码一路给 Web 展示，两者的合计吞吐不能超过 4K@30fps 的等效带宽。1080p@30fps 约等于 4K@30fps 的 1/4，所以理论上能同时跑 2 路解码 + 2 路编码——但实际还要留余量给 ISP/VSE。

### 参数全表

`hobot_codec` 启动时会把所有参数打出来，这是最权威的清单：

```
[hobot_codec_republish-2] [WARN] [hobot_codec_decoder]: Parameters:
[hobot_codec_republish-2] sub_topic: /image
[hobot_codec_republish-2] pub_topic: /hbmem_img
[hobot_codec_republish-2] channel: 1
[hobot_codec_republish-2] in_mode: ros
[hobot_codec_republish-2] out_mode: shared_mem
[hobot_codec_republish-2] in_format: jpeg
[hobot_codec_republish-2] out_format: nv12
[hobot_codec_republish-2] jpg_quality: 60.00
[hobot_codec_republish-2] input_framerate: 30
[hobot_codec_republish-2] output_framerate: -1
[hobot_codec_republish-2] dump_output: false
[hobot_codec_republish-2] dump_file_prefix: ./dump_codec_output
[hobot_codec_republish-2] dump_frame_count: -1 (unlimited)
[hobot_codec_republish-2] [WARN] [HobotCodecImpl]: platform x5
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

编码方向的参数略有不同（多出 `enc_qp`）：

```
[hobot_codec_republish-4] [WARN] [hobot_codec_encoder]: Parameters:
[hobot_codec_republish-4] sub_topic: /StereoNetNode/stereonet_visual
[hobot_codec_republish-4] pub_topic: /image_jpeg
[hobot_codec_republish-4] channel: 1
[hobot_codec_republish-4] in_mode: ros
[hobot_codec_republish-4] out_mode: ros
[hobot_codec_republish-4] in_format: bgr8
[hobot_codec_republish-4] out_format: jpeg
[hobot_codec_republish-4] enc_qp: 10
[hobot_codec_republish-4] jpg_quality: 60
[hobot_codec_republish-4] input_framerate: 30
[hobot_codec_republish-4] output_framerate: -1
[hobot_codec_republish-4] dump_output: 0
```

> 来源：社区帖 28778（https://forum.d-robotics.cc/t/topic/28778）

### 参数说明

| 参数 | 方向 | 含义 | 取值 |
| --- | --- | --- | --- |
| `sub_topic` | 通用 | 订阅哪个话题 | `/image`、`/hbmem_img`、`/rtsp_image_ch_0` |
| `pub_topic` | 通用 | 发布到哪个话题 | `/hbmem_img`、`/image_jpeg`、`/image` |
| `channel` | 通用 | 编解码通道号（多路时区分） | `0`、`1`、… |
| `in_mode` | 通用 | 输入承载方式 | `ros` / `shared_mem` |
| `out_mode` | 通用 | 输出承载方式 | `ros` / `shared_mem` |
| `in_format` | 通用 | 输入格式 | `jpeg` / `bgr8` / `nv12` / `h264` / `h265` |
| `out_format` | 通用 | 输出格式 | `jpeg` / `bgr8` / `nv12` / `h264` / `h265` |
| `jpg_quality` | 编码 | JPEG 质量（0–100） | `60` |
| `enc_qp` | 编码 | H.264/H.265 量化参数，越大越糊 | `10` |
| `input_framerate` | 通用 | 输入帧率（用于计算） | `30` |
| `output_framerate` | 通用 | 输出帧率限制，`-1` 为不限 | `-1` / `10` / `15` / `30` |
| `dump_output` | 调试 | 是否把输出落盘 | `true` / `false` |
| `dump_file_prefix` | 调试 | 落盘文件名前缀 | `./dump_codec_output` |
| `dump_frame_count` | 调试 | 落盘帧数，`-1` 不限 | `-1` / `10` |

### 版本变化：配置项被删除和新增

RDKOS 3.4.1 里有一条专门针对 `hobot_codec` 的改动：

> 「优化图像编解码模块：`hobot_codec` 的配置，删除无效的配置参数，增加用于 debug 的配置参数。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

RDK 总览页的对应写法：「`hobot_codec` 优化：优化了图像编解码模块配置，删除了无效参数，并新增用于 Debug 的配置项。」
> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）

**这条的实用价值**：`dump_output`、`dump_file_prefix`、`dump_frame_count` 这一组「落盘调试」参数就是 3.4.1 前后加入/调整的。在 3.3.3 及更早的系统上，这些参数可能不存在或名字不同。抄 launch 配置时如果报「unknown parameter」，先查系统版本。

### 版本变化：帧率计算错误修复

3.1.1 的修复记录：

> 「`hobot_codec` 修复帧率计算错误。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

现象是 `Pub img fps [23.52]` 这类统计数字不准。**这个 bug 的实际影响比看起来大**：因为排查「画面卡顿」时第一反应就是看 fps 数字，如果数字本身是错的，会往完全错误的方向排查。

对照真实输出（这是正常形态）：

```
[hobot_codec_republish-2] [WARN] [hobot_codec_decoder]: Pub img fps [23.52]
[hobot_codec_republish-2] [WARN] [hobot_codec_decoder]: Pub img fps [30.33]
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

稳定在 30 附近说明链路正常；掉到 23 说明有问题。但**只有在 3.1.1 及以上的系统上这个数字可信**。

### 四种典型用法

**用法一：JPEG → NV12（给推理用，走共享内存）**

```bash
ros2 launch hobot_codec hobot_codec.launch.py \
  codec_in_mode:=ros codec_in_format:=jpeg \
  codec_out_mode:=shared_mem codec_out_format:=nv12 \
  codec_sub_topic:=/image codec_pub_topic:=/hbmem_img
```

这是最常见的一条，USB 摄像头出 MJPEG，解码成 NV12 后丢给 `dnn_node`。

**用法二：BGR8 → JPEG（给 Web 展示用）**

```bash
ros2 launch hobot_codec hobot_codec.launch.py \
  codec_in_mode:=ros codec_in_format:=bgr8 \
  codec_out_mode:=ros codec_out_format:=jpeg \
  codec_sub_topic:=/image_combine_raw codec_pub_topic:=/image_jpeg
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

这条是「双目拼接图 → JPEG → websocket」的中间段。成功时打印：

```
[hobot_codec_republish-1] [WARN] [HobotVenc]: init_pic_w_: 1088, init_pic_h_: 2560, alined_pic_w_: 1088, alined_pic_h_: 2560, aline_w_: 16, aline_h_: 16
[hobot_codec_republish-1] [WARN] [hobot_codec_2bf5b169]: Pub img fps [32.73]
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

**注意 `alined_pic_w_` / `alined_pic_h_` 这两个值**：编码器要求宽高按 16 对齐（`aline_w_: 16, aline_h_: 16`）。1088 和 2560 都能被 16 整除所以没问题；如果你的分辨率是 1920×1080，1080 不能被 16 整除，对齐后变成 1088，多出来的 8 行是填充的，解码回来时要注意裁掉。
> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

**用法三：H.265 → NV12（RTSP 拉流后解码）**

```python
ComposableNode(
    package='hobot_codec',
    plugin='HobotCodecNode',
    name='h264_decode',          # 名字保持历史命名，实际解 H.265
    parameters=[
        {'in_format': 'h265'},
        {'in_mode': 'ros'},
        {'sub_topic': '/rtsp_image_ch_0'},
        {'out_mode': 'ros'},
        {'output_framerate': 30},
        {'out_format': 'nv12'},
        {'pub_topic': '/image'}
    ],
    extra_arguments=[{'use_intra_process_comms': True}],
),
```

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

**注意 `name='h264_decode'` 这个名字**：它只是个节点名，跟实际解码格式无关。社区里建议改名成 `h265_decode` 以免混淆，但改名后如果别处有按名字查找的逻辑会失效。

**用法四：NV12 → JPEG（推理结果可视化）**

```python
bgr2jpeg = Node(
    package='hobot_codec',
    executable='hobot_codec_republish',
    output='screen',
    parameters=[{
        'in_mode': 'ros',
        'in_format': 'bgr8',
        'out_mode': 'ros',
        'out_format': 'jpeg',
        'sub_topic': '/nebula200/stof_rgb/image_raw',
        'dump_output': False
    }],
    arguments=['--ros-args', '--log-level', 'warn']
)
```

> 来源：官方文档 Application_case/amr（https://developer.d-robotics.cc/rdk_x_doc/Application_case/amr）

这是官方 AMR 案例里的完整节点写法，可以直接当模板用。

## hobot_rtsp_client：拉流

### 智能盒子方案

`hobot_rtsp_client` 是「智能视频盒子」方案的核心节点，官方发布记录里描述的定位：

> 「全新应用方案：智能视频盒子 `hobot_rtsp_client`：支持 RTSP 拉流、解码、智能推理，并通过 Web 界面展示推理结果，快速集成边缘 AI 解决方案。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

功能包总表里的描述更简短：「智能盒子：RTSP 拉流 + 解码 + 算法推理」。
> 来源：社区帖 35812（https://forum.d-robotics.cc/t/topic/35812）

### 参数

从官方 launch 与社区改造版可以归纳出：

| 参数 | 含义 | 示例 |
| --- | --- | --- |
| `rtsp_url_num` / `hobot_rtsp_url_num` | 拉多少路 | `1`、`3`、`6` |
| `rtsp_url_0` / `hobot_rtsp_url_0` | 第 0 路 URL | `rtsp://admin:pwd@192.168.55.170:554/Streaming/Channels/102` |
| `transport_0` / `hobot_transport_0` | 传输协议 | `tcp` / `udp` |
| `websocket_channel` | Web 展示通道号 | `0`、`1`、… |

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）、社区帖 28952（https://forum.d-robotics.cc/t/topic/28952）

### 单路启动

```bash
source /opt/tros/humble/setup.bash
export ROS_DOMAIN_ID=100
ros2 launch hobot_rtsp_client hobot_rtsp_client_websocket.launch.py \
  hobot_rtsp_url_num:=1 \
  hobot_rtsp_url_0:='rtsp://127.0.0.1/1080P_test.h264' \
  hobot_transport_0:='udp' \
  websocket_channel:=0
```

> 来源：社区帖 28952（https://forum.d-robotics.cc/t/topic/28952）

### 多路启动与 ROS_DOMAIN_ID 隔离

社区的实测做法是**每路用不同的 `ROS_DOMAIN_ID`**，让多路之间话题互不干扰：

```bash
# 第 0 路
export ROS_DOMAIN_ID=100
ros2 launch hobot_rtsp_client hobot_rtsp_client_websocket.launch.py \
  hobot_rtsp_url_num:=1 hobot_rtsp_url_0:='rtsp://127.0.0.1/1080P_test.h264' \
  hobot_transport_0:='udp' websocket_channel:=0

# 第 1 路
export ROS_DOMAIN_ID=101
ros2 launch hobot_rtsp_client hobot_rtsp_client_websocket.launch.py \
  hobot_rtsp_url_num:=1 hobot_rtsp_url_0:='rtsp://127.0.0.1/1080P_test.h264' \
  hobot_transport_0:='udp' websocket_channel:=1
```

> 来源：社区帖 28952（https://forum.d-robotics.cc/t/topic/28952）

**但这位用户的原问题是「只有一路流有算法显示，其它路的流不显示」**，说明这个做法并不完整——`ROS_DOMAIN_ID` 隔离能解决话题冲突，但算法节点（`hobot_dnn_detection`）也只有一路在发布。要让每路都有独立的算法结果，每路都得有自己完整的「解码 + 推理」节点链，而不只是多开 rtsp_client。

### 多路崩溃：VDEC 资源上限

社区里一个 6 路 H.265@30fps 的案例，报错原文：

```
[ERROR] [tros_container-1]: process has died [pid 6533, exit code -11, cmd '/opt/ros/humble/lib/rclcpp_components/component_container_isolated --ros-args --log-level warn --ros-args -r __node:=tros_container --params-file /tmp/launch_params_i0fh3t6m']
```

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

关键背景是这位用户**改了官方的两处配置**：「和官方原来的 launch 文件相比，修改了解码输出从原来的 10fps 到 30fps，并把 h264 解码改为 h265 解码。」
> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

排查过程很有价值：用户先确认「单路以及三路配置已经验证过，连续运行三天也不存在崩溃的情况」，把问题从「网络/格式」收敛到「多路并发」：

> 「既然单路/三路能稳定运行 3 天，而 6 路并发时才出现随机崩溃，问题定位就清晰了：这是多路并发解码时的硬件资源竞争/瓶颈问题，而非网络或编码格式问题。RDK X5 的 VDEC（硬件解码单元）通道数量有限，6 路 30fps H.265 并发可能超出硬件解码能力或触发资源竞争条件。」
> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

**处置（按验证优先级排列）**：

| 方案 | 做法 | 原理 |
| --- | --- | --- |
| A：降帧率 | `output_framerate` 从 30 改 15 | 降低 VDEC 吞吐需求 |
| B：分批启动 | 每路加 `TimerAction(period=0.5)` | 避免同时初始化抢资源 |
| C：换 H.264 | `in_format` 改回 `h264` | H.265 解码资源占用更高 |
| D：看门狗 | systemd `Restart=on-failure` | 无法根治时保证自愈 |

分批启动的具体写法：

```python
from launch.actions import TimerAction

# 第 1 路立即启动
# 第 2-6 路各延迟 0.5 秒
TimerAction(
    period=0.5,
    actions=[LoadComposableNodes(...)]   # 第 2 路
)
```

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

看门狗写法（简单粗暴但有效）：

```bash
#!/bin/bash
while true; do
  ros2 launch your_package your_launch_file.py
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq -11 ] || [ $EXIT_CODE -eq 139 ]; then
    echo "Container crashed with segfault ($EXIT_CODE). Restarting..."
    sleep 2
  else
    echo "Container exited with code $EXIT_CODE. Not restarting."
    exit $EXIT_CODE
  fi
done
```

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

### 崩溃时的取证命令

```bash
# 查看 VDEC 通道使用情况
cat /proc/hb_vdec/status

# 实时看内核日志里的解码错误
dmesg -w | grep -i vdec

# 崩溃瞬间保存状态
cat /proc/hb_vdec/status > vdec_status_crash.txt
dmesg | grep -i vdec | tail -50

# 看线程是否卡在 D 状态（不可中断睡眠）
ps -eLo pid,tid,state,wchan | grep -i vdec
```

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

关注点：`vdec channel timeout`、`vdec resource busy`、`HB_VDEC_GetFrame` 的错误码。如果崩溃总是同一通道（如 `ch_5`），说明是通道级资源耗尽而不是全局问题。

### 网络抖动导致解码失败

另一个独立的故障模式：不是多路并发，而是单路网络抖动。

社区里 `rtsp2display` 案例的记录：

> 「`demo` 案例没有考虑丢帧、花屏的异常处理」（官方对 RTSP 硬件解码崩溃问题的回复要点）
> 来源：社区帖 28843（https://forum.d-robotics.cc/t/topic/28843）

以及更具体的定位：

> 「网络抖动：RTSP 流丢失了 I 帧（关键帧），解码器内部状态机错误，后续帧无法解码，但上层 ROS 节点仍尝试访问解码输出 Buffer，导致崩溃。」
> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

**机制**：H.264/H.265 是帧间压缩，P/B 帧依赖前面的 I 帧。丢一个 I 帧，后面一大段都解不出来。解码器此时返回的是错误码或空指针，而 `hobot_codec` 的上层没做空指针检查，直接访问 → `exit code -11`。

**处置**：

1. 先在 PC 端验证码流本身稳不稳：

```bash
ffplay -rtsp_transport tcp rtsp://admin:222107qq@192.168.55.170:554/Streaming/Channels/102
```

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

2. 把 `transport_0` 从 `udp` 改成 `tcp`。UDP 不重传，丢包直接丢帧；TCP 会重传，代价是延迟抖动。
3. 在摄像头 Web 端把 GOP/关键帧间隔调小（如 30 或 60 帧），这样丢包后能更快恢复。

## RTSP 推流与 C 接口示例

### 官方现有的两条 C 示例

板子上 `/app/cdev_demo/` 下有两套与编解码直接相关的 C 示例：

| 示例 | 输入 | 输出 | 用途 |
| --- | --- | --- | --- |
| `decode2display` | 本地 H.264 文件 | HDMI 显示 | 验证纯解码通路 |
| `rtsp2display` | RTSP 流 | HDMI 显示 | 验证网络 + 解码 + 显示全链路 |

### decode2display

```bash
cd /app/cdev_demo/decode2display
make
sudo ./decoder2display -w 1920 -h 1080 -i 1920x1080.h264
```

> 来源：官方文档 Basic_Application/cdev_demo_sample/decode2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/decode2display）

参数说明：

```
Usage: decoder2display [OPTION...]
decode2display sample -- An example of video decoding to the display
  -i, --input=path       input file path
  -w, --width=width      display width
  -h, --height=height    display height
  -?, --help             Give this help list
```

实现上「基于 spcdev 接口实现，解析输入给 main 的参数，通过 `libspcdev.so` API，获取到显示屏的分辨率之后，初始化解码器和显示模块，根据适配的分辨率和显示器的分辨率，判断是否需要使用 VPS 进行」缩放。
> 来源：官方文档 Basic_Application/cdev_demo_sample/decode2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/decode2display）

### rtsp2display

这条更有参考价值，因为它演示了从网络拉流到解码显示的完整链路。

**准备**：

```bash
cd /app/cdev_demo/rtsp2display
# 拷一份官方测试码流
cp /opt/tros/humble/lib/hobot_codec/config/1920x1080.h264 ./
# 起本地 RTSP 服务器（live555）
./live555MediaServer &
```

> 来源：官方文档 Basic_Application/cdev_demo_sample/rtsp2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/rtsp2display）

`live555MediaServer` 启动后会打印访问地址和它认识的扩展名：

```
Play streams from this server using the URL
rtsp://192.168.127.10/
".264" => a H.264 Video Elementary Stream file
".265" => a H.265 Video Elementary Stream file
```

> 来源：官方文档 Basic_Application/cdev_demo_sample/rtsp2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/rtsp2display）

**解码显示**：

```bash
systemctl stop lightdm          # 关桌面服务，避免抢 DRM
sudo ./rtsp2display -i rtsp://127.0.0.1/1920x1080.h264 -t tcp
```

> 来源：官方文档 Basic_Application/cdev_demo_sample/rtsp2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/rtsp2display）

参数只有两个，都是必填：

```
-i, --input=path    rtsp url
-t, --type=type     tcp or udp
```

**为什么要 `systemctl stop lightdm`**：显示走 DRM/KMS，桌面服务持有 DRM 主设备，不释放的话程序打不开 `/dev/dri/card0`。日志里的 `Opened DRM device: /dev/dri/card0` 就是这一步成功的标志。
> 来源：官方文档 Basic_Application/cdev_demo_sample/rtsp2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/rtsp2display）

**软件架构**（官方给的链路）：

> 「首先是通过 ffmpeg 的 libavformat 接口来解析和校验包头等，初始化解码器、VPS、显示等相关模块之后，进行 decoder→vps→display 通路的绑定，然后将 libavformat 解析出来的 data 通过 `sp_decoder_set_img` 传输到解码器中，解码器通过已经绑定的通路将数据通过 vps 给到了显示器做显示。」
> 来源：官方文档 Basic_Application/cdev_demo_sample/rtsp2display（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/rtsp2display）

这条链路对应四个 API 模块：`sp_decoder_*`（解码）、`sp_vps_*`（缩放/格式转换）、`sp_display_*`（DRM 显示）、`sp_decoder_set_img`（喂码流）。日志里看到的 `sp_open_vps success!` 就是 VPS 初始化成功。

### 用 ROS 节点做同样的验证（不写代码）

官方社区给了一条完全不用写代码的验证路径：

> 「TROS 目前集成了 `rtsp_client` 节点，用于将 RTSP 码流转化为 `/H26X` 的 ROS2 Topic 话题，`hobot_codec` 节点，用于调用 RDK X5 的硬件解码器，将码流解码为 YUV420SP(nv12) 格式的图像话题，然后我们再启动一个 Codec 节点将这个话题编码为 MJPEG，最后用 TROS 的 `websocket` 节点就可以对码流的图像进行可视化了。这样可以不写代码，直接使用敲命令行打命令的方式，在 C/C++ 的层面调用硬件编解码器，验证码流的功能。」
> 来源：社区帖 28470（https://forum.d-robotics.cc/t/topic/28470）

链路串起来就是：

```
RTSP 流 → hobot_rtsp_client（拉流，出 /rtsp_image_ch_0，格式 h264/h265）
        → hobot_codec（解码，出 /image，格式 nv12）
        → hobot_codec（编码，出 /image_jpeg，格式 jpeg）
        → websocket（推给浏览器 8000 端口）
```

三条命令：

```bash
source /opt/tros/humble/setup.bash

# 1. 拉流
ros2 launch hobot_rtsp_client hobot_rtsp_client_websocket.launch.py \
  hobot_rtsp_url_num:=1 \
  hobot_rtsp_url_0:='rtsp://<摄像头IP>/Streaming/Channels/102' \
  hobot_transport_0:=tcp

# 2. 解码（h265 → nv12）
ros2 launch hobot_codec hobot_codec.launch.py \
  codec_in_mode:=ros codec_in_format:=h265 \
  codec_out_mode:=ros codec_out_format:=nv12 \
  codec_sub_topic:=/rtsp_image_ch_0 codec_pub_topic:=/image

# 3. 编码（nv12 → jpeg）给 Web
ros2 launch hobot_codec hobot_codec.launch.py \
  codec_in_mode:=ros codec_in_format:=nv12 \
  codec_out_mode:=ros codec_out_format:=jpeg \
  codec_sub_topic:=/image codec_pub_topic:=/image_jpeg
```

网页访问 `http://<板卡IP>:8000`。

**这套流程的价值**：它把「代码是否正确」这个变量排除掉了。如果你的自写程序解不了某个码流，先用这套 ROS 节点跑一遍——能解说明码流没问题，问题在你的代码；不能解说明码流本身有问题（加密、非标准 profile、GOP 太长）。

## ROS1 兼容

### 硬约束：X5 没有 Ubuntu 20.04

这是所有 ROS1 方案的前提。ROS1 Noetic 官方只支持 Ubuntu 20.04，而 **X5 只有 Ubuntu 22.04**。

官方社区的明确答复：

> 「X5 没有 20.04 系统支持，未来只会更新新版本系统。ROS1 可以自己尝试下 Docker 来使用。」
> 来源：社区帖 35629（https://forum.d-robotics.cc/t/topic/35629）

同帖里更完整的结论：「根据知识库，未检索到 RDK X5 原生使用 Ubuntu 20.04 的官方方法；现有 Ubuntu 20.04 示例仅标注适用于 RDK X3 / X3 Module / Ultra，RDK X5 不建议直接套用或刷入其他平台镜像。」
> 来源：社区帖 35629（https://forum.d-robotics.cc/t/topic/35629）

**这条要当成硬事实记住**：不要试图刷 X3 的镜像到 X5，也不要指望官方后续会出 20.04 镜像。想要 ROS1，只有三条路：

| 路线 | 可行性 | 代价 |
| --- | --- | --- |
| A：`ros1_bridge` 桥接 | **推荐** | 需要另有一台 20.04 机器（PC 或容器） |
| B：Docker 里跑 ROS1 | 可行但有坑 | 网络/设备/库依赖都要透传 |
| C：ROS1 算法重写成 ROS2 | 长期最优 | 工作量大 |

### 路线 A：ros1_bridge

`ros1_bridge` 是官方 ROS 项目，作用是让 ROS1 与 ROS2 节点互相收发消息。它本身必须**同时 source 了 ROS1 和 ROS2 的环境**才能编译运行——这就决定了它没法在只装了 ROS2 的 X5 上原生跑。

官方 AMR 案例给了一个完整可用的实践（在 Ubuntu 20.04 上做双目标定数据采集，需要把 ROS2 图像转成 ROS1 的 bag）：

```bash
# 安装 ros1_bridge（注意版本要与 ROS2 发行版对应）
sudo apt update
sudo apt install ros-foxy-ros1-bridge

# 终端 1：起 ROS1 master
source /opt/ros/noetic/setup.bash
roscore

# 终端 2：起网桥，只桥接指定类型的话题
source /opt/ros/noetic/setup.bash
source /opt/ros/foxy/setup.bash
ros2 run ros1_bridge dynamic_bridge --bridge-all-topics=false --bridge-topic sensor_msgs/msg/Image /image_combine_raw

# 终端 3：ROS1 侧录包
source /opt/ros/noetic/setup.bash
rosbag record image_combine_raw
```

> 来源：官方文档 Application_case/amr（https://developer.d-robotics.cc/rdk_x_doc/Application_case/amr）

同案例里 IMU 数据也是同样套路，只换类型和话题名：

```bash
ros2 run ros1_bridge dynamic_bridge --bridge-all-topics=false --bridge-topic sensor_msgs/msg/Imu /imu_data
```

> 来源：官方文档 Application_case/amr（https://developer.d-robotics.cc/rdk_x_doc/Application_case/amr）

### 参数含义与版本对应

| 参数 | 含义 | 注意 |
| --- | --- | --- |
| `--bridge-all-topics` | 是否桥接所有话题 | 设 `true` 会把所有能映射的话题都桥过去，开销大 |
| `--bridge-topic <type> <topic>` | 只桥接指定类型+话题 | 推荐用法，可控 |
| `--bridge-all-services` | 是否桥接所有服务 | 一般不设 |

**版本对应关系**（这是最容易搞错的一项）：

| 板端 ROS2 环境 | 桥接包名 |
| --- | --- |
| TROS Humble（X5） | `ros-humble-ros1-bridge` |
| TROS Foxy（X3） | `ros-foxy-ros1-bridge` |
| ROS2 Foxy 标准版 | `ros-foxy-ros1-bridge` |

社区给的判断方法：

```bash
cat /etc/os-release
printenv | egrep "ROS|TROS"
ls /opt/tros
```

> 来源：社区帖 35629（https://forum.d-robotics.cc/t/topic/35629）

装错版本的典型表现：`ros2 run ros1_bridge dynamic_bridge` 报找不到可执行文件，或找到但一启动就因为 ABI 不匹配崩溃。

### 桥接的启动顺序

严格按这个顺序，错一步就不通：

```bash
# 步骤 1：确认板端 TROS 节点在发数据（在板子上）
source /opt/tros/humble/setup.bash
ros2 run mipi_cam mipi_cam --ros-args -p device_mode:="dual" -p out_format:="nv12" -p dual_combine:=2 -p framerate:=10.0 --log-level warn

# 步骤 2：在 20.04 机器上起 ROS1 master
source /opt/ros/noetic/setup.bash
roscore

# 步骤 3：同一台机器上新开终端，先 source ROS1 再 source ROS2（顺序不能反）
source /opt/ros/noetic/setup.bash
source /opt/tros/humble/setup.bash     # 或 /opt/ros/humble/setup.bash
ros2 run ros1_bridge dynamic_bridge --bridge-all-topics

# 步骤 4：ROS1 侧验证话题是否存在
source /opt/ros/noetic/setup.bash
rostopic list
```

> 来源：社区帖 35629（https://forum.d-robotics.cc/t/topic/35629）

**关键点：source 顺序**。必须先 ROS1 后 ROS2，反过来 `roscore` 相关的环境变量会被覆盖。这是 `ros1_bridge` 的通用要求，不是 X5 特有。

### 路线 B：Docker 里跑 ROS1（已知限制）

社区里有一个非常完整的失败记录，值得逐条读完，因为它把这条路的所有坑都踩了一遍。

用户的原始需求：「我需要使用 ros1 算法的同时，又想使用 bpu 进行 yolo 的目标识别。为了在 ubuntu22.04 上使用 ros1，我使用 ubuntu2004 的 docker 进行 ros1 算法的使用。」

尝试一：host 模式 Docker + 容器内装 noetic 和 foxy + ros1_bridge

> 「host 模式启动 ubuntu2004 的容器，容器内安装 noetic 和 foxy，再使用 ros1bridge。结果是在主机中发布的 ros2 主题可以在容器中使用 `ros2 topic list` 显示，但是没有数据。应该是因为 tcp 端口占用的问题。」

尝试二：在 Docker 里装 hobot_dnn / bpu_infer_lib

> 「在 docker 中试图安装 `hobot_dnn` / `bpu_infer_lib`。然而 `hobot_dnn` 的动态库依赖特别繁杂，`bpu_infer_lib` 虽然可以使用 pip 安装，但仍然是动态库引用，仍然存在依赖问题。」

尝试三：pyinstaller 打包

> 「使用 pyinstaller 打包推理程序，仍然因为动态库依赖繁杂的原因导致打包的可执行程序无法正常运行。」

> 来源：社区帖 32802（https://forum.d-robotics.cc/t/topic/32802）

**这三条失败各自的原因**：

| 尝试 | 失败原因 |
| --- | --- |
| host 网络 + 双 ROS | DDS 端口/共享内存命名空间冲突，话题能发现但数据不通 |
| 容器内装 hobot_dnn | 动态库依赖链太长（BPU 驱动、libdnn、hobot 系列 so），无法在容器里凑齐 |
| pyinstaller 打包 | 同上，动态库不是纯 Python 依赖 |

官方给的回复是「设置 `ROS_DOMAIN_ID`，配置 DDS 使用共享内存和本地通信，在主机和容器中都添加相同的 DDS 配置文件」。
> 来源：社区帖 32802（https://forum.d-robotics.cc/t/topic/32802）

**最终成功的方案是第四条路——把桥接挪到另一台机器**：

> 「我找到了另一个解决方法：使用 2004 的 wsl 搭建 ros1bridge，让 rdk 与 wsl 在同一局域网下，wsl 和 rdk 的 ros2 使用统一 id 通信。wsl 运行 ros1 bridge。以 rdk docker 为 ros1 master，这样既把消息的通信部分的负载放到了 wsl，减少 rdk 的资源占用，又实现了相关功能。」
> 来源：社区帖 32802（https://forum.d-robotics.cc/t/topic/32802）

**这个方案值得推广**：桥接是个 CPU 密集 + 双环境依赖的活，放在板子上既抢资源又难凑依赖，放到局域网里另一台 Ubuntu 20.04 机器（物理机或 WSL）上，板子只负责出图/推理，职责清晰。

### 桥接方案的已知限制

| 限制 | 说明 | 规避 |
| --- | --- | --- |
| 图像话题带宽 | 未压缩图像过桥开销大，1080p@30 约 90 MB/s | 桥接前先压 JPEG，或降分辨率/帧率 |
| 自定义消息要手工映射 | 非标准 msg 需要写 mapping rule | 优先用 `sensor_msgs/Image` 等标准类型 |
| 只支持部分 Qos | ROS1 没有 QoS 概念，桥接时降级为默认 | 板端订阅端别用特殊 QoS |
| 一个终端只能 source 一个环境 | 桥接进程需要两个都 source | 用单独终端跑 bridge，业务节点分开 |
| 双向桥接会环路 | `--bridge-all-topics` 双向时可能自激 | 用 `--bridge-topic` 单向指定 |

**第一条是最容易被低估的**。桥接进程本身要序列化/反序列化，图像这种大消息过桥一次，CPU 开销可能比解码还高。所以官方 AMR 案例里桥接图像是为了**录 bag 做标定**（离线、不在乎实时性），不是为了在线跑算法。
> 来源：官方文档 Application_case/amr（https://developer.d-robotics.cc/rdk_x_doc/Application_case/amr）

### 交叉编译环境里的 ros1_bridge

交叉编译 TROS 时，`ros1_bridge` 会被显式忽略。社区贴出的交叉编译日志里能直接看到：

```
touch: cannot touch './src/tros/ros1_bridge/COLCON_IGNORE': No such file or directory
```

> 来源：社区帖 28795（https://forum.d-robotics.cc/t/topic/28795）

`COLCON_IGNORE` 是 colcon 的跳过标记——`build.sh` 主动给 `ros1_bridge` 打了这个标记，说明**官方的交叉编译流程不构建 ros1_bridge**。原因是交叉编译环境里没有 ROS1 的 arm64 库，编不出来。

**结论**：不要指望在交叉编译 Docker 里构建出能用的 `ros1_bridge`。要用就装 apt 包，或者自己在一台真正的 arm64 Ubuntu 20.04 + 22.04 双环境机器上编。

## 排障四段式

### 故障一：`Hobot_Codec has not received image for more than 5 seconds!`

**现象**：

```
[hobot_codec_republish-2] [ERROR] [hobot_codec_decoder]: Hobot_Codec has not received image for more than 5 seconds! Please check whether the image publisher still exists by 'ros2 topic info /image'!
[websocket-4] [ERROR] [websocket]: Websocket did not receive image data! Please check whether the image publisher still exists by 'ros2 topic info /image'!
[websocket-4] [ERROR] [websocket]: Websocket did not receive AI data! Please check whether the AI data publisher still exists by 'ros2 topic info hobot_dnn_detection'!
```

> 来源：社区帖 28537（https://forum.d-robotics.cc/t/topic/28537）

**根因**：这个话题的上游断了。可能是相机节点崩了（同一帖里 `hobot_usb_cam` 报了 `exit code -6`），也可能是 QoS 不匹配导致消息根本没发过来（见上一章的 QoS 一节）。

**处置**：按报错里给的命令自查，再往上游追：

```bash
ros2 topic list                    # /image 在不在
ros2 topic hz /image               # 有没有帧
ros2 node list                     # hobot_usb_cam 活着吗
```

如果 `ros2 node list` 里没有相机节点，问题在相机侧（见上一章）；如果有但 `hz` 为 0，查 QoS。

**预防**：`hobot_codec` 的这个 5 秒超时报错是**最可靠的链路探针**——它明确告诉你是哪一段断了。看到它先顺着报错里给的话题名往上游走，不要盲改参数。

### 故障二：编码器初始化尺寸不对

**现象**：编码出来的图像被裁切或有多余填充。

**根因**：硬件编码器要求宽高按 16 对齐。日志里的 `aline_w_: 16, aline_h_: 16` 就是这个约束。

```
[HobotVenc]: init_pic_w_: 1088, init_pic_h_: 2560, alined_pic_w_: 1088, alined_pic_h_: 2560, aline_w_: 16, aline_h_: 16
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

1088 = 68×16，2560 = 160×16，都能整除所以 `init` 和 `alined` 相同。如果输入是 1920×1080，1080 不是 16 的倍数（1080/16 = 67.5），对齐到 1088，多出 8 行。

**处置**：编码前把分辨率调整到 16 的倍数，或者解码回来时按原始高度裁掉填充行。

**预防**：设计分辨率时直接用 16 的倍数（640、960、1280、1920 宽度都行；高度用 480、544、720、1088 而不要用 1080）。

### 故障三：多路 RTSP 随机崩溃

**现象**：`component_container_isolated` 报 `exit code -11`，随机发生在某一路上。

> 来源：社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）

**根因**：VDEC 通道/吞吐资源不足（详见上文「多路崩溃」一节）。

**处置**：

```bash
# 降到 15fps 先验证
{'output_framerate': 15}

# 或者改回 h264
{'in_format': 'h264'}
```

**预防**：规划多路方案时，先按「单路解码资源 × 路数 ≤ 硬件上限」估算。1080p@30 的单路 H.265 约占 4K@60 能力的 1/8，理论上 6 路就接近满载，实际还要给 ISP/VSE/编码留余量。保守做法是控制在 3–4 路或降到 15fps。

### 故障四：`ros2: command not found`（桥接终端）

**现象**：

```
-bash: ros2: command not found
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

**根因**：跑桥接的那个终端只 source 了 ROS1，没 source ROS2；或者 source 顺序反了。

**处置**：

```bash
source /opt/ros/noetic/setup.bash      # 先 ROS1
source /opt/tros/humble/setup.bash     # 再 ROS2
```

**预防**：把顺序写进脚本，别每次手敲。或者在 `~/.bashrc` 末尾加一个函数：

```bash
bridge_env() {
  source /opt/ros/noetic/setup.bash
  source /opt/tros/humble/setup.bash
}
```

## 常见误区

**误区一：想在 X5 上原生装 Ubuntu 20.04 跑 ROS1。**
X5 只有 22.04，官方明确「X5 没有 20.04 系统支持，未来只会更新新版本系统」。现有 20.04 示例只适用于 X3/X3 Module/Ultra，刷错镜像会直接起不来。

**误区二：以为在 Docker 里装个 `hobot_dnn` 就能用 BPU。**
`hobot_dnn` 的动态库依赖链包括 BPU 驱动、libdnn、hobot 系列 so，不是 pip 能补齐的。社区实测三条路（容器内装库、`bpu_infer_lib`、pyinstaller 打包）全部失败。BPU 推理要留在宿主侧，容器只跑 ROS1 算法。

**误区三：把 `ros1_bridge` 装到板子上。**
`ros1_bridge` 需要同时 source ROS1 和 ROS2，而 X5 上没有 ROS1。而且官方交叉编译流程里 `ros1_bridge` 被显式打了 `COLCON_IGNORE`，说明官方也不构建它。正确做法是放到局域网里另一台 20.04 机器上。

**误区四：`in_format` 与摄像头实际输出格式不一致。**
`hobot_codec` 的 `in_format` 必须精确匹配上游实际发的格式。USB 摄像头出 MJPEG 就要写 `jpeg`；双目 mipi 出 bgr8 就要写 `bgr8`。写错不会报"格式不支持"，而是解出噪声或崩溃。判断方法：看上游节点的参数日志。

**误区五：多路 RTSP 只靠 `ROS_DOMAIN_ID` 隔离就算完事。**
`ROS_DOMAIN_ID` 只能隔离话题命名空间，隔离不了硬件资源。6 路 VDEC 抢同一个解码单元，`ROS_DOMAIN_ID` 再不同也照样崩。而且算法结果话题（`hobot_dnn_detection`）每路都要有独立发布者，只多开 `rtsp_client` 是不够的。

**误区六：把 `name='h264_decode'` 当成"解的是 H.264"。**
节点名与格式无关。同一份 launch 里 `name='h264_decode'` 配 `{'in_format': 'h265'}` 是常见写法，看名字判断格式必然出错，要看 `in_format` 参数。

**误区七：用 `ffplay` 能播就认为板子能解。**
PC 上 ffplay 是**软件解码**，容错能力极强，丢了 I 帧会自己等下一个。硬件解码器（VDEC）对码流规范性要求高得多。所以「PC 能播、板子崩溃」是常见组合，不是板子坏了。判据要用 `rtsp2display` 或 ROS 节点链在板子上实测。

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）、社区帖 28470（https://forum.d-robotics.cc/t/topic/28470）、社区帖 35041（https://forum.d-robotics.cc/t/topic/35041）、社区帖 32802（https://forum.d-robotics.cc/t/topic/32802）

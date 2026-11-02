---
id: 04-ROS2与TROS-02-图像采集与hobot_cv
volume: 4
volume_title: ROS2 与 TROS
title: 图像采集与 hobot_cv
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [mipi_cam, usb_cam, hobot_cv, 共享内存, QoS]
summary: mipi_cam / usb_cam 采集、hobot_cv 的 vse 加速 resize、共享内存零拷贝、话题 QoS（/hbmem_img 是 BestEffort）。
source_policy: "official-first, community-verified"
---
# 4.2 图像采集与 hobot_cv

## 本章解决什么

TROS 的图像链路不是「打开摄像头读帧」这么简单，它是一条被刻意拆开的流水线：**采集节点出图 → 编解码节点转格式/换承载方式 → 推理或显示节点消费**。每一段都规定了格式（`nv12`/`bgr8`/`jpeg`）和承载方式（`ros` 话题 / `shared_mem` 共享内存）。格式对不上会报编码器不支持，承载方式对不上会报 QoS 不兼容且一条消息都收不到。

本章讲清 `hobot_usb_cam`、`mipi_cam`、`hobot_image_publisher` 三个采集源怎么用，`hobot_cv` 的 VSE 硬件加速怎么用，`shared_mem` 零拷贝到底省掉了什么，以及话题/QoS 这一层最容易踩的坑。

## 4.2.1 整条图像链路的形状

标准链路（官方与社区示例里反复出现的形态）：

```
摄像头/文件
   ↓  hobot_usb_cam / mipi_cam / hobot_image_publisher
/image（ros 承载，jpeg 或 bgr8）
   ↓  hobot_codec（in_mode=ros, out_mode=shared_mem）
/hbmem_img（shared_mem 承载，nv12）
   ↓  dnn_node_example（is_shared_mem_sub=1）
/hobot_dnn_detection（推理结果）
   ↓  websocket
PC 浏览器 http://<板卡IP>:8000
```

从社区实测的完整 launch 日志可以直接看到这条链路的每一段参数：

```
[hobot_usb_cam-1]: process started with pid [27260]
[hobot_codec_republish-2]: process started with pid [27262]
[example-3]: process started with pid [27264]
[websocket-4]: process started with pid [27266]
[image_transport_node-5]: process started with pid [27268]
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
[example-3] [WARN] [dnn_example_node]: Parameter:
[example-3] feed_type(0:local, 1:sub): 1
[example-3] is_shared_mem_sub: 1
[example-3] ros_img_topic_name: /image
[example-3] sharedmem_img_topic_name: /hbmem_img
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

**读这段日志的方法**：`in_format` / `out_format` 决定编码器要干什么活；`in_mode` / `out_mode` 决定数据是走普通 DDS 话题还是走共享内存；订阅端必须**同时**匹配格式和承载方式，否则接收端拿到的要么是空、要么是解释错误。

### 4.2.1.1 三种承载模式的对照

| 模式 | 参数值 | 传输载体 | 适用 | 代价 |
| --- | --- | --- | --- | --- |
| ROS 普通话题 | `in_mode:=ros` / `out_mode:=ros` | DDS 序列化 | 跨机器、跨容器、调试 | 每帧一次序列化+拷贝，1080p nv12 单帧约 3 MB |
| 共享内存零拷贝 | `out_mode:=shared_mem` | `/dev/shm/fast_datasharing*` | 同机多节点、高帧率高分辨率 | 需要两端都支持 loaned messages |
| 硬件内存（hbmem） | 话题名 `/hbmem_img` | 板端专用内存池 | mipi_cam 直出到推理 | 需要 `hobot_shm` 环境变量配合 |

## 4.2.2 hobot_usb_cam

USB 摄像头驱动节点，输出 JPEG 或 YUYV 转出的图像。它的行为有两个特点必须知道：

**第一，它会把设备支持的格式全部打印出来。** 这是排查「为什么我设的 640×640 打不开」最有效的信息：

```
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: This devices supproted formats:
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Motion-JPEG: 1920 x 1080 (30 Hz)
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Motion-JPEG: 1280 x 720 (30 Hz)
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Motion-JPEG: 640 x 480 (30 Hz)
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: YUYV 4:2:2: 640 x 480 (10 Hz)
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Open & Init device /dev/video0 success.
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

同一个型号的摄像头，MJPG 能到 30 fps 的分辨率，换成 YUYV 往往只能到 10 fps——因为 UVC 带宽限制。**如果你需要 30 fps，就必须走 mjpeg**。

**第二，标定文件缺失的警告是正常的。**

```
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Camera calibration file: [/opt/tros/humble/lib/hobot_usb_cam/config/usb_camera_calibration.yaml] does not exist!
[hobot_usb_cam-1] If you need calibration msg, please make sure the calibration file path is correct and the calibration file exists!
```

> 来源：社区帖 28151（https://forum.d-robotics.cc/t/topic/28151）

官方 FAQ 对此的定性：「这个提示本身通常是正常的，不一定代表摄像头无法工作」，节点会「继续使用一组默认的或无标定的参数来运行」。什么时候必须补标定文件：「如果您的应用需要精确的图像测量、三维重建、或者需要对图像进行去畸变处理」；只做显示或像素无关的 AI 推理则可以不管。
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

### 4.2.2.1 常用参数

| 参数 | 含义 | 典型值 |
| --- | --- | --- |
| `video_device` | 设备节点 | `/dev/video0` |
| `pixel_format` | 像素格式 | `mjpeg` / `yuyv` |
| `framerate` | 帧率 | `30` |
| `usb_image_width` / `usb_image_height` | 出图分辨率 | `640` / `480` |
| `io_method` | 取流方式 | `mmap` |
| `calibration_file_path` | 标定文件路径 | 可指向自定义 yaml |

社区示例中的用法：

```python
# 在 launch 里引入 USB 摄像头
camera_node = IncludeLaunchDescription(
    PythonLaunchDescriptionSource(
        os.path.join(get_package_share_directory('hobot_usb_cam'),
                     'launch/hobot_usb_cam.launch.py')
    ),
    launch_arguments={
        'usb_image_width': '640',
        'usb_image_height': '480'
    }.items()
)
```

> 来源：社区帖 33330（https://forum.d-robotics.cc/t/topic/33330）

**分辨率必须从设备支持列表里选**。设一个设备不支持的分辨率，节点不会自动降级，而是打开失败或输出异常尺寸——社区里「设 640×640 设不上去」的问题就是这么来的，因为多数 USB 摄像头根本没有 640×640 这个模式。
> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

## 4.2.3 mipi_cam

MIPI 摄像头驱动。X5 的 MIPI 支持能力比 USB 强得多——直连 CSI，不占 USB 带宽，还能做双目同步采集。

### 4.2.3.1 单目与双目的区别

| 模式 | 关键参数 | 输出话题 |
| --- | --- | --- |
| 单目 | 默认（`device_mode` 不设或设 `single`） | `/image_raw` |
| 双目 | `device_mode:=dual` + `dual_combine:=2` | `/image_combine_raw`（左右拼接为一张） |

双目的启动命令（官方 AMR 案例里给的）：

```bash
source /opt/tros/humble/setup.bash
ros2 run mipi_cam mipi_cam --ros-args -p device_mode:="dual" -p out_format:="nv12" -p dual_combine:=2 -p framerate:=10.0 --log-level warn
```

> 来源：官方文档 Application_case/amr（https://developer.d-robotics.cc/rdk_x_doc/Application_case/amr）

`dual_combine:=2` 的含义是两路图像横向拼接成一张（宽 ×2）。社区实测 SC132GS 双目模组的拼接尺寸是 **1088 × 2560**，正好是两路 1088×1280 横拼：
> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

拼接后的图像在做标定或推理时，需要自己按宽度切一半取左/右目，注意 `step`（行跨度）也是双倍，不能直接用 `w*h*3/2` 算 nv12 尺寸。

### 4.2.3.2 launch 参数全表

从多个官方与社区示例里能归纳出的 `mipi_cam` 参数：

| 参数 | 含义 | 示例值 |
| --- | --- | --- |
| `mipi_image_width` / `mipi_image_height` | 出图分辨率 | `960` / `544`、`640` / `352`、`1280` / `640` |
| `mipi_out_format` | 输出格式 | `nv12` / `bgr8` |
| `mipi_io_method` | 承载方式 | `shared_mem` / `mmap` |
| `mipi_frame_ts_type` | 时间戳来源 | `sensor` / `realtime` |
| `mipi_video_device` | 模组型号 | `F37`、`SC132GS`、`imx219` |
| `mipi_image_framerate` | 帧率 | `30.0` |
| `mipi_lpwm_enable` | LPWM 触发使能 | `True` |
| `frame_id` | 坐标系名 | `pcl_link` |

官方巡线小车案例里的典型用法（输出 bgr8、非零拷贝）：

```bash
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
ros2 launch mipi_cam mipi_cam.launch.py mipi_out_format:=bgr8 mipi_io_method:=mmap
```

> 来源：官方文档 Application_case/line_follower（https://developer.d-robotics.cc/rdk_x_doc/Application_case/line_follower）

双目通道的官方/社区用法：

```bash
ros2 launch mipi_cam mipi_cam_dual_channel.launch.py \
  mipi_image_width:=1280 mipi_image_height:=640 \
  frame_id:=pcl_link \
  mipi_image_framerate:=30.0
```

> 来源：社区帖 28702（https://forum.d-robotics.cc/t/topic/28702）

**注意这里一个反直觉的地方**：`mipi_cam_dual_channel.launch.py` 里设 `mipi_image_width:=1280`，实际出图是 1280×640 的拼接图，也就是**每目 640×640**。参数写的是拼接后的宽高，不是单目宽高。

### 4.2.3.3 标定文件缺失的提示是中文的

```
[mipi_cam-1] [WARN] [mipi_cam]: cal_file:/opt/tros/humble/lib/mipi_cam/config/calib_params.yaml
[mipi_cam-1] 无法打开标定参数文件！
```

> 来源：社区帖 28778（https://forum.d-robotics.cc/t/topic/28778）

跟 USB 摄像头一样，这是警告不是错误，节点会继续用默认参数出图。需要 `camera_info` 话题里有真实内参时才需要补这个文件。

### 4.2.3.4 支持的 MIPI host

X5 板子上有多个 MIPI CSI 接口，启动日志会列出可用的 host：

```
[mipi_cam-1] [WARN] [mipi_cam]: this board support mipi:
[mipi_cam-1] [WARN] [mipi_cam]: host 0
[mipi_cam-1] [WARN] [mipi_cam]: host 2
[mipi_factory]: board_type X5_RDK
```

> 来源：社区帖 28778（https://forum.d-robotics.cc/t/topic/28778）

双目就是 host 0 + host 2 各接一路。接错口（比如把第二路接到 host 1）会导致只出一目。

## 4.2.4 hobot_image_publisher

不吃摄像头，读本地图片/视频按 ROS 消息发布。用途有两个：**没有硬件时验证算法链路**，以及**回灌测试**。

| 参数 | 含义 |
| --- | --- |
| `publish_message_topic_name` | 发布到哪个话题 |
| `publish_is_shared_mem` | 是否走共享内存（`True`/`False`） |
| `publish_is_compressed_img_pub` | 是否以压缩图像发布 |
| `image_source` | 源文件路径（图片或视频） |
| `publish_rate` | 发布帧率 |

社区示例中的用法（作为 `camera_type == "fb"` 分支出现，`fb` = feedback 回灌）：

```python
camera_node = IncludeLaunchDescription(
    PythonLaunchDescriptionSource(
        os.path.join(get_package_share_directory('hobot_image_publisher'),
                     'launch/hobot_image_publisher.launch.py')
    ),
    launch_arguments={
        'publish_message_topic_name': '/image',
        'publish_is_shared_mem': 'False',
        'publish_is_compressed_img_pub': 'True'
    }.items()
)
```

> 来源：社区帖 33330（https://forum.d-robotics.cc/t/topic/33330）

官方发布记录里能看到这个包的演进：「新增 `hobot_image_publisher` h265 编码测试视频」「新增 `hobot_image_publisher` MP4/H264/H265 视频发布」——也就是说它支持的不只是静态图，H264/H265/MP4 视频文件也能按帧发布出来。
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

**它的一个实用价值**：把「模型是否正常」和「相机链路是否正常」这两件事分开。`dnn_node_example` 有 `feed_type` 参数——`feed_type:=0` 表示读本地图片，`feed_type:=1` 表示订阅话题。模型出问题时先用 `feed_type:=0` + 本地图片排除相机因素。

## 4.2.5 hobot_cv：VSE 硬件加速

`hobot_cv` 是图像处理的硬件加速库，把 resize、crop 这类操作从 CPU 挪到 VSE（Video Scale Engine）硬件单元。官方功能包总表里的描述是：

> 「`hobot_cv` 图像处理加速：resize（全系）、crop（X3 / X5）、高斯 / 均值滤波（X3）等」
> 来源：社区帖 35812（https://forum.d-robotics.cc/t/topic/35812）

注意括号里的平台限制：**滤波类加速只有 X3 有，X5 上只有 resize 和 crop**。

### 4.2.5.1 能力演进（从官方发布记录）

| TROS 版本 | `hobot_cv` 变更 |
| --- | --- |
| V1.0.3 | 新增 crop / resize / rotate 接口 |
| V1.0.4 | 支持 pyramid 输出 |
| V1.0.5 | 新增 neon 加速滤波功能 |
| V1.1.3 | 新增图片 padding 与 nv12 处理 |
| V1.1.4 | 新增 `hobot_cv` benchmark 工具 |
| V2.4.x（RDKOS 3.4.1） | **修复使用 vse 加速图像 resize 的 bug** |

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

### 4.2.5.2 版本分界线：vse resize bug

这是本章最需要记住的一条版本事实。RDKOS 3.4.1 的发布说明写的是：

> 「修复图像处理加速模块：`hobot_cv` 使用 vse 加速图像 resize 的 bug。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

同一条在 RDK 总览页的写法是「`hobot_cv` 修复：修复了图像处理加速模块使用 VSE 硬件加速图像 Resize 时可能出现的 Bug。」
> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）

**所以**：RDKOS **3.4.1 之前**（3.3.3 及更早）的板子，用 `hobot_cv` 做 VSE resize 可能得到错误结果——不是崩溃，是**算出来的图不对**。这种 bug 最难查，因为不报错。判断与处置：

```bash
# 先确认系统版本
cat /etc/version
# 3.4.1 及以上：无此问题
# 3.3.3 及以下：升级后再依赖 vse resize
sudo apt update && sudo apt upgrade
```

如果你在 3.3.3 上必须用 resize 且结果异常，绕过办法是**在采集端直接出目标分辨率**（`mipi_image_width` / `usb_image_width` 设成模型输入尺寸），不经过二次缩放。代价是放弃 VSE 的裁剪自由度。

### 4.2.5.3 VSE 是怎么工作的

从 VSE 的日志能直接读出它对每一路通道做了什么。以 `vio2encoder` 示例的初始化日志为例：

```
[CamInitParam][0326]Setting VSE channel-0: input_width:1920, input_height:1080, dst_w:1920, dst_h:1080
[CamInitParam][0326]Setting VSE channel-1: input_width:1920, input_height:1080, dst_w:1920, dst_h:1080
```

> 来源：官方文档 Basic_Application/cdev_demo_sample/vio2encoder（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/vio2encoder）

`input_width/input_height` 是 CSI 进来的原始尺寸，`dst_w/dst_h` 是 VSE 输出尺寸。当两者相等时是直通，不等时就是硬件缩放。**VSE 通道是有限资源**，同时开多路会抢，这也是多路 RTSP 场景下容易崩的原因之一。

VSE 支持 crop（裁剪）后缩放，对应的 Python 示例参数是：

```bash
python 04_mipi_camera_crop_scale.py -i input.yuv -o output_640x480.yuv \
  -w 640 -h 480 --iwidth 1920 --iheight 1080 \
  -x 304 -y 304 --crop_w 896 --crop_h 592
```

> 来源：官方文档 Basic_Application/vision/RDK_X5/mipi_camera（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/vision/RDK_X5/mipi_camera）

这里 `-x 304 -y 304` 是裁剪起点，`--crop_w 896 --crop_h 592` 是裁剪尺寸，`-w 640 -h 480` 是缩放目标。裁剪加缩放在一次 VSE 调用里完成，这是软件实现做不到的。

## 4.2.6 shared_mem 零拷贝

### 4.2.6.1 零拷贝到底省了什么

默认情况下，ROS2 发布一帧图像要经历：用户缓冲 → DDS 序列化 → 共享内存/网络 → 反序列化 → 订阅方缓冲。1080p 的 nv12 单帧约 3 MB，30 fps 就是 90 MB/s 的纯拷贝开销，全压在 CPU 上。

零拷贝的做法是：发布方**直接在共享内存里构造消息**，订阅方**拿到同一块内存的引用**，全程零次数据拷贝。ROS2 管这个叫 loaned messages（借贷消息）。

### 4.2.6.2 环境变量四件套

```bash
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
export FASTRTPS_DEFAULT_PROFILES_FILE=/opt/tros/humble/lib/hobot_shm/config/shm_fastdds.xml
export RMW_FASTRTPS_USE_QOS_FROM_XML=1
export ROS_DISABLE_LOANED_MESSAGES=0
```

> 来源：官方文档 FAQ/applications_and_examples（https://developer.d-robotics.cc/rdk_x_doc/FAQ/applications_and_examples）

四个变量的分工：

| 变量 | 作用 | 漏设的后果 |
| --- | --- | --- |
| `RMW_IMPLEMENTATION` | 选 Fast DDS | 用 CycloneDDS 时共享内存传输不可用 |
| `FASTRTPS_DEFAULT_PROFILES_FILE` | 指向启用了 SHM 的 XML | Fast DDS 不认识共享内存段 |
| `RMW_FASTRTPS_USE_QOS_FROM_XML` | 强制从 XML 读 QoS | 代码里的 QoS 覆盖 XML，SHM 不生效 |
| `ROS_DISABLE_LOANED_MESSAGES=0` | 允许借贷消息 | 默认是 1（禁用），零拷贝退化为普通拷贝 |

**第三行是最容易漏的**。社区里这个报错就是典型：

```
Launching with zero-copy, but env of `RMW_FASTRTPS_USE_QOS_FROM_XML` is not set. Transporting data without zero-copy!
[rclcpp]: Currently used middleware can't loan messages. Local allocator will be used.
```

> 来源：社区帖 28783（https://forum.d-robotics.cc/t/topic/28783）

注意这个提示是**警告级别**，程序继续跑、图也出得来，只是走了拷贝路径。所以「零拷贝没生效」在功能上完全无感，只在性能指标上体现——这是它最容易被忽略的原因。

而 `mipi_cam`、`hobot_codec` 这类官方节点的 launch 文件里会自动打印：

```
Hobot shm pkg enables zero-copy with fastrtps profiles file: /opt/tros/humble/lib/hobot_shm/config/shm_fastdds.xml
Hobot shm pkg sets RMW_FASTRTPS_USE_QOS_FROM_XML: 1
env of RMW_FASTRTPS_USE_QOS_FROM_XML is 1 , ignore env setting
```

> 来源：社区帖 28778（https://forum.d-robotics.cc/t/topic/28778）

`env of ... is 1 , ignore env setting` 的意思是**环境变量已经由节点自己设好了，你手动 export 的版本被忽略**。所以引入了 `hobot_shm` 的 launch 不需要你手动 export，自己写的节点才需要。

### 4.2.6.3 怎么验证零拷贝真的生效

```bash
# 看共享内存文件是否存在（大小应与单帧数据量同量级）
ls -lthr /dev/shm/fast_datasharing* /dev/shm/fastrtps_*

# 看哪些进程在用
sudo lsof /dev/shm/fast_datasharing*
```

官方给的成功判据：「如果看到有类似 `fast_datasharing_...` 的文件被创建，并且文件大小与传输的数据（如图像帧大小）相关，则表明共享内存传输可能已启用」；`lsof` 的输出里应该能看到你的发布者和订阅者进程。
> 来源：官方文档 FAQ/applications_and_examples（https://developer.d-robotics.cc/rdk_x_doc/FAQ/applications_and_examples）

### 4.2.6.4 在 launch 里引入零拷贝

```python
# ------------------- Shared Memory -------------------
shared_mem_node = IncludeLaunchDescription(
    PythonLaunchDescriptionSource(
        os.path.join(get_package_share_directory('hobot_shm'),
                     'launch/hobot_shm.launch.py')
    )
)

return LaunchDescription([
    shared_mem_node,   # 必须放在最前面
    camera_node,
    nv12_codec_node,
    emo_node,
    web_node
])
```

> 来源：社区帖 33330（https://forum.d-robotics.cc/t/topic/33330）

顺序有讲究：`hobot_shm` 是设置环境变量的「配置节点」，必须**先于**所有要共享内存的节点启动，否则那些节点读到的是默认值。

### 4.2.6.5 禁用零拷贝

调试或兼容性问题时要关掉：

```bash
export ROS_DISABLE_LOANED_MESSAGES=1
```

官方说明这个变量「具有最高优先级」。
> 来源：官方文档 FAQ/applications_and_examples（https://developer.d-robotics.cc/rdk_x_doc/FAQ/applications_and_examples）

什么时候该关：订阅端代码用的不是 `const ref` 回调时。日志里会直接告警：

```
[example-3] [WARN] [dnn_example_node]: Loaned messages are only safe with const ref subscription callbacks.
If you are using any other kind of subscriptions, set the ROS_DISABLE_LOANED_MESSAGES environment variable to 1 (the default).
```

> 来源：社区帖 28151（https://forum.d-robotics.cc/t/topic/28151）

## 4.2.7 话题与 QoS

### 4.2.7.1 核心话题表

| 话题 | 承载 | 典型格式 | 生产者 | 消费者 |
| --- | --- | --- | --- | --- |
| `/image` | ros | jpeg / bgr8 / nv12 | usb_cam、image_publisher、codec | codec、websocket、自定义节点 |
| `/hbmem_img` | shared_mem | nv12 | codec（`out_mode:=shared_mem`） | dnn_node_example（`is_shared_mem_sub:=1`） |
| `/image_raw` | ros | nv12 / bgr8 | mipi_cam 单目 | 通用 |
| `/image_raw/compressed` | ros | jpeg | usb_cam（压缩发布） | codec、websocket |
| `/image_combine_raw` | ros | bgr8 / nv12 | mipi_cam 双目（`dual_combine:=2`） | 标定脚本、stereonet |
| `/image_jpeg` | ros | jpeg | codec（编码方向） | websocket |
| `/hobot_dnn_detection` | ros | 自定义 msg | dnn_node | websocket、业务节点 |
| `/hobot_dnn_detection_info` | ros | 自定义 msg | dnn_node | 调试用 |

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）、社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）、社区帖 33330（https://forum.d-robotics.cc/t/topic/33330）

### 4.2.7.2 QoS 不兼容：一条消息都收不到

这是本章最高频的故障，报错原文：

```
[hobot_codec_republish-2] [WARN] [hobot_codec_decoder]: New subscription discovered on topic '/hbmem_img', requesting incompatible QoS. No messages will be sent to it. Last incompatible policy: RELIABILITY_QOS_POLICY
[image_transport_node-5] [WARN] [Nv122BGR]: New publisher discovered on topic '/hbmem_img', offering incompatible QoS. No messages will be sent to it. Last incompatible policy: RELIABILITY_QOS_POLICY
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

**怎么读这句话**：`New subscription discovered` 是从发布方视角说的——「发现有人来订阅了，但他的 QoS 跟我不兼容，所以我一条都不会发给他」。`Last incompatible policy: RELIABILITY_QOS_POLICY` 指明不兼容的维度是**可靠性**。

`/hbmem_img` 这个话题的发布者（`hobot_codec` 的 shared_mem 模式）用的是 `BestEffort`，因为共享内存图像是「最新帧有效」，丢帧比阻塞重要。如果你的订阅端用了默认的 `Reliable`，就永远匹配不上。

**根因**：ROS2 的 QoS 兼容规则是「发布者必须提供至少与订阅者要求同等的保证」。`Reliable` 订阅者要求重传，而 `BestEffort` 发布者不提供，所以不兼容。反过来 `BestEffort` 订阅者订阅 `Reliable` 发布者是兼容的。

**处置**（C++ 订阅端）：

```cpp
// 匹配发布者的 BestEffort 策略
rclcpp::QoS img_qos(10);
img_qos.reliability(rclcpp::ReliabilityPolicy::BestEffort);

subscriber_hbmem_ = this->create_subscription<...>(
    sub_img_topic_,
    img_qos,
    std::bind(&TrackDetectionNode::subscription_callback, this, std::placeholders::_1)
);
```

> 来源：社区帖 31265（https://forum.d-robotics.cc/t/topic/31265）

**处置**（Python 订阅端）：

```python
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, QoSDurabilityPolicy

qos_profile = QoSProfile(
    depth=10,
    reliability=ReliabilityPolicy.BEST_EFFORT,   # 图像数据建议用 BEST_EFFORT
    history=HistoryPolicy.KEEP_LAST,
    durability=QoSDurabilityPolicy.VOLATILE
)
```

> 来源：社区帖 35110（https://forum.d-robotics.cc/t/topic/35110）

**另一条路**：不订阅 `/hbmem_img`，改成让 codec 输出到普通话题（`out_mode:=ros`），然后用默认 QoS。代价是丢掉零拷贝的性能收益。

### 4.2.7.3 QoS 之外：`ros2 topic hz` 确认链路

QoS 匹配上了但没数据是另一回事。标准排查三步：

```bash
ros2 topic list                        # 话题在不在
ros2 topic hz /hbmem_img               # 有没有帧率
ros2 topic info /hbmem_img --verbose   # 看发布/订阅的 QoS 是否兼容
```

`ros2 topic info --verbose` 会打印 publisher 和 subscription 各自的 QoS 配置，直接对比 `Reliability` 那一行就能确认。官方 FAQ 也给了同样的自查手段（用 `ros2 topic list` / `hz` / `echo` 验证摄像头是否在发数据）。
> 来源：官方文档 FAQ/tros_ros（https://developer.d-robotics.cc/rdk_x_doc/FAQ/tros_ros）

### 4.2.7.4 大图像传输失败时的 DDS 切换

如果问题不在 QoS 而在带宽/分片，官方给的方案是换 DDS：

> 「更换 DDS 实现：尝试将 ROS2 的 RMW 实现从默认的 `rmw_fastrtps_cpp` 切换到 `rmw_cyclonedds_cpp`。CycloneDDS 在处理大数据包和网络分片方面有时表现更优。」
> 来源：官方文档 FAQ/applications_and_examples（https://developer.d-robotics.cc/rdk_x_doc/FAQ/applications_and_examples）

```bash
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
```

注意这与零拷贝是**互斥**的：零拷贝依赖 Fast DDS 的 SHM 特性，切到 CycloneDDS 就没零拷贝了。所以顺序是：先修 QoS，QoS 没问题再考虑换 DDS。

## 4.2.8 排障：采集端故障四段式

### 4.2.8.1 故障一：分辨率设不上

**现象**：

```
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Try to open device [/dev/video0]
[hobot_usb_cam-1] [WARN] [hobot_usb_cam]: Open & Init device /dev/video0 success.
```
节点起来了，但出的图尺寸与设置不符，或下游推理报尺寸不匹配崩溃。

**根因**：`usb_image_width` / `usb_image_height` 设的是设备不支持的模式。UVC 设备不会自动回退到最近可用分辨率，而是用驱动默认值或直接失败。

**处置**：先看节点启动时打印的支持列表，从里面选：

```bash
# 也可以直接用 v4l2 查
v4l2-ctl --device /dev/video0 --list-formats-ext
```

**预防**：把「设备支持列表」当成选分辨率的唯一依据，不要按模型输入尺寸反推相机参数。模型要 640×640 就选一个接近的支持模式（如 640×480），让 `hobot_codec` 或 `hobot_cv` 去做缩放。

### 4.2.8.2 故障二：双目只出一目

**现象**：`device_mode:=dual` 启动了，但只有一路图像，或拼接图只有一半有效。

**根因**：两路 MIPI 必须接在 host 0 和 host 2。接错口（例如接到 host 1）时驱动找不到第二路 sensor，静默降级为单路。

**处置**：

```bash
# 确认两路的 I2C 上都能扫到 sensor
i2cdetect -y -r 4
i2cdetect -y -r 6
```

官方 AMR 案例里双目模组的 I2C 扫描结果就是在两路总线上分别看到 `0x32`、`0x30` 等地址。
> 来源：官方文档 Application_case/amr（https://developer.d-robotics.cc/rdk_x_doc/Application_case/amr）

**预防**：接线前对照板子的 MIPI 接口丝印确认是 CSI0/CSI2，不要按物理位置相邻来推断。

### 4.2.8.3 故障三：8000 端口打不开

**现象**：跑完 `ros2 run mipi_cam mipi_cam` 后访问 `http://192.168.127.10:8000` 打不开。

**根因**：8000 端口不属于 `mipi_cam`。它是 `websocket` 节点内置的 nginx。只跑采集节点时 8000 上根本没有进程监听。

社区的定位非常准确：「8000 这个页面不是 `mipi_cam` 提供的。`mipi_cam` 只往 ROS 话题发图，8000 端口上的 Web 服务由 `websocket` 节点（内含 nginx）起，而且它只渲染 JPEG 话题，中间还要一个 `hobot_codec` 做编码。」
> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

**处置**：补上 codec 和 websocket 两个节点：

```bash
# 终端 A：采集
source /opt/tros/humble/setup.bash
ros2 run mipi_cam mipi_cam --ros-args -p device_mode:="dual" -p out_format:="bgr8" -p dual_combine:=2 -p framerate:=10.0 -p gdc_enable:=false

# 终端 B：编码（bgr8 → jpeg）
source /opt/tros/humble/setup.bash
ros2 launch hobot_codec hobot_codec.launch.py codec_in_mode:=ros codec_in_format:=bgr8 \
  codec_out_mode:=ros codec_out_format:=jpeg \
  codec_sub_topic:=/image_combine_raw codec_pub_topic:=/image_jpeg

# 终端 C：Web 展示
source /opt/tros/humble/setup.bash
ros2 launch websocket websocket.launch.py websocket_image_topic:=/image_jpeg websocket_only_show_image:=true
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

成功时终端 B 会打印编码器初始化尺寸和帧率：

```
[hobot_codec_republish-1] [WARN] [HobotVenc]: init_pic_w_: 1088, init_pic_h_: 2560, alined_pic_w_: 1088, alined_pic_h_: 2560, aline_w_: 16, aline_h_: 16
[hobot_codec_republish-1] [WARN] [hobot_codec_2bf5b169]: Pub img fps [32.73]
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

**预防**：记住三段式 `mipi_cam → hobot_codec → websocket`，缺任何一段 8000 都没画面。官方 SC132GS 模组的做法是把三段合进一个 launch：`ros2 launch mipi_cam mipi_cam_dual_channel_websocket.launch.py`。

### 4.2.8.4 故障四：`ros2: command not found`

**现象**：

```
-bash: ros2: command not found
```

**根因**：新开的终端没 source 环境。每个终端会话独立，`~/.bashrc` 里没写就每次都要手动 source。

**处置**：

```bash
source /opt/tros/humble/setup.bash
# 或写进 bashrc 免得每次来一遍
echo "source /opt/tros/humble/setup.bash" >> ~/.bashrc
```

> 来源：社区帖 35802（https://forum.d-robotics.cc/t/topic/35802）

**预防**：这条几乎没有技术含量，但社区里出现频率极高。所有「命令找不到 / 包找不到」类问题的第一步都是确认 `printenv | grep -i ros` 有输出。

## 常见误区

**误区一：以为 `shared_mem` 加上就一定零拷贝。**
`out_mode:=shared_mem` 只是让节点往共享内存写，订阅端如果 QoS 不匹配或没开 loaned messages，照样走拷贝路径。真正的判据是 `ls /dev/shm/fast_datasharing*` 有文件、`lsof` 能看到两端进程。而且这个退化的提示只是 WARN，功能上完全无感。

**误区二：把 `/image` 和 `/hbmem_img` 当成同一个东西的两个名字。**
它们是两种承载方式，QoS 策略不同（`/hbmem_img` 是 BestEffort），格式也不同（`/hbmem_img` 固定 nv12）。订阅 `/hbmem_img` 却在代码里按 jpeg 解，会得到满屏噪声而不是报错。

**误区三：「标定文件不存在」当成故障去修。**
`Camera calibration file ... does not exist!` 和 `无法打开标定参数文件！` 都是警告。只有需要 `camera_info`（去畸变、测距、三维重建）时才必须补。花时间追这个警告，往往是因为真正的问题（QoS 或格式）藏在后面几行日志里。

**误区四：在 3.3.3 及更早系统上依赖 VSE resize。**
`hobot_cv` 的 vse resize bug 是 RDKOS 3.4.1 才修的。老系统上这个 bug 表现是**结果图像错误而不是报错**，会让人误以为是模型或标定问题。要么升系统，要么在采集端直接出目标尺寸绕过缩放。

**误区五：以为 8000 端口是摄像头节点开的。**
8000 是 `websocket` 包里的 nginx。只跑 `mipi_cam` 时 8000 上没进程。而且 websocket 只吃 JPEG 话题，中间必须有 `hobot_codec` 做编码——`bgr8` 直接喂给 websocket，页面能连上但解不出画面。

**误区六：看到 `env of RMW_FASTRTPS_USE_QOS_FROM_XML is 1 , ignore env setting` 以为是报错。**
这句话的意思是「节点自己已经把这个变量设成 1 了，你手动 export 的值被忽略」，是正常行为。引入 `hobot_shm` 的官方 launch 都会打这行。只有自己写节点时才需要手动 export 四件套。

> 来源：官方文档 FAQ/applications_and_examples（https://developer.d-robotics.cc/rdk_x_doc/FAQ/applications_and_examples）、官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

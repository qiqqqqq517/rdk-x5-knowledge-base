---
id: 04-ROS2与TROS-03-dnn_node模型推理节点
volume: 4
volume_title: ROS2 与 TROS
title: dnn_node 模型推理节点
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [dnn_node, hobot_dnn, exit code -11, 后处理, parser]
summary: dnn_node_example 完整用法、模型输入输出配置、后处理、以及 exit code -11 的完整根因链（bbox 输出 F32 与 parser 按 int32 读取的不匹配）。
source_policy: "official-first, community-verified"
---
# 4.3 dnn_node 模型推理节点

## 本章解决什么

`dnn_node` 是 TROS 里把 BPU 推理包成 ROS2 节点的那一层，`dnn_node_example` 是它的完整可运行示例。社区里绝大多数「模型量化成功了，但板端跑不起来」的问题，最后都落在这两个包的配置文件上——不是模型的问题，是 `dnn_node` 的解析器对**输出张量的数量、顺序、数据类型、layout** 有硬性期望，对不上就是 `exit code -11`（段错误）。

本章讲清 `dnn_node_example` 的完整用法、JSON 配置的每个字段、后处理解析器的分类、推理延迟统计怎么读、自定义模型怎么接，以及 Python/C++ 两套接口的边界。

## 4.3.1 架构：dnn_node 与 dnn_node_example

| 包 | 角色 | 内容 |
| --- | --- | --- |
| `tros-humble-dnn-node` | **框架库**，无独立进程 | `DnnNode` 基类、`DnnNodeOutput`、各模型 output parser |
| `tros-humble-dnn-node-example` | **示例可执行**，进程名 `example` | 演示继承 `DnnNode` 的完整实现 |
| `tros-humble-dnn-node-sample` | 更小的示例 | 只演示必要接口 |

`example` 这个可执行文件在 `/opt/tros/humble/lib/dnn_node_example/example`。启动一个节点时的完整命令行（从 launch 报错里能原样读到）：

```
/opt/tros/humble/lib/dnn_node_example/example --ros-args --log-level info --ros-args --params-file /tmp/launch_params_xxx --params-file /tmp/launch_params_yyy
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

### 4.3.1.1 继承 DnnNode 必须实现的三个接口

官方巡线案例里给了最小清单：

> 「继承 DnnNode 实现必要的接口。这里采用公有继承方式，其中必须要实现的接口为：`SetNodePara()` 用于配置模型参数，如模型路径、模型名字等；`SetOutputParser()` 用于解析模型推理输出；`PostProcess(const std::shared_ptr<DnnNodeOutput> &outputs)` 用于对后处理结果进一步进行使用。」
> 来源：官方文档 Application_case/line_follower（https://developer.d-robotics.cc/rdk_x_doc/Application_case/line_follower）

三个接口的分工：

| 接口 | 干什么 | 典型实现 |
| --- | --- | --- |
| `SetNodePara()` | 从 ROS 参数读模型路径、任务数、模型名 | `model_file_name_`、`task_num_` |
| `SetOutputParser()` | 按 `dnn_parser` 字段 new 出对应的 parser | `yolov8` → `PtqYolo8OutputParser` |
| `PostProcess()` | 把 parser 输出的检测框转成自定义 msg 发出去 | 填 `hobot_dnn_detection` |

## 4.3.2 dnn_node_example 完整用法

### 4.3.2.1 两种 launch：订阅 vs 回灌

| launch 文件 | 用途 | 输入来源 |
| --- | --- | --- |
| `dnn_node_example.launch.py` | 完整链路（相机 + 编码 + 推理 + Web） | 相机话题 |
| `dnn_node_example_feedback.launch.py` | 单图回灌（不接相机） | 本地 jpg |

回灌模式的典型命令：

```bash
source /opt/tros/humble/setup.bash
ros2 launch dnn_node_example dnn_node_example_feedback.launch.py \
  dnn_example_config_file:=my_config/yolov8workconfig.json \
  dnn_example_image:=my_config/target.jpg
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

完整链路模式：

```bash
export CAM_TYPE=usb          # 或 mipi
ros2 launch dnn_node_example dnn_node_example.launch.py \
  dnn_example_config_file:=config/yolov11.json
```

> 来源：社区帖 28151（https://forum.d-robotics.cc/t/topic/28151）

### 4.3.2.2 参数全表

启动日志会把所有参数打出来，这是最可靠的参数清单来源：

```
[example-3] [WARN] [dnn_example_node]: Parameter:
[example-3] feed_type(0:local, 1:sub): 1
[example-3] image: config/test.jpg
[example-3] image_type: 0
[example-3] dump_render_img: 0
[example-3] is_shared_mem_sub: 1
[example-3] config_file: config/yolov11.json
[example-3] msg_pub_topic_name: hobot_dnn_detection
[example-3] info_msg_pub_topic_name: hobot_dnn_detection_info
[example-3] ros_img_topic_name: /image
[example-3] sharedmem_img_topic_name: /hbmem_img
```

> 来源：社区帖 28151（https://forum.d-robotics.cc/t/topic/28151）

| 参数 | 类型 | 含义 | 取值影响 |
| --- | --- | --- | --- |
| `feed_type` | int | 输入来源 | `0`=本地图片，`1`=订阅话题 |
| `image` | string | `feed_type=0` 时的图片路径 | 相对路径基于工作目录 |
| `image_type` | int | 图像格式标识 | `0` 为 jpg |
| `dump_render_img` | int | 是否落盘渲染结果 | `1` 会写 `render.jpg` |
| `is_shared_mem_sub` | int | 是否订阅共享内存话题 | `1` 订阅 `/hbmem_img`，`0` 订阅 `/image` |
| `config_file` | string | JSON 模型配置路径 | 决定模型与解析器 |
| `msg_pub_topic_name` | string | 检测结果话题名 | 默认 `hobot_dnn_detection` |
| `info_msg_pub_topic_name` | string | 带性能信息的附加话题 | 默认 `hobot_dnn_detection_info` |
| `ros_img_topic_name` | string | 订阅普通图像的话题 | 默认 `/image` |
| `sharedmem_img_topic_name` | string | 订阅共享内存图像的话题 | 默认 `/hbmem_img` |

**`is_shared_mem_sub` 与 codec 的 `out_mode` 必须配对**：codec 输出 `shared_mem` 就设 `1`，输出 `ros` 就设 `0`。配错的表现不是报错，而是「节点起来了但一直收不到图」，或者到了 QoS 不兼容的 WARN。

### 4.3.2.3 运行时日志怎么读

一次成功的加载会依次打印这些：

```
[example-1] [WARN] [dnn_example_node]: Load [80] class types from file [config/coco.list]
[example-1] [WARN] [dnn_example_node]: Parameter:
[example-1] model_file_name: /opt/tros/humble/yolo11m_detect_bayese_640x640_nv12.bin
[example-1] [INFO] [dnn]: Node init.
[example-1] [INFO] [dnn]: Model init.
[example-1] [BPU_PLAT]BPU Platform Version(1.3.6)! soc info(x5)
[example-1] [HBRT] set log level as 0. version = 3.15.55.0
[example-1] [DNN] Runtime version = 1.24.5_(3.15.55 HBRT)
[example-1] [A][DNN][packed_model.cpp:247] Model [HorizonRT] The model builder version = 1.24.3
[example-1] [INFO] [dnn]: The model input 0 width is 640 and height is 640
[example-1] Model Info:
[example-1] name: yolov8_cow.
[example-1] [input]
[example-1] - (0) Layout: NCHW, Shape: [1, 3, 640, 640], Type: HB_DNN_IMG_TYPE_NV12.
[example-1] [output]
[example-1] - (0) Layout: NHWC, Shape: [1, 80, 80, 5], Type: HB_DNN_TENSOR_TYPE_F32.
[example-1] - (1) Layout: NHWC, Shape: [1, 80, 80, 64], Type: HB_DNN_TENSOR_TYPE_F32.
[example-1] - (2) Layout: NHWC, Shape: [1, 40, 40, 5], Type: HB_DNN_TENSOR_TYPE_F32.
[example-1] - (3) Layout: NHWC, Shape: [1, 40, 40, 64], Type: HB_DNN_TENSOR_TYPE_F32.
[example-1] - (4) Layout: NHWC, Shape: [1, 20, 20, 5], Type: HB_DNN_TENSOR_TYPE_F32.
[example-1] - (5) Layout: NHWC, Shape: [1, 20, 20, 64], Type: HB_DNN_TENSOR_TYPE_F32.
[example-1] [INFO] [dnn]: Task init.
[example-1] [INFO] [dnn]: Set task_num [4]
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

**这段日志是本卷最重要的一段。** 它把模型的真实输入输出全部摊开：`[output]` 的每一项都写明 layout、shape、type。后面所有 `exit code -11` 的根因都能从这 6 行里读出来。

### 4.3.2.4 Model Info 的三个字段决定一切

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `Layout` | `NCHW` / `NHWC` | 张量维度顺序，parser 按固定 layout 取值 |
| `Shape` | `[1, 80, 80, 5]` | 维度尺寸，第一维是 batch |
| `Type` | `HB_DNN_TENSOR_TYPE_F32` / `..._S32` / `HB_DNN_IMG_TYPE_NV12` | 元素类型，决定用 `float*` 还是 `int32_t*` 读 |

`Type` 这一项是社区里最长的那个帖（34784，18 个回复）的全部内容。**YOLOv8 的 bbox 分支如果编译出来是 F32，而 parser 按 S32 去读，就是段错误。**

## 4.3.3 JSON 配置详解

`dnn_node` 的模型配置是一个 JSON 文件，字段按模型族不同而不同。以社区里最常见的 YOLOv8 为例：

```json
{
  "model_file": "/home/sunrise/yolov8/cow.bin",
  "task_num": 4,
  "dnn_parser": "yolov8",
  "model_output_count": 6,
  "reg_max": 16,
  "class_num": 5,
  "cls_names_list": "my_config/cow.list",
  "strides": [8, 16, 32],
  "score_threshold": 0.25,
  "nms_threshold": 0.7,
  "nms_top_k": 300,
  "output_order": [0, 1, 2, 3, 4, 5]
}
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

### 4.3.3.1 字段说明

| 字段 | 必填 | 含义 | 配错的表现 |
| --- | --- | --- | --- |
| `model_file` | 是 | `.bin` 绝对路径 | 找不到文件直接退出 |
| `task_num` | 是 | 并发推理任务数，常设 4 | 设 1 会明显掉帧率 |
| `dnn_parser` | 是 | 解析器名 | 名字错报 `Invalid parser` |
| `model_output_count` | 是 | 模型输出张量个数 | 与模型不符会越界读 |
| `reg_max` | YOLO 系 | DFL 回归上限 | YOLO26 用 `1`，其他用 `16` |
| `class_num` | 是 | 类别数 | 必须与训练时一致 |
| `cls_names_list` | 是 | 类别名文件（每行一个） | 缺失导致 label 显示异常 |
| `strides` | YOLO 系 | 三个特征图下采样倍数 | 固定 `[8, 16, 32]` |
| `score_threshold` | 是 | 置信度阈值 | 过高漏检，过低误检 |
| `nms_threshold` | 是 | NMS IoU 阈值 | 过高重复框，过低丢框 |
| `nms_top_k` | 是 | NMS 前保留框数 | 过小会丢密集目标 |
| `output_order` | 视模型 | 输出张量顺序映射 | 顺序错导致解析出垃圾 |
| `anchors_table` | YOLOv5 系 | 三组 anchor | YOLOv5 必须给 |

### 4.3.3.2 支持的解析器清单

解析器名字写错时，节点会直接把支持列表打印出来——这是最可靠的白名单：

```
[ERROR] [dnn_example_node]: Error! Invalid parser: yolov5 . Only yolov2, yolov3, yolov5, yolov5x, yolov8, yolov10, ssd, fcos efficient_det, classification, unet, yolov8-seg are supported
[ERROR] [dnn_example_node]: Load config fail!
```

> 来源：社区帖 33436（https://forum.d-robotics.cc/t/topic/33436）

注意报错原文里有个**容易误读的地方**：它说「Invalid parser: yolov5」，但紧接着列表里又有 `yolov5`。这不是矛盾——那个用户写的是 `yolov5 `（结尾带空格，见原文的 `yolov5 .`），空格导致字符串比较失败。**排错时第一件事是检查 JSON 里的不可见字符。**

### 4.3.3.3 版本演进：新增 ultralytics_yolo 解析器

较新的 `hobot_dnn`（≥ 2.6.1）新增了 `ultralytics_yolo` 解析器，专门处理 Model Zoo 里**没有反量化节点**的 FP32 输出模型：

> 「手册的默认配置通常针对包含反量化节点的模型。对于无反量化模型，必须手动指定解析器为 `ultralytics_yolo`」
> 来源：社区帖 34415（https://forum.d-robotics.cc/t/topic/34415）

配置差异只有两处：

```json
{
  "model_file": "config/yolo26l_detect_bayese_640x640_nv12.bin",
  "task_num": 4,
  "dnn_parser": "ultralytics_yolo",
  "model_output_count": 6,
  "reg_max": 1,
  "class_num": 80,
  "cls_names_list": "config/coco.list",
  "strides": [8, 16, 32],
  "score_threshold": 0.25,
  "nms_threshold": 0.7,
  "nms_top_k": 300,
  "output_order": [0, 1, 2, 3, 4, 5]
}
```

`reg_max` 的取值规则（社区帖给了表格）：

| 模型类型 | `reg_max` |
| --- | --- |
| YOLO26 模型 | `1` |
| 其他 YOLO 模型 | `16` |

> 来源：社区帖 34415（https://forum.d-robotics.cc/t/topic/34415）

**注意版本门槛**：`ultralytics_yolo` 是 `hobot_dnn` 2.6.1 才加入的。社区有人确认「Tros Hobot Dnn 版本无法更新到 2.6.1，即便是最新版本的镜像」，官方的回复是「`ultralytics_yolo` 为 2.6.1 新加入 parser……整体的 TROS 还处于测试源中，若无法直接更新，可以自行拉源码编译来使用」。
> 来源：社区帖 34415（https://forum.d-robotics.cc/t/topic/34415）

### 4.3.3.4 一个反直觉的忠告：不要直接改默认配置

> 「强烈建议不要直接修改手册中的默认 config 文件。原配置可能在运行时被覆盖，或者系统会默认回退加载原配置，导致您的修改『看似生效，实则无效』。正确做法：新建或复制配置文件。」
> 来源：社区帖 34415（https://forum.d-robotics.cc/t/topic/34415）

```bash
cp config/original.json config/my_yolo26.json
# 改 my_yolo26.json，启动时显式指定
ros2 launch dnn_node_example dnn_node_example.launch.py dnn_example_config_file:=config/my_yolo26.json
```

这条忠告的价值在排查阶段尤其明显：如果配置文件是同名覆盖的，改完之后你**无法判断**生效的是新版还是被回退的旧版。

## 4.3.4 后处理与解析器

### 4.3.4.1 YOLOv8 输出结构是什么样

YOLOv8 是**解耦头**（decoupled head），三个尺度各出两个张量：cls 分支和 reg/bbox 分支。6 个输出：

| 输出序号 | Shape（NHWC, 80×80 尺度） | 含义 |
| --- | --- | --- |
| 0 | `[1, 80, 80, 5]` | bbox 分支 P3（第 3 维 5 = 4 个 bbox 回归 + 1 个 objectness，具体取决于导出脚本） |
| 1 | `[1, 80, 80, 64]` | reg/cls 分支 P3（64 = 4×reg_max = 4×16，DFL 分布） |
| 2 | `[1, 40, 40, 5]` | bbox 分支 P4 |
| 3 | `[1, 40, 40, 64]` | reg/cls 分支 P4 |
| 4 | `[1, 20, 20, 5]` | bbox 分支 P5 |
| 5 | `[1, 20, 20, 64]` | reg/cls 分支 P5 |

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

而 **YOLOv5 是耦合头**，只有 3 个输出（每个尺度一个）。所以 `model_output_count` 在 YOLOv5 上是 `3`：

```json
{
  "model_file": "/opt/hobot/model/x5/basic/yolov5x.bin",
  "task_num": 2,
  "dnn_Parser": "yolov5x",
  "model_output_count": 3,
  "class_num": 80,
  "cls_names_list": "config/coco.list",
  "strides": [8, 16, 32],
  "anchors_table": [[[10, 13], [16, 30], [33, 23]], [[30, 61], [62, 45], [59, 119]], [[116, 90], [156, 198], [373, 326]]],
  "score_threshold": 0.4,
  "nms_threshold": 0.5,
  "nms_top_k": 5000
}
```

> 来源：社区帖 28330（https://forum.d-robotics.cc/t/topic/28330）

**这段 JSON 里有个坑**：字段名写的是 `dnn_Parser`（大写 P），而其他例子里是 `dnn_parser`（全小写）。JSON 键名大小写敏感，如果节点读的是小写键，这个配置里的解析器设置就是无效的。遇到「解析器设置没生效」时检查这里。

### 4.3.4.2 layout 与 type 是硬约束

社区帖 34784 里最关键的结论：

> 「你的模型输出是 NHWC 格式（6 个输出头），但 `dnn_node_example` 的 YOLOv8 parser 期望的是 NCHW 格式，且输出顺序应该是 bbox 在前，cls 在后。」
> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

而同一个帖子里，作者用 permute 转成 NHWC 后又报了另一个错：

```
[example-1] [ERROR] [dnn_example_node]: Inlvaid parser: 0
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

注意这个 `Inlvaid` 是官方代码里的拼写错误（应为 `Invalid`），原样抄下来便于搜索。

所以对 YOLOv8 parser 来说，**正确形态**是：

| 维度 | 正确值 | 说明 |
| --- | --- | --- |
| layout | `NCHW` | 不要 permute 成 NHWC |
| 输出顺序 | bbox 先，cls 后 | 顺序反了 parser 拿错张量 |
| bbox 类型 | `S32` + scale | parser 里有反量化步骤 |
| cls 类型 | `F32` | 不需要反量化 |

社区给的导出脚本改法：

```python
def Detect_forward(self, x):
    result = []
    for i in range(self.nl):
        # 先输出 bbox，再输出 cls（关键！）
        bbox = self.cv2[i](x[i])   # (B, 64, H, W) - bbox
        cls  = self.cv3[i](x[i])   # (B, nc, H, W) - cls
        # 保持 NCHW 格式，不要 permute
        result.append(bbox)
        result.append(cls)
    return result
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

**但官方最终的建议是不要自己改导出脚本**：

> 「不要自己修改导出脚本，直接使用社区验证过的：`git clone -b rdk_x5 https://github.com/D-Robotics/rdk_model_zoo.git`……最关键的是使用 rdk_model_zoo 官方的导出脚本，不要自己修改 `Detect_forward` 函数。」
> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

### 4.3.4.3 F32 vs S32：本卷最长的一个坑

现象（原样抄）：

```
[example-1] [INFO] [dnn_example_node]: Output from frame_id: feedback, stamp: 0.0
[ERROR] [example-1]: process has died [pid 33751, exit code -11, cmd '/opt/tros/humble/lib/dnn_node_example/example --ros-args --log-level info ...']
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

根因（官方助手给出的定性）：

> 「`dnn_node_example` 的 YOLOv8 parser 底层代码期望 bbox 分支输出是 S32（int32），但你编译出来的模型全是 F32（float32）。当 parser 用 int32 指针读取 float32 数据时，会导致数值解析错误，进而引发内存越界和段错误（exit code -11）。」
> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

机制拆开说：

1. 官方的 YOLOv8 模型导出时对 bbox 分支做了**反量化（dequantize）**处理，让它在 `.bin` 里以 `S32` 形式落地。
2. parser 里写的是 `int32_t *box_data = boxes->GetTensorData();`，然后乘以 scale 还原成浮点。
3. 如果你的模型是 `F32`，同一块内存被按 int32 解释，浮点数的位模式变成一个巨大的整数，接着拿去算 anchor/stride 索引，直接越界。
4. 越界写内存 → SIGSEGV → `exit code -11`。

**关键：这个过程不会在数值层面报任何错**，只会在最后一步崩。所以现象永远是「模型加载成功、输出打印了一行 `Output from frame_id`、然后立刻死」。

处置（验证模型输出类型）：

```bash
# 用板端工具看模型真实输出
hrt_model_exec model_info --model_file=./cow.bin
```

期望看到（bbox 是 S32）：

```
output[0]:
name: output0
valid shape: (1,64,80,80,)
tensor type: HB_DNN_TENSOR_TYPE_S32
tensor layout: HB_DNN_LAYOUT_NCHW
quanti type: NONE
```

而错误形态是：

```
[example-1] - (0) Layout: NHWC, Shape: [1, 80, 80, 5], Type: HB_DNN_TENSOR_TYPE_F32.
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

**注意 `quanti type: NONE` 这个字段**——S32 输出配合 `quanti type: NONE` 是官方形态；如果是 S32 但 quanti type 是 SCALE，说明还有一层量化参数要处理。

### 4.3.4.4 修复路径：两条，优先级明确

**路径 A（推荐）：用 rdk_model_zoo 官方导出脚本重新导出**

```bash
git clone -b rdk_x5 https://github.com/D-Robotics/rdk_model_zoo.git
cd rdk_model_zoo/samples/vision/ultralytics_yolo/conversion/onnx_export
python export_yolo26_detect_bpu.py --weights /path/to/best.pt --imgsz 640 --opset 11
```

然后编译：

```bash
hb_mapper makertbin --model-type onnx --config yolov8.yaml
hrt_model_exec model_info --model_file=./model_output/yolov8_cow.bin
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

**路径 B：改 parser 源码（适用于 hobot_dnn ≥ 2.6.1 且模型是 FP32）**

这是社区帖 33843 给的完整方案，四步：

```cpp
// 步骤 3.1：把指针类型从 int32_t* 改成 float*
float *box_data = boxes->GetTensorData();

// 步骤 3.2：删掉反量化相关代码
// 删除：auto *box_scale_data = reinterpret_cast<float*>(boxes->properties.scale.scaleData);

// 步骤 3.3：直接用读出的浮点数，不再乘 scale
float *cur_box_data = box_data;

// 步骤 3.4：重新编译
```

> 来源：社区帖 33843（https://forum.d-robotics.cc/t/topic/33843）

对应文件是 `src/hobot_dnn/dnn_node/src/output_parser/detection/ptq_yolo8_output_parser.cpp`，`ParseTensor` 函数里。

编译：

```bash
cd /path/to/hobot_dnn
colcon build --packages-select dnn_node
source install/setup.bash
```

**注意覆盖式编译的警告**（这是 colcon 的正常提醒，不是错误）：

```
WARNING:colcon.colcon_core.package_selection:Some selected packages are already built in one or more underlay workspaces:
'dnn_node_sample' is in: /opt/tros/humble
If a package in a merged underlay workspace is overridden and it installs headers, then all packages in the overlay must sort their include directories by workspace order.
If you understand the risks and want to override a package anyways, add the following to the command line:
--allow-overriding dnn_node_sample
```

> 来源：社区帖 33436（https://forum.d-robotics.cc/t/topic/33436）

要真正覆盖 `/opt/tros/humble` 里的版本，必须加 `--allow-overriding dnn_node_sample`。

### 4.3.4.5 第三条路：干脆不用 TROS 解析器

如果 parser 始终对不上，社区帖 34784 的备选方案是用 Python 自己后处理：

```python
from hobot_dnn import pyeasy_dnn as dnn
import numpy as np

# 加载模型
models = dnn.load('/home/sunrise/yolov8/yolov8_cow.bin')
model = models[0]

# 推理
outputs = model.inference(input_image)

# 手动后处理
# 1. 解码 bbox（output[1], [3], [5]）
# 2. 获取 cls（output[0], [2], [4]）
# 3. NMS
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

**这段代码有版本陷阱**：`from hobot_dnn import pyeasy_dnn` 是 **RDKOS 3.5.0 之前**的写法。3.5.0 起 Python 侧统一为 `hbm_runtime`，`pyeasy_dnn` 不再适用。

### 4.3.4.6 输出头的快速验证

不确定模型输出对不对时，用 Python 一行命令打印：

```bash
python3 -c "from hobot_dnn import pyeasy_dnn as dnn; models = dnn.load('/path/to/model.bin'); print([out.properties.shape for out in models[0].outputs])"
```

真实输出示例：

```
[(1, 80, 80, 1), (1, 80, 80, 64), (1, 40, 40, 1), (1, 40, 40, 64), (1, 20, 20, 1), (1, 20, 20, 64)]
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

这是**单类别**（`1` 而不是 `5`）的 YOLOv8 输出，6 个张量，NHWC layout。**只看 shape 就能判断模型是不是 YOLOv8 解耦头**：出现 `64`（=4×reg_max=4×16）就是有 DFL。

## 4.3.5 推理延迟统计

### 4.3.5.1 延迟从哪里看

`dnn_node` 会在推理完成后打印耗时。但这个数值在 RDKOS **3.4.1 之前是错的**：

> 「修复板端模型推理框架：`hobot_dnn` 统计推理延迟错误的问题。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

RDK 总览页的写法是「`hobot_dnn` 修复：修正了板端模型推理框架统计『推理延迟』数值错误的问题，性能分析更准确」。
> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）

**这条对性能调优影响很大**：3.3.3 及更早的板子上，`hobot_dnn` 报出来的推理延迟是错的。如果你在这些版本上测性能，得到的数字不能作为优化依据。判断方法同第一章——`cat /etc/version` 看是不是 ≥ 3.4.1。

### 4.3.5.2 正确的测量方法：hrt_model_exec

脱离 ROS 层，直接用板端工具测，这是唯一能分清楚「BPU 耗时」和「CPU 耗时」的方法：

```bash
# 单线程：模拟单线程应用的真实延迟
hrt_model_exec perf --thread_num 1 --model_file ./model.bin --loop_num 100

# 双线程：测纯 BPU 吞吐能力
hrt_model_exec perf --thread_num 2 --model_file ./model.bin --loop_num 100
```

社区里有位官方人员的原话解释了这两个数字的含义：

> 「单线程延迟为单帧、单线程、单 BPU 核心的延迟，BPU 推理一个任务最理想的情况。多线程帧率为多个线程同时向 BPU 塞任务，每个 BPU 核心可以处理多个线程的任务，一般工程中 2 个线程可以控制单帧延迟较小，同时吃满所有 BPU 到 100%，在吞吐量（FPS）和帧延迟间得到一个较好的平衡。」
> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

### 4.3.5.3 一个真实的性能剖析案例

社区帖 34885 里有一个非常完整的耗时拆解，值得作为排障范本：

```
thread_num 1 测试结果：
├─ BPU 推理：104ms (36%)
├─ CPU 侧：182ms (64%)  ← 主要瓶颈！
│  ├─ Layout Convert: 148ms
│  ├─ Less/Not/Cast: 8ms
│  └─ Quantize/Dequantize: 22ms
```

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

结论很明确：**BPU 只占 36%，瓶颈在 CPU 侧的 layout 转换**。优化优先级也是照着耗时排的：

1. 先解决 Layout Convert（148ms → <5ms）：改 `input_layout_rt: 'NHWC'`
2. 再解决 CPU 算子（182ms → <20ms）：用 `node_info` 强制算子到 BPU
3. 最后用 `thread_num 2` 验证 BPU 真实性能

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

**这个案例的通用价值**：看到「性能不达预期」时，第一反应不该是换模型，而是先用 `thread_num 1` 和 `thread_num 2` 分别测，看瓶颈到底在 BPU 还是 CPU。如果两个线程数下 BPU 耗时差不多而 FPS 差很多，瓶颈就在 CPU 侧的每帧固定开销。

### 4.3.5.4 另一个真实案例：从 7 FPS 到 47 FPS

社区帖 33301 记录了 YOLOv11n 的完整优化过程，起点数据：

```
BPU推理延迟：126ms
端到端FPS：7.67
```

同一个作者测出「官方 YOLOv5s 示例可以跑到 180 FPS」，两者相差 23 倍。排查后发现量化精度没问题（余弦相似度 > 0.99）、后处理也很快（12–14 ms），最后定位在 Softmax 等算子的实现上。
> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

**这个案例的启示**：`hrt_model_exec perf` 测出来的数如果远低于同算力的官方模型，问题多半在模型结构（算子不被 BPU 支持而降级到 CPU），不在 TROS 配置。

### 4.3.5.5 batch > 1

RDK X5 的 `.bin` 模型支持 batch > 1。社区确认过：「确认：RDK X5 的 `.bin` 模型支持输入 batch 大于 1」。
> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

但量化时校准数据数量要是 batch 的倍数，或者工具会自动重复使用数据。batch 增大能提升吞吐但会增加单帧延迟——是否值得取决于应用是「追帧率」还是「追延迟」。

## 4.3.6 自定义模型接入（C++ 路线）

### 4.3.6.1 完整流程

| 步骤 | 做什么 | 产出 |
| --- | --- | --- |
| 1 | 训练模型并导出 ONNX | `best.onnx` |
| 2 | 用 hb_mapper 量化编译 | `model.bin` |
| 3 | `hrt_model_exec model_info` 验证输出 | 确认 shape/layout/type |
| 4 | 写 JSON 配置 | `myworkconfig.json` |
| 5 | 跑 `dnn_node_example_feedback` 单图验证 | 排除相机因素 |
| 6 | 接相机跑完整链路 | 端到端跑通 |

### 4.3.6.2 量化 YAML 的标准配置

社区里反复出现的可用配置（YOLOv8 5 分类）：

```yaml
model_parameters:
  onnx_model: './best.onnx'
  march: "bayes-e"
  layer_out_dump: False
  working_dir: 'model_output'
  output_model_file_prefix: 'yolov8_cow'

input_parameters:
  input_name: "images"
  input_shape: ''
  input_type_rt: 'nv12'
  input_layout_rt: ''
  input_type_train: 'rgb'
  input_layout_train: 'NCHW'
  norm_type: 'data_scale'
  scale_value: 0.003921568627451

calibration_parameters:
  cal_data_dir: './cal_bin'
  cal_data_type: 'float32'
  calibration_type: 'default'

compiler_parameters:
  compile_mode: 'latency'
  debug: False
  optimize_level: 'O3'
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

几个容易踩的点：

| 字段 | 注意 |
| --- | --- |
| `march` | X5 是 `bayes-e`，不能写 `bayes`（那是 X3） |
| `layer_out_dump` | 必须 `False`，设 `True` 会输出 69 个中间层 |
| `input_type_rt` | 板端喂 NV12 就写 `nv12` |
| `scale_value` | `0.003921568627451` = 1/255，RGB 归一化 |
| `optimize_level` | `O3` 是性能优先 |
| `calibration_type` | `default` / `max` / `skip` / `ml` |

**`layer_out_dump: True` 的后果**在社区帖里写得很清楚：「`layer_out_dump` True（导致 69 个输出）vs False（只有 6 个输出）」。
> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

69 个输出意味着 `model_output_count` 与配置完全对不上，parser 会从中间层张量里取数据，结果不可预测。

**关于 `optimization_parameters`**：社区明确提到「不要添加 `optimization_parameters`（1.24.3 版本不支持）」。工具链版本与参数支持范围绑定，抄配置时要对版本。
> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

### 4.3.6.3 编译产物验证

```bash
# 看输出数量与每个输出的类型
hrt_model_exec model_info --model_file=./model_output/yolov8_cow.bin
```

输出示例（正确形态）：

```
[yolov8_cow]
input[0]:
  name: images
  input source: HB_DNN_INPUT_FROM_PYRAMID
  valid shape: (1,3,640,640,)
  tensor type: HB_DNN_IMG_TYPE_NV12
  tensor layout: HB_DNN_LAYOUT_NCHW
  quanti type: NONE

output[0]:
  name: output0
  valid shape: (1,64,80,80,)
  tensor type: HB_DNN_TENSOR_TYPE_S32
  tensor layout: HB_DNN_LAYOUT_NCHW
  quanti type: NONE
```

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

`input source: HB_DNN_INPUT_FROM_PYRAMID` 说明输入走 pyramid（BPU 直连），这是 X5 上性能最好的输入方式。如果显示 `FROM_DDR`，说明要走一次 CPU 到 BPU 的搬运。

### 4.3.6.4 模型 vs 相机分辨率不匹配

社区里有个案例：模型 640×640，相机只支持 640×480，`feed_type` 设 0 也没生效，最终结果同样是 `exit code -11`。诊断结论：

> 「核心问题是：`feed_type: 0` 配置不生效，即使设置了本地图片测试，节点仍在接收相机数据并 crash。同时，模型输入尺寸(640×640)与相机输出(640×480)不匹配，导致后处理 crash。」
> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

**注意这里有两个根因叠加**：配置没生效 + 尺寸不匹配。所以排查时不能只改一个。

处置优先级（社区给的顺序）：

| 优先级 | 操作 | 目的 |
| --- | --- | --- |
| 1 | `hrt_model_exec --model_file xxx.bin --input_path test.jpg --output_dir /tmp/hrt_test` | 确认模型本身正常 |
| 2 | 若成功 → `diff` 自己的 config 与官方 config | 找配置差异 |
| 3 | 若失败 → 重新量化模型（匹配相机分辨率） | 匹配输入尺寸 |

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

**第 1 步是关键**：`hrt_model_exec` 完全绕过 ROS，如果它都跑不通，问题在模型不在节点。这一步能省掉大量盲改。

## 4.3.7 Python 路线

### 4.3.7.1 版本分界（最重要的一条）

| RDKOS 版本 | Python 推理接口 | 典型 import |
| --- | --- | --- |
| **3.5.0 及以上** | `hbm_runtime` | `from hbm_runtime import ...` |
| 3.4.1 及以下 | `pyeasy_dnn`（在 `hobot_dnn` 包里） | `from hobot_dnn import pyeasy_dnn as dnn` |

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

官方对 3.5.0 的原话：

> 「自 3.5.0 版本起，Python 算法推理、目标检测、语义分段等模块统一升级为 `hbm_runtime` 接口。该接口基于 pybind11 实现，提供对 libdnn C++ 库的高效访问，支持高性能模型加载与神经网络推理。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

**而 TROS 侧的 C++ 推理始终是 `hobot_dnn`**，不受这个切换影响。这不是矛盾，是两套并行接口：Python 走 `hbm_runtime`，C++ 走 `hobot_dnn`。把这两条混为一谈是本章最容易犯的版本错误。

### 4.3.7.2 旧接口（3.4.1 及以下）

```python
from hobot_dnn import pyeasy_dnn as dnn

models = dnn.load('/path/to/model.bin')
model = models[0]

# 看输入
print(model.inputs[0].properties)

# 看输出
print([out.properties.shape for out in model.outputs])

# 推理
outputs = model.inference(input_tensor)
```

更多细节可参考官方 Python 多媒体接口文档：
> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn）

### 4.3.7.3 新接口（3.5.0 及以上）

3.5.0 的官方示例在 `/app/pydev_demo/` 下，全部基于 `hbm_runtime` 重写。官方对这批示例的说明：「基于新版 `hbm_runtime` 接口，对 `/app/pydev_demo/` 下所有示例完成全量重写，确保接口统一、性能最优、使用更简洁。」
> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

USB 摄像头 + YOLOv5x 的示例直接给出了 import 层的线索：

```
root@ubuntu:/app/pydev_demo/07_usb_camera_sample# python usb_camera_yolov5x.py
Opening video device: /dev/video0
Open USB camera successfully
[BPU_PLAT]BPU Platform Version(1.3.6)!
[HBRT] set log level as 0. version = 3.15.55.0
[DNN] Runtime version = 1.24.5_(3.15.55 HBRT)
```

> 来源：官方文档 Basic_Application/vision/RDK_X5/usb_camera（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/vision/RDK_X5/usb_camera）

官方对该示例的描述是「演示如何使用 `hbm_runtime` 结合 YOLOv5X 模型对 USB 摄像头画面进行推理」。
> 来源：官方文档 Basic_Application/vision/RDK_X5/usb_camera（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/vision/RDK_X5/usb_camera）

### 4.3.7.4 Python 与 C++ 的边界

| 维度 | Python（`hbm_runtime`） | C++（`hobot_dnn`） |
| --- | --- | --- |
| 谁维护 | `/app/pydev_demo/` 示例 | TROS 功能包（`tros-humble-dnn-node`） |
| 是否有 ROS 节点 | 无，纯脚本 | 有，标准 ROS2 节点 |
| 后处理 | 自己写（numpy） | parser 里现成 |
| 零拷贝支持 | 无 | 有（`is_shared_mem_sub`） |
| 适合场景 | 快速验证、算法原型 | 产品集成、多节点协同 |
| 版本切换 | 3.5.0 换接口 | 不换，一直是 `hobot_dnn` |

## 4.3.8 排障四段式

### 4.3.8.1 故障一：`exit code -11` 段错误（输出类型不匹配）

**现象**：

```
[example-1] [INFO] [dnn_example_node]: Output from frame_id: feedback, stamp: 0.0
[ERROR] [example-1]: process has died [pid 33751, exit code -11, cmd '/opt/tros/humble/lib/dnn_node_example/example ...']
```

**根因**：模型的 bbox 输出是 F32，而 parser 期望 S32 + scale。用 `int32_t*` 读 float 数据，位模式被解释成巨大整数，索引越界写内存。详见上文「F32 vs S32」一节。

**处置**：

```bash
# 1. 先确认模型真实输出类型
hrt_model_exec model_info --model_file=./cow.bin

# 2. 若 bbox 是 F32 → 三选一
#    a) 用 rdk_model_zoo 官方导出脚本重新导出（推荐）
#    b) 改 ptq_yolo8_output_parser.cpp 的指针类型并重编
#    c) 放弃 TROS parser，用 Python 自己后处理
```

**预防**：量化完模型后**必做**的一步是 `hrt_model_exec model_info`，对照官方模型的输出签名（layout/type/shape）逐项核对，不要跳过。

### 4.3.8.2 故障二：`Invalid parser`

**现象**：

```
[ERROR] [dnn_example_node]: Error! Invalid parser: yolov5 . Only yolov2, yolov3, yolov5, yolov5x, yolov8, yolov10, ssd, fcos efficient_det, classification, unet, yolov8-seg are supported
[ERROR] [dnn_example_node]: Load config fail!
```

> 来源：社区帖 33436（https://forum.d-robotics.cc/t/topic/33436）

**根因**：两种可能——(a) 解析器名真拼错，(b) JSON 里有多余空格或不可见字符。原文 `yolov5 .`（空格在点号之前）就是 (b)。

**处置**：

```bash
# 用 python 检查 JSON 是否合法，同时打印 repr 看出隐藏字符
python3 -c "import json; d=json.load(open('config/x.json')); print({k: repr(v) for k,v in d.items() if 'parser' in k.lower()})"
```

**预防**：配置用 `cp` 官方文件再改，不要手打 JSON。

### 4.3.8.3 故障三：`Infer TimeOut` + `Invalid node_output->output_tensors`

**现象**：

```
[example-3] [BPU_PLAT]FC Parse error!
[example-3] [ERROR] [dnn]: ModelInferTask Infer TimeOut 20000
[example-3] [ERROR] [dnn]: Failed to wait infer done, ret[-6000012]
[example-3] [ERROR] [dnn]: Run infer fail
[example-3] [ERROR] [PostProcessBase]: Invalid node_output->output_tensors
```

> 来源：社区帖 28330（https://forum.d-robotics.cc/t/topic/28330）

**根因**：`FC Parse error!` 是关键线索——**FC（Fully Connected）层解析失败**，模型编译时某个全连接层没编进 BPU，infer 等不到结果，20 秒超时。超时后输出张量是空的，后处理拿空指针就报 `Invalid node_output->output_tensors`。

这个案例里量化配置也印证了问题：

```
calibration_type: : skip
march : bayes
```

`march: bayes` 是 **X3 的 march**，X5 应该是 `bayes-e`；`calibration_type: skip` 意味着完全没做校准。两个都错。

**处置**：

```yaml
model_parameters:
  march: "bayes-e"          # X5 必须是 bayes-e

calibration_parameters:
  calibration_type: 'default'   # 不要用 skip
  cal_data_dir: './cal_bin'
```

**预防**：量化 YAML 里的 `march` 是最容易跨平台抄错的一项。X3 → `bayes`，X5 → `bayes-e`，X5 用 `bayes` 编出来的模型在 X5 上跑不了。

### 4.3.8.4 故障四：`feed_type` 不生效，仍在读相机

**现象**：设了 `feed_type:=0` 和本地图片，但节点还是崩，日志显示在处理相机帧。

**根因**：`feed_type` 在 launch 里作为参数传入，但如果同时配置了 `is_shared_mem_sub:=1`，节点会优先建共享内存订阅、仍然接收相机数据；或者参数被 launch 文件里的默认值覆盖。

**处置**：

```bash
# 1. 确认参数真的传进去了（看启动日志的 Parameter 段）
#    应该显示 feed_type(0:local, 1:sub): 0

# 2. 改用 feedback launch（它本身就是本地回灌路径）
ros2 launch dnn_node_example dnn_node_example_feedback.launch.py \
  dnn_example_config_file:=config/x.json \
  dnn_example_image:=config/test.jpg

# 3. 或者干脆绕过 ROS，直接用 hrt_model_exec 验模型
hrt_model_exec --model_file xxx.bin --input_path config/test.jpg --output_dir /tmp/hrt_test
```

> 来源：社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

**预防**：验证模型时**不要用完整 launch**（它会拉起相机、codec、websocket 四个进程），用 `dnn_node_example_feedback.launch.py` 单独跑推理节点，变量少一半。

## 常见误区

**误区一：以为「模型量化成功、余弦相似度 0.99」就代表能在 TROS 上跑。**
量化精度和 TROS parser 兼容性是两件事。Model Zoo 的模型能在 Python 示例里跑出正确结果，照样可能因为输出是 FP32 而在 `dnn_node` 里段错误。判据是 `hrt_model_exec model_info` 打出来的 `tensor type`，不是余弦相似度。

**误区二：把 `layer_out_dump` 设成 True 去「看得更清楚」。**
设 True 会让模型输出 69 个中间层张量，`model_output_count: 6` 与它对不上，parser 从错误的张量里取数据。这个开关只用于量化调试，部署时必须 False。

**误区三：在 X5 上抄 X3 的 `march: bayes`。**
X5 是 `bayes-e`。用 `bayes` 编出来的模型在 X5 上会表现为 `FC Parse error!` 加 `Infer TimeOut`，而不是「不支持的模型」这种明确报错。

**误区四：3.5.0 上照抄 `from hobot_dnn import pyeasy_dnn`。**
3.5.0 起 Python 侧是 `hbm_runtime`。网上大量教程是 3.4.x 时代的，直接抄会 `ImportError`。同时注意反向陷阱：**TROS 的 C++ 侧仍然是 `hobot_dnn`**，看到它不要以为版本搞错了。

**误区五：改了默认 config 文件却不知道有没有生效。**
官方明确警告「原配置可能在运行时被覆盖，或者系统会默认回退加载原配置」。正确做法是 `cp` 一份新的再指定。否则你会在「改了没效果」和「改了有效果」之间反复横跳。

**误区六：用 3.3.3 及更早系统上打印的推理延迟做优化依据。**
`hobot_dnn` 的推理延迟统计 bug 是 3.4.1 才修的。老版本上这个数字不可信，要用 `hrt_model_exec perf` 独立测。

**误区七：看到 `exit code -11` 就去改相机参数。**
段错误的根因在模型输出签名与 parser 期望不匹配，跟相机无关。正确顺序是：先 `hrt_model_exec model_info` 看模型 → 再单图回灌 → 最后才接相机。跳过前两步会在相机侧白折腾很久。

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）、社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）、社区帖 34614（https://forum.d-robotics.cc/t/topic/34614）

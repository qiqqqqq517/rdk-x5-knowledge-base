# BPU 与 Model Zoo 总览

## 本章解决什么

这一章回答三个最基础、也最容易搞错的问题：RDK X5 的 BPU 到底是什么、标称的 10 TOPS 是什么口径、官方 Model Zoo 里那些 `.bin` 模型是怎么来的。先把这三件事对齐，后面所有关于「模型跑不动」「精度不对」「性能不达标」的讨论才有共同语言。

最典型的两个误解是：把 10 TOPS 当成「什么模型都能跑 10 TOPS」，以及把 Model Zoo 里的 `.bin` 当成「通用模型文件」。这两个误解会直接导致后面几章的所有错误判断。

> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）
> 来源：官方文档 model_zoo_intro（https://developer.d-robotics.cc/rdk_x_doc/model_zoo_intro）
> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

## BPU 是什么：名字、代际与算力

BPU 全称 Brain Processing Unit，是 D-Robotics（地瓜机器人）自研的神经网络加速单元。它不是一个通用 GPU，而是一个**只跑定点 INT8 的专用推理核**。

官方在工具链问答里给出了各平台的 BPU 代号对应关系，这是分清「同一份模型能不能跨板跑」的第一手依据：

| 平台 | BPU 代号 |
| --- | --- |
| RDK X3 | Bernoulli2 |
| RDK X5 | **Bayes-e** |
| Super100 | Nash-e |
| Super100P | Nash-m |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）Q1

这张表决定了 yaml 里 `march` 字段该填什么。X5 必须填 `bayes-e`，填 `bayes` 或 `bernoulli2` 编出来的模型在 X5 上跑不了。官方给 X5 的量化 yaml 模板里，`march` 就是 `bayes-e`：

```yaml
model_parameters:
  onnx_model: ''
  march: "bayes-e"
  layer_out_dump: False
  working_dir: 'model_output'
  output_model_file_prefix: 'horizon_x5'
```

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）「RDK X5 ONNX 模型量化 yaml 文件模板」

硬件规格方面，官方给 X5 的表述是「10Tops 端侧推理算力与 8 核 ARM A55 处理能力，支持 2 路 MIPI Camera 接入，4 路 USB3.0 接口」。X3 是 5 TOPS。

> 来源：官方文档 RDK（https://developer.d-robotics.cc/rdk_x_doc/RDK）

### 算力口径：10 TOPS 到底在说什么

这是本章最重要的一段。10 TOPS 的含义需要拆成三层：

**第一层：它只算 BPU，不算 CPU。** 8 核 A55 的算力完全是另一回事。一个模型如果把 30% 的算子回退到 CPU 执行，那部分计算与 10 TOPS 毫无关系，实际吞吐由 CPU 决定 —— 而 A55 跑卷积比 BPU 慢一到两个数量级。

**第二层：它是 INT8 定点算力，不是 FP32 算力。** 官方工具链文档写得很直接：

> 「目前在 GPU 上训练的模型大部分都是浮点模型，即参数使用的是 float 类型存储；D-Robotics BPU 架构的处理器使用的是 INT8 的计算精度（业内处理器的通用精度），只能运行定点量化模型。」

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

所以「我的 FP32 模型在 GPU 上跑得挺好，为什么 X5 跑不动」这个问题本身就不成立 —— BPU 根本没有 FP32 通路，模型必须先量化成 INT8 定点模型才能上板。

**第三层：TOPS 是峰值，不是你的模型能拿到的值。** 峰值算力对应的是「所有算子都是理想尺寸的卷积、全部在 BPU 上、无任何数据搬运开销」这种实验室条件。真实模型里有卷积以外的算子、有算子间的数据搬运、有 CPU/BPU 之间的切换，实际能拿到的比例远低于 100%。

社区帖子 34885 就是一个干净的量化案例：一个所有算子都在 BPU 上的模型，实测只有不到 2 Hz。翻日志才发现，BPU 推理只占 104ms，而 CPU 侧的数据搬运和 layout 转换占了 182ms —— 端到端 286ms 里有 64% 根本没用在 BPU 上。改掉 `input_layout_rt` 并强制几个残留算子回 BPU 之后，延迟降到 55ms。

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

这说明：**讨论「性能」时必须先明确是在说 BPU 推理耗时，还是在说端到端帧率。** 这两者可以差 5 倍以上。

## BPU 的硬限制清单

以下限制来自官方文档与社区实测，都是「改代码解决不了、只能改模型结构或接受」的硬边界。

### 输入必须是固定 4 维，N 只能是 1

官方原文：

> 「模型输入维度只支持 **固定 4 维** 输入 NCHW 或 NHWC（N 维度只能为 1），例如：1x3x224x224 或 1x224x224x3，**不支持动态维度及非 4 维输入**」

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

如果一个模型的输入天然是三通道以外的东西 —— 比如点云的 `1x9x50x6000`、雷达的 5 通道 featuremap —— 都必须先自己补齐成 4 维。社区里静态 shape 报错的原文是：

```
ERROR The shape of model input:input is [xxx] which has dimensions of 0. Please specify input-shape parameter.
```

官方解答是「模型输入为动态 shape，可使用参数 `--input-shape input_name input_shape` 来指定」。

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

### 只支持 caffe 1.0 与 onnx opset 10/11

> 「支持 caffe 1.0 版本的 caffe 浮点模型和 ir_version≤7 、 opset10 、 opset11 版本的 onnx 浮点模型量化成 D-Robotics 支持的定点模型；其他框架训练的浮点模型需要先导出第 1 点要求符合版本的 onnx 浮点模型后，才能进行量化」

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

opset 超出范围时的原文报错：

```
ERROR The opset version of the onnx model is n, only model with opset_version 10/11 is supported
```

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

### 模型里不能带后处理算子

> 「浮点模型中不要包含有 **后处理算子**，例如：nms 计算。」

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

这条限制是社区里一大半「部署上去检测框乱飞」问题的根。YOLO 系列如果直接把 `model.export()` 导出的 ONNX 丢进工具链，DFL 解码和 Sigmoid 会被包含在计算图里，量化效果极差，而且 DFL 里的 Softmax 会被丢到 CPU，把模型切成十几个子图。

### 输出节点数上限 32，算子有 shape 上限

```
ERROR tool limits for max output num is 32
```

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

算子层面还有 CxHxW 超过 8192 就被回退 CPU 的限制，日志提示是：

```
INFO： Layer `{op_name}` will be executed on CPU
```

官方解释为「算子由于 shape（CxHxW）超过 8192 被回退到 CPU 计算」。

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

## 算子支持与「不支持」的真实含义

官方提供了 Caffe 和 ONNX 两套算子支持列表，未列出的算子「因 D-Robotics 处理器 bpu 硬件限制，暂不支持」。

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

关键在于：**「不支持」不等于「转换失败」，大多数情况下等于「这个算子回退到 CPU 执行」。** 官方对此有明确态度：

```
Unsupported op {op_type}
```

> 「发生此错误的原因可能是使用的 BPU 算子为 D-Robotics 不支持的 BPU 算子。针对此错误，**若模型整体性能可满足需要，您可以忽略该日志**；若模型整体性能不能达到您的预期，您可以根据我们提供的算子支持列表中的内容对算子进行替换。」

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

这个「可以忽略」的判断要非常小心。判断标准不是「能不能跑」，而是「回退的算子是不是在关键路径上、它的输入输出数据量有多大」。社区帖 35444 的 PointPillars 案例说明了代价：模型里有 `Gather`、`ScatterElements`、`Transpose`、`Cast` 一批 CPU 算子，子图被切碎，DDR 读写量 150MB，实测 1.7 FPS。

> 来源：社区帖 35444（https://forum.d-robotics.cc/t/topic/35444）

### Softmax 是最特殊的一个

在 Transformer 类模型里，Softmax 是绕不开的痛点。社区的实测结论是：**Softmax 默认跑在 CPU，且不支持 INT8，只支持 INT16 或 FP32。**

社区帖 34983 的转换日志直接说明了这一点：

```
WARNING The input0 of Node(name:/blocks_st.0/attn_s/MatMul_1, type:MatMul) does not support data type: int16
```

同一帖里的算子表显示，Softmax 被拆成了 `HzQuantizedReduceMax`、`HzLut2Layer`、`HzSQuantizedReduceSum` 等一系列子算子，在 int16 下运行，其中 `Softmax_sub` 的余弦相似度掉到 0.974。

> 来源：社区帖 34983（https://forum.d-robotics.cc/t/topic/34983）

社区帖 33301 给了更完整的因果链：YOLOv11 的 C2PSA 模块里有一个 Softmax，默认落在 CPU，把一个 BTU 子图切成两个，实测从 100+ FPS 掉到 7.67 FPS。解法是在 yaml 里用 `node_info` 强制它上 BPU 并指定 int16：

```yaml
node_info: {
  "/model.10/m/m.0/attn/Softmax": {
    'ON': 'BPU',
    'InputType': 'int16',
    'OutputType': 'int16'
  }
}
```

> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

需要注意：**MatMul 不支持 int16，但 Softmax 支持。** 这个不对称是社区反复踩的坑 —— 34983 的用户就是被 `<MatMul> does not support data type: int16` 卡住，最后官方回复「QAT 难度过于深度，社区上没有对应案例，有关 QAT 的内容一般以手册内容为准」。

> 来源：社区帖 34983（https://forum.d-robotics.cc/t/topic/34983）

## Model Zoo 是什么

官方定义：

> 「RDK Model Zoo 是 D-Robotics（地瓜机器人）面向 RDK 系列开发板提供的 BPU 模型示例与工具集合……仓库中收录了覆盖图像分类、目标检测、实例分割、姿态估计、OCR、多模态等多个智能应用领域的 BPU 可运行模型，并提供从 原始模型（PyTorch/ONNX）→ 定点量化转换 → 推理运行 → 结果解析 → 示例验证 的完整参考实现」

> 来源：官方文档 model_zoo_intro（https://developer.d-robotics.cc/rdk_x_doc/model_zoo_intro）

仓库地址：`https://github.com/D-Robotics/rdk_model_zoo`。官方特别标注这是**社区开源共建项目**，欢迎 PR。

> 来源：官方文档 model_zoo_intro（https://developer.d-robotics.cc/rdk_x_doc/model_zoo_intro）

### 仓库里有什么

社区教程帖 28624 拆解过仓库结构：主页有中英双语 README、图片资源目录 `resource`、`requirement.txt`，主体是 `demo`（部分版本为 `samples`）目录，按 `detect`、`classification`、`Pose` 等任务分类，每个模型文件夹里同时提供：

- 官方转换好的 `.bin` 模型文件
- PTQ 量化配置文件（yaml）
- C++ / Python / Jupyter 部署例程

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

这一点非常重要：**Model Zoo 的 `.bin` 是「针对某个具体 ONNX 转换产物」，不是通用模型**。它和配套的前后处理代码是强耦合的。用官方 `.bin` 配自己的后处理，或者用自己的 `.bin` 配官方后处理，都会失败。

官方 FAQ 对此有明确警告：

> 「板载的官方示例程序（如 07_yolov5_sample）通常是 **针对其自带的预转换好的 .bin 模型进行适配和测试的**……如果您用自己的模型替换了示例中的 .bin 文件，而没有相应地修改示例代码中的预处理、后处理或模型参数部分，就非常容易因为数据格式不匹配、内存访问越界等原因导致 Segmentation fault。」

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）Q12

### 板端预装模型的固定路径

RDKOS 3.5.0 的 `/app/pydev_demo/` 示例直接引用 `/opt/hobot/model/x5/basic/` 下的模型，这些是出厂预装的成品 `.bin`：

| 任务 | 默认模型路径 |
| --- | --- |
| 图像分类（ResNet18） | `/opt/hobot/model/x5/basic/resnet18_224x224_nv12.bin` |
| 图像分类（MobileNetV2） | `/opt/hobot/model/x5/basic/mobilenetv2_224x224_nv12.bin` |
| 目标检测（YOLOv5X） | `/opt/hobot/model/x5/basic/yolov5x_672x672_nv12.bin` |
| 目标检测（YOLOv11） | `/opt/hobot/model/x5/basic/yolo11n_detect_bayese_640x640_nv12.bin` |
| 目标检测（YOLOv8） | `/opt/hobot/model/x5/basic/yolov8x_detect_bayese_640x640_nv12.bin` |
| 目标检测（YOLOv10） | `/opt/hobot/model/x5/basic/yolov10x_detect_bayese_640x640_nv12.bin` |
| 实例分割（YOLOv11-seg） | `/app/model/basic/yolo11n_seg_bayese_640x640_nv12.bin` |
| 语义分割（MobileNet-UNet） | `/app/model/basic/mobilenet_unet_1024x2048_nv12.bin` |
| 姿态估计（YOLO11-pose） | `/app/model/basic/yolo11n_pose_bayese_640x640_nv12.bin` |

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/classification_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/classification_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/pose_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/pose_sample）

文件名里的 `bayese` 就是 `bayes-e` 的另一种写法，`nv12` 表示这个模型要求的运行时输入格式。

### 怎么确认一个 bin 的输入输出

不要靠文件名猜。板端有专门的工具：

```bash
hrt_model_exec model_info --model_file /opt/hobot/model/x5/basic/yolov5x_672x672_nv12.bin
```

这条命令会打印模型名、input count、每个输入输出的 layout / tensorType / validShape / alignedShape。C 语言示例的运行日志里就能看到这种打印：

```
model_name: yolov5s_v2_672x672_bayese_nv12
Input count: 1
input[0]: tensorLayout: 2 tensorType: 1 validShape:(1, 3, 672, 672, ) alignedShape:(1, 3, 672, 672, )
Output count: 3
Output[0]: tensorLayout: 0 tensorType: 13 validShape:(1, 84, 84, 255, ) alignedShape:(1, 84, 84, 255, )
Output[1]: tensorLayout: 0 tensorType: 13 validShape:(1, 42, 42, 255, ) alignedShape:(1, 42, 42, 255, )
Output[2]: tensorLayout: 0 tensorType: 13 validShape:(1, 21, 21, 255, ) alignedShape:(1, 21, 21, 255, )
```

> 来源：官方文档 Basic_Application/cdev_demo_sample/bpu（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/cdev_demo_sample/bpu）

`tensorLayout: 2` 对应 NHWC，`0` 对应 NCHW；`tensorType: 1` 是 NV12 图像输入，`13` 是 S8，`14` 是 F32。这几个数字是排查「输出类型不对」问题的关键，第四章会详细讲怎么用。

## BPU 的可观测性：sysfs 接口

很多「性能不达预期」的判断靠猜，其实板端直接把 BPU 状态暴露在 sysfs 里。官方给出的路径是 `/sys/devices/system/bpu`：

```bash
# 查看当前 BPU 使用率（0-100）
cat /sys/devices/system/bpu/bpu0/ratio

# 查看 BPU 核心数量
cat /sys/devices/system/bpu/core_num

# 查看当前使用 BPU 的进程及其占用率
cat /sys/devices/system/bpu/users

# 查看 BPU 支持的频率档位
cat /sys/devices/system/bpu/bpu0/devfreq/devfreq*/available_frequencies

# 锁定到指定频率（需先切 userspace 调频策略）
echo userspace > /sys/devices/system/bpu/bpu0/devfreq/devfreq*/governor
echo 600000000 > /sys/devices/system/bpu/bpu0/devfreq/devfreq*/userspace/set_freq
cat /sys/devices/system/bpu/bpu0/devfreq/devfreq*/cur_freq
```

> 来源：官方文档 Advanced_development/linux_development/driver_development/driver_bpu_sysfs_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development/driver_bpu_sysfs_dev）

几个容易误用的节点：

| 节点 | 作用 | 注意 |
| --- | --- | --- |
| `ratio` | 该核使用率百分比 | 只读，判断瓶颈的第一手数据 |
| `power_enable` | 开关该核硬件电源 | 写 0 会关掉核心，慎用 |
| `hotplug` | 核心热插拔 | **不影响单核模型，不支持双核模型** |
| `power_level` | 功率级别 | `1` = linux dvf 动态调节；`0` = 性能优先；`<0` 越低功耗越低 |
| `limit` | 硬件缓冲数量 | 大于 0 才生效，越小优先级越高但切换效率降低 |
| `fc_time` | 每个 fc 任务的 index/id/hwid/group/prio/s_time/e_time/r_time | 定位单次推理耗时的原始数据 |

> 来源：官方文档 Advanced_development/linux_development/driver_development/driver_bpu_sysfs_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development/driver_bpu_sysfs_dev）

社区里有一个常见误判值得提醒：用 `cat /sys/devices/system/bpu/bpu1/ratio` 想证明「X5 是双核」会失败。官方社区明确说过 X5 的 BPU 是单核，一次只能推理一个模型：

> 「X5 BPU 为单核 一次只能推理一个模型，可以尝试增大 batch 和 使用更大尺寸的模型」

> 来源：社区帖 35342（https://forum.d-robotics.cc/t/topic/35342），发言者为社区管理员

这条结论与「X5 的 BPU 算力 10 TOPS」并不矛盾 —— 算力是单核的算力。但它解释了另一件事：为什么多个模型同时跑时 BPU 利用率上不去，因为本质上是时间分片而不是真并行。

## BPU 内存：ION 与保留内存

模型加载、输入输出 buffer、中间张量都从 ION 内存里分配。官方给出的 X5 保留内存布局里与 BPU 相关的有两块：

| 内存划分 | 作用 | 内存区域 | 大小 |
| --- | --- | --- | --- |
| `cma_reserved` | CMA 内存分配（主要为多媒体系统） | 0x88000000..0x9FDFFFFF | 382MB |
| `ion_reserved` | ION 内存分配 | 0xA4100000..0xD40FFFFF | 768MB |

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/memory（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/memory）

ION 在 X5 上主要服务四类用户：BPU 子系统、HIFI（DSP）子系统、开发者通过 `hbmem` 接口分配的内存、多媒体系统（VIN/ISP/VSE/GDC/VPU/OSD/GPU/Display）。三个 ION 区域的分工是：

- `cma_reserved` → 主要为多媒体系统提供内存
- `carveout` → 主要为 **BPU 子系统**提供内存
- `ion_cma` → 备用区域，前两者没有空间时自动从这里申请

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/memory（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/memory）

这解释了一个高频疑问：为什么 `free` 看到的内存明显小于标称值。官方明确说明「保留内存默认情况下总共占用约 1150MB 的内存空间」，「`free` 命令显示的可用内存已经排除了这部分保留内存」。多路 VIO 场景下如果报 `ion_alloc` 错误，原因通常是预留区被吃满，而不是内存条坏了。

## 模型从哪来：三条路径

实际项目里的模型来源只有三种，选错路径会浪费很多时间。

### 路径一：直接用 Model Zoo 的成品 bin

适合：验证链路是否通、跑 demo、做性能基线。

优点是不用装工具链、不用准备校准集。缺点是模型固定，改不了类别数和输入尺寸。官方示例的 FAQ 里就有一条「如何更换测试图片」，但没有任何一条是「如何更换模型」—— 因为换模型等于换整套前后处理。

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/classification_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/classification_sample）

### 路径二：拿 Model Zoo 的 yaml 改自己的 ONNX

适合：模型结构与官方示例同族（比如都是 YOLOv8 检测）。

社区教程帖 28624 的总结是：「一般来说我们只需要根据自己的环境和板端设备修改 `onnx_model` 模型位置、`march` 架构以及 `cal_data_dir` 验证集地址即可」。

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

但更稳妥的做法是直接使用 Model Zoo 的导出脚本，而不是自己改 Ultralytics 的 `head.py`。社区帖 34784 里，用户用 `export_yolo26_detect_bpu.py` 导出 YOLOv8 模型，结果输出全是 F32，TROS 的 parser 用 int32 指针去读，直接段错误：

```
[ERROR] [example-1]: process has died [pid 33751, exit code -11, ...]
```

官方人员的回复是：

> 「你用 YOLOv8 怎么能用 yolo26 导出 ONNX 脚本呀，需要参考对应的 rdk_model_zoo/samples/vision/ultralytics_yolo/conversion/README_cn.md」

> 来源：社区帖 34784（https://forum.d-robotics.cc/t/topic/34784）

### 路径三：从零自己写 yaml

适合：非 YOLO 族、自定义结构、多输入模型。

这条路要自己写完整 yaml、自己准备校准集、自己写前后处理。官方给了四组参数的模板（X5 的 Caffe 版和 ONNX 版各一份），照着填必选项即可。

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）「模型量化 yaml 配置文件模板」

第三章会逐项拆解这些参数。

## 板端示例目录：3.5.0 的样子

3.5.0 的 `/app/pydev_demo/` 是按任务编号的固定结构，认准这个结构能省掉很多「文件在哪」的时间：

```
/app/pydev_demo/
├── 01_classification_sample/      图像分类
│   ├── 01_resnet18/
│   └── 02_mobilenetv2/
├── 02_detection_sample/           目标检测
│   ├── 01_ultralytics_yolov5x/
│   ├── 02_ultralytics_yolo11/
│   ├── 03_ultralytics_yolov8/
│   └── 04_ultralytics_yolo10/
├── 03_instance_segmentation_sample/  实例分割
│   ├── 01_unet_mobilenet/
│   └── 02_ultralytics_yolo11_seg/
├── 04_pose_sample/                姿态估计
│   └── 01_ultralytics_yolo11_pose/
├── 05_open_instance_seg_sample/   开放域实例分割（YOLO-World）
├── 06_segment_sample/             语义分割（MobileNet-UNet）
└── 07_usb_camera_sample/          USB 摄像头实时检测
```

每个子目录的构成是固定的四件套：**推理脚本（`.py`）+ 测试图（`.jpg`）+ 类别标签（`.names` 或 `.txt`）+ 结果图（`result.jpg`）**。模型不放在示例目录里，而是集中放在 `/opt/hobot/model/x5/basic/` 或 `/app/model/basic/`。

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/pose_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/pose_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/usb_camera_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/usb_camera_sample）

官方对这批示例的定位说明是：「本项目包含多个基于 Python 编写的 BPU 使用示例程序，适用于 RDK X5（软件版本 3.5.0）平台，覆盖图像分类、目标检测、实例分割、姿态估计等常见任务。示例使用 `.bin` 格式的量化模型进行推理，便于开发者快速验证模型效果并开展应用开发。」

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/overview（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/overview）

注意这句「软件版本 3.5.0」—— 整个 `pydev_demo` 目录在 3.5.0 被全量重写过，3.4.1 及更早的目录结构完全不同。

### 每个示例的命令行参数是同一套

七个示例的参数设计高度统一，只有阈值类参数因任务不同而略有差异：

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--model-path` | BPU 量化模型路径（.bin） | 各示例不同 |
| `--test-img` | 输入测试图像路径 | 各示例不同 |
| `--label-file` | 类别标签路径 | `coco_classes.names` / `imagenet1000_clsidx_to_labels.txt` |
| `--img-save-path` | 结果图保存路径 | `result.jpg` |
| `--priority` | 推理优先级（0~255，255 最高） | `0` |
| `--bpu-cores` | BPU 核心索引列表 | `[0]` |
| `--nms-thres` | NMS 阈值 | `0.45`（检测）/ `0.7`（分割、姿态） |
| `--score-thres` | 置信度阈值 | `0.25` |
| `--alpha-f` | 分割掩码透明度（仅 UNet） | `0.75` |
| `--kpt-conf-thres` | 关键点显示阈值（仅姿态） | `0.5` |

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/classification_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/classification_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/pose_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/pose_sample）

`--priority` 和 `--bpu-cores` 这两个参数是 3.5.0 新增的能力，底层对应 `hbm_runtime` 的 `set_scheduling_params()`。在 pyeasy_dnn 时代没有对应接口 —— 这是判断一段示例代码属于哪个年代的一个快速识别点。

### 示例的实际输出长什么样

分类示例跑完打印 Top-5：

```
Top-5 Predictions:
zebra: 0.9936
tiger, Panthera tigris: 0.0039
hartebeest: 0.0007
tiger cat: 0.0007
impala, Aepyceros melampus: 0.0003
```

检测示例打印检出的目标列表：

```
检测到 18 个目标: person(0.86), person(0.79), person(0.67), ... kite(0.88), kite(0.84), ...
[Saved] Result saved to: result.jpg
```

分割示例会打印模型的调度参数：

```
=== Model Name List ===
['yolo11n_seg_bayese_640x640_nv12']
=== Model Count ===
1
=== Input Counts ===
yolo11n_seg_bayese_640x640_nv12: 1
...
=== Scheduling Parameters ===
yolo11n_seg_bayese_640x640_nv12:
  priority : 0
  customId : 0
  bpu_cores : [0]
  deviceId : 0
[Saved] Result saved to: result.jpg
```

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/classification_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/classification_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample）

`Scheduling Parameters` 那段输出是 3.5.0 独有的 —— 它来自 `model.sched_params`。看到这段输出，就能确定这段日志是在 3.5.0 及以上系统上跑的。

## 一条完整的自检链路

把前面所有内容串成一个可执行的检查顺序，遇到「模型跑不起来」按这个顺序走，不要跳步：

1. **确认系统版本**：`cat /etc/version` 与 `rdkos_info`。3.5.0 与 3.4.1 的 Python 接口完全不同（见第二章）。
2. **确认模型的 march**：用 `hrt_model_exec model_info` 或看转换日志，`bayes-e` 才对。
3. **确认输入输出类型**：`tensorType` 是 1（NV12）还是 13（S8）/14（F32），是否和你代码里期望的一致。
4. **确认子图数量**：转换日志里 `Model has N BPU subgraph`，N 越大越慢。
5. **确认 BPU 是否真的在算**：推理时 `cat /sys/devices/system/bpu/bpu0/ratio`，如果接近 0 说明瓶颈不在 BPU。
6. **确认端到端各段耗时**：不要只看总帧率，要拆成预处理 / 推理 / 后处理三段。

第 2 步的版本不一致会给出这样的警告，它不一定导致崩溃，但一定要处理：

```
[W][DNN]bpu_model_info.cpp:491][Version] Model: yolov5s_v2_672x672_bayese_nv12.
Inconsistency between the hbrt library version 3.15.55.0 and the model build version 3.15.47.0 detected,
in order to ensure correct model results, it is recommended to use compilation tools and the BPU SDK from the same OpenExplorer package.
```

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）

原始报错一字未改，注意它把 `[Version]` 和 `Model:` 拼在了一起，搜索时要按 `Inconsistency between the hbrt library version` 这段找。

## 常见误区

**误区一：把 10 TOPS 当成「模型一定能跑到的算力」。** 10 TOPS 是 INT8 峰值，且只算 BPU。一个模型只要有 30% 的算子回退到 CPU，或者有大量 CPU↔BPU 数据搬运，端到端性能与这个数字就没什么关系了。看性能先看 `bpu0/ratio`，不要看标称值。

**误区二：认为 Model Zoo 的 bin 是通用模型文件。** 每个 `.bin` 都绑定了一个具体的 ONNX 结构、一套具体的输入输出 shape 和类型、一套具体的前后处理约定。拿官方 bin 配自己的后处理，或者反过来，都会失败甚至段错误。

**误区三：看到 `Unsupported op` 就以为转换失败。** 官方明确说「若模型整体性能可满足需要，您可以忽略该日志」。真正要关注的是这个算子是否在关键路径上、它带来的 CPU↔BPU 切换数据量有多大 —— 回退一个末端 Softmax 和回退一个主干 Gather 是完全不同的代价。

**误区四：把 `march` 填成 `bayes` 或 `bernoulli2`。** X5 是 `bayes-e`，`bayes` 是 RDK Ultra，`bernoulli2` 是 X3。填错的模型在 X5 上加载会失败或行为异常。官方在社区问答里把四个平台的代号并列过一次，可以直接对照。

**误区五：以为「BPU 单核」意味着性能上限低。** 单核影响的是「多模型能不能真并发」，不影响单模型性能。社区有实测 4 个 yolov5nu 模型做到 30fps 的案例，靠的是模型足够小 + 时间分片流水线，而不是硬件并发。

> 来源：社区帖 35342（https://forum.d-robotics.cc/t/topic/35342）

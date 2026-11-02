---
id: 03-AI推理与工具链-03-模型转换与hb_mapper
volume: 3
volume_title: AI 推理与工具链
title: 模型转换与 hb_mapper
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [hb_mapper, ONNX, opset, yaml, 算子回退]
summary: OE 工具链 Docker 环境、hb_mapper 三段脚本流程、yaml 逐项配置、ONNX 导出约束（opset 10/11）、算子回退 CPU 的判读。
source_policy: "official-first, community-verified"
---
# 3.3 模型转换与 hb_mapper

## 本章解决什么

这一章讲清楚一件事：一个 PyTorch 训练出来的浮点模型，怎么变成 RDK X5 能跑的 `.bin` 定点模型。核心工具是 `hb_mapper`，它跑在 x86 开发机的 Docker 容器里，**不在板子上**。

内容分四块：工具链环境怎么搭、`hb_mapper` 的三个子命令各干什么、yaml 四组参数逐项拆解、以及 ONNX 导出阶段就能提前避掉的坑。最后用一张报错表覆盖转换阶段的高频失败。

看完你应该能做到：独立写完一份 yaml，跑通 `checker → makertbin` 全流程，并且看懂转换日志里哪一行是真正的问题。

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）
> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

## 3.3.1 环境：Docker 是唯一被官方支持的转换环境

### 3.3.1.1 版本对应关系

X5 的工具链版本是 **V1.2.8**，它对应 RDK X5 系统软件 3.5.0。官方原文：

> 「该版本对应 RDK X5 系统软件 3.5.0 版本，用户可在板端执行 `cat /etc/version` 命令确认系统软件版本号。」

> 来源：官方文档 Advanced_development/toolchain_development/rdk_x5/oe_toolchain_v1_2_8（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/rdk_x5/oe_toolchain_v1_2_8）

下载地址（官方原文给出，可直接复制）：

```bash
# OE 开发工具包
wget https://d-robotics-aitoolchain.oss-cn-beijing.aliyuncs.com/oe_x5/1.2.8/D-Robotics_x5_open_explorer_v1.2.8-py310_20240926.tar.gz

# CPU Docker 镜像
wget https://d-robotics-aitoolchain.oss-cn-beijing.aliyuncs.com/oe_x5/1.2.8/docker_openexplorer_ubuntu_20_x5_cpu_v1.2.8.tar.gz

# GPU Docker 镜像
wget https://d-robotics-aitoolchain.oss-cn-beijing.aliyuncs.com/oe_x5/1.2.8/docker_openexplorer_ubuntu_20_x5_gpu_v1.2.8.tar.gz
```

> 来源：官方文档 Advanced_development/toolchain_development/rdk_x5/oe_toolchain_v1_2_8（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/rdk_x5/oe_toolchain_v1_2_8）

**不要用 X3 的工具链转 X5 的模型。** X3 是 V2.6.6、X5 是 V1.2.8，版本号完全不同，`march` 也不同（`bernoulli2` vs `bayes-e`）。

### 3.3.1.2 起容器

社区教程给出的完整启动命令（含挂载）：

```bash
docker run -it --rm --gpus all --shm-size=15g \
  -v "$ai_toolchain_package_path":/open_explorer \
  -v "$dataset_path":/data \
  openexplorer/ai_toolchain_ubuntu_20_x5_gpu:v1.2.8-py310
```

三个参数都不能省：

| 参数 | 作用 | 省略的后果 |
| --- | --- | --- |
| `--gpus all` | 让容器用上宿主 GPU | 量化校准阶段走 CPU，慢十几倍 |
| `--shm-size=15g` | 共享内存 15GB | 校准大批量数据时容器被杀 |
| `-v .../OE:/open_explorer` | 挂载 OE 包 | 容器内找不到 `samples/` 和工具链产物 |

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

容器里 `hb_mapper` 有输出，就说明环境装好了。

### 3.3.1.3 一个官方明确回答过的疑问

> 「算法工具链的 Docker 镜像是基于 Ubuntu 20.04 制作的，这会影响转换产物（如 .bin 或 .hbm 模型文件）在 RDK 板端 Ubuntu 22.04 系统上运行吗？」
> 「通常**不会影响**……它生成的模型文件（如 .bin 用于 PTQ，.hbm 用于 QAT）是针对 RDK 板卡上特定 BPU 架构的二进制指令和权重数据。这些模型文件本身与运行它们的 RDK 板卡操作系统的 Ubuntu 版本是解耦的，只要板卡上的 Runtime 库（如 `libdnn.so` 等 BPU 驱动和推理库）与模型转换时使用的工具链版本兼容即可。」

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）Q5

关键词是「与工具链版本兼容即可」。Ubuntu 版本不重要，**工具链版本和板端 Runtime 版本要对得上**。对不上的典型症状是板端加载时刷这条警告：

```
[W][DNN]bpu_model_info.cpp:491][Version] Model: xxx.
Inconsistency between the hbrt library version 3.15.55.0 and the model build version 3.15.47.0 detected,
in order to ensure correct model results, it is recommended to use compilation tools and the BPU SDK from the same OpenExplorer package.
```

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）

## 3.3.2 hb_mapper 的三个子命令

`hb_mapper` 不是一个工具，是三个：

| 子命令 | 干什么 | 什么时候用 |
| --- | --- | --- |
| `hb_mapper checker` | 检查 ONNX 是否合法、算子是否支持、估算子图数 | **每次转换前必跑** |
| `hb_mapper makertbin` | 完整转换：校准 → 量化 → 编译，产出 `.bin` | 主体步骤 |
| `hb_mapper debug`（部分版本） | 逐层对比量化误差 | 精度排查时用 |

### 3.3.2.1 checker：先验证再转换

官方命令形式：

```bash
hb_mapper checker --model-type onnx \
  --march bayes-e \
  --model /path/to/model.onnx
```

参数说明（Caffe 场景会多两个）：

| 参数 | 说明 |
| --- | --- |
| `--model-type` | `caffe` 或 `onnx` |
| `--march` | `bernoulli2`(X3) / `bayes`(Ultra) / **`bayes-e`(X5)** |
| `--proto` | 仅 caffe，prototxt 文件 |
| `--model` | 模型文件名 |
| `--input-shape` | 可选，显式指定输入 shape，格式 `{input_name} {NxHxWxC}` |
| `--output` | 可选，指定输出 |

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

checker 的输出价值在两点：**子图数量和算子落点**。社区帖 33301 就是用 checker 抓到问题的：

```bash
hb_mapper checker --model-type onnx --march bayes-e --model /data/models/yolo11n.onnx > checker_log.txt
grep -i "softmax" checker_log.txt
```

输出：

```
/model.10/m/m.0/attn/Softmax   CPU  --  Softmax  --  1.0  float
```

一个 Softmax 落在 CPU，就把模型切成两个 BPU 子图，实测从 100+ FPS 掉到 7.67 FPS。

> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

所以**养成习惯：checker 跑完先 grep 一遍 CPU 和 subgraph**，不要等上板才发现。

### 3.3.2.2 makertbin：两种用法

**用法一：走 yaml 配置**

```bash
hb_mapper makertbin --config yolov5_detect_bayese_640x640_nv12.yaml --model-type onnx
```

**用法二：fast-perf 模式**

```bash
hb_mapper makertbin --fast-perf \
  --model yolov5s.onnx \
  --model-type onnx \
  --march bayes-e
```

官方对 fast-perf 的描述：「该模式开启后，会在转换过程中生成可以在板端运行最高性能的 bin 模型」。fast-perf 下还需要额外给 `--model`、`--march`（Caffe 还要 `--proto`）。

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

两者的差别在于：fast-perf 会自动删掉模型首尾不必要的 CPU 算子（Transpose、Cast、Reshape 之类），强制更多算子留在 BPU。代价是**它会改动模型结构**，如果你的后处理严格依赖某个输出节点的 layout，fast-perf 之后可能对不上。生产环境建议先用 yaml 精确控制，fast-perf 用来做性能上限探测。

### 3.3.2.3 转换产物长什么样

`makertbin` 结束后，`working_dir` 下会有一批文件：

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `*_original_float_model.onnx` | 加了 HzPreprocess 的浮点模型 | 精度排查第 2 步 |
| `*_optimized_float_model.onnx` | 图优化后的浮点模型 | 精度排查第 3 步 |
| `*_calibrated_model.onnx` | 校准后（阈值已定）的模型 | 精度排查第 4 步 |
| `*_quantized_model.onnx` | 量化后模拟模型 | 精度排查第 5 步，与 bin 对拍 |
| `*.bin` | 上板模型 | 部署 |
| `*_quant_info.json` | 逐节点余弦相似度 | 定位敏感层 |
| `hb_mapper_makertbin.log` | 完整日志 | 提问题时必附 |

> 来源：社区帖 34983（https://forum.d-robotics.cc/t/topic/34983）转换日志中出现的产物名

`hb_mapper_makertbin.log` 里有一份关键信息，出问题要第一时间贴出来：

```
Dump config:
calibration_parameters:
  cal_data_dir: ./calibration_data_120
  cal_data_type: float32
  calibration_type: default
  max_percentile: 0.99999
  per_channel: true
compiler_parameters:
  compile_mode: latency
  debug: true
  max_time_per_fc: 1000
  optimize_level: O3
input_parameters:
  input_layout_rt: NHWC
  input_layout_train: NHWC
  input_name: ''
  input_type_rt: featuremap
  input_type_train: featuremap
  norm_type: no_preprocess
model_parameters:
  layer_out_dump: false
  march: bayes-e
  onnx_model: ./motionbert_lite_120.onnx
  output_model_file_prefix: motionbert_lite
  working_dir: motionbert_lite_model_output
```

这段是**工具实际使用的配置**，不是你写的 yaml 原文。两者不一致时（比如 yaml 里写了但被忽略），以这里为准。

> 来源：社区帖 34983（https://forum.d-robotics.cc/t/topic/34983）

## 3.3.3 yaml 逐项拆解

yaml 分四组，四组都必须存在，缺一组直接报错。这是社区教程反复强调的：

> 「大家要注意配置文件中，四个参数组位置都需要存在，具体参数分为可选和必选，可选参数可以不配置。」

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

### 3.3.3.1 第一组：model_parameters

```yaml
model_parameters:
  onnx_model: './best.onnx'
  march: 'bayes-e'
  layer_out_dump: False
  working_dir: './model_output'
  output_model_file_prefix: 'obstacle'
  node_info: {
    "Resize_220": {'ON': 'BPU', 'InputType': 'int8', 'OutputType': 'int8'}
  }
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `onnx_model` | ✅ | ONNX 浮点模型路径 |
| `march` | ✅ | X5 固定 `bayes-e` |
| `layer_out_dump` | | `True` 时输出每层中间结果，**调精度时开，部署时关** |
| `working_dir` | | 产物目录 |
| `output_model_file_prefix` | | 产物文件名前缀 |
| `node_info` | | 逐算子指定运行位置与数据类型（见下） |
| `set_all_node_int16` | | 全局 int16（社区文档提到，用于精度排查） |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）「RDK X5 ONNX 模型量化 yaml 文件模板」

`node_info` 是调性能与精度的核心开关，格式是**节点名 → 属性字典**：

```yaml
# 强制某算子跑 BPU（用于性能）
node_info: {
  "Resize_220": {'ON': 'BPU', 'InputType': 'int8', 'OutputType': 'int8'}
}

# 强制某算子跑 CPU（用于精度）
node_info: {
  "Conv_170": {'ON': 'CPU'},
  "ScatterND_337": {'ON': 'CPU'}
}

# 某算子用 int16（用于精度）
node_info: {
  "/model.10/m/m.0/attn/Softmax": {'ON': 'BPU', 'InputType': 'int16', 'OutputType': 'int16'}
}
```

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）
> 来源：社区帖 34824（https://forum.d-robotics.cc/t/topic/34824）
> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

**怎么拿到节点名？** 三个办法：

```bash
# 方法一：Netron 打开 ONNX / calibrated_model.onnx 直接看
# 方法二：Python 列出来
python3 -c "
import onnx
m = onnx.load('model.onnx')
for n in m.graph.node:
    if 'Softmax' in n.op_type:
        print(f'{n.name} -> {n.op_type}')
"
# 方法三：从转换日志的算子表里抄
grep "Cosine Similarity" hb_mapper_makertbin.log | sort -k5 -n | head -20
```

节点名必须与 ONNX 里的 `name` **完全一致**，差一个字符就匹配不上，工具只会给一条警告然后忽略：

```
WARNING node: { Gemm_128 : None} does not exist, please double check your input
```

> 来源：社区帖 34578（https://forum.d-robotics.cc/t/topic/34578）

### 3.3.3.2 第二组：input_parameters

这是四组里最容易配错的一组，直接决定量化的成败。

```yaml
input_parameters:
  input_name: 'images'
  input_type_rt: 'nv12'
  input_type_train: 'rgb'
  input_layout_train: 'NCHW'
  input_layout_rt: 'NHWC'
  input_shape: '1x3x640x640'
  norm_type: 'data_scale'
  scale_value: '0.003921568627451'
```

| 字段 | 必填 | 可选值 | 说明 |
| --- | --- | --- | --- |
| `input_name` | ✅ | — | ONNX 的输入节点名 |
| `input_type_rt` | | `nv12` / `rgb` / `bgr` / `yuv444` / `featuremap` | **板端**实际喂进来的格式 |
| `input_type_train` | ✅ | `rgb` / `bgr` / `gray` / `featuremap` / `yuv444` | **训练时**数据的格式 |
| `input_layout_train` | ✅ | `NHWC` / `NCHW` | 训练时 layout |
| `input_layout_rt` | | `NHWC` / `NCHW` | 板端 layout；`input_type_rt=nv12` 时**不要配** |
| `input_shape` | | `1x3x640x640` | 不填则从 ONNX 读 |
| `norm_type` | ✅ | `no_preprocess` / `data_mean` / `data_scale` / `data_mean_and_scale` | 预处理方式 |
| `mean_value` | 条件 | 空格分隔 | `data_mean` / `data_mean_and_scale` 时必填 |
| `scale_value` | 条件 | 空格分隔 | `data_scale` / `data_mean_and_scale` 时必填 |
| `input_batch` | | 整数 | 多 batch 时用 |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）「RDK X5 ONNX 模型量化 yaml 文件模板」

`norm_type` 的四个取值含义，官方写得很明确：

| 值 | 行为 | 需要配的字段 |
| --- | --- | --- |
| `no_preprocess` | 不做任何操作 | 不配 mean / scale |
| `data_mean` | 减去通道均值 | 只配 `mean_value`，注释掉 `scale_value` |
| `data_scale` | 像素乘以系数 | 只配 `scale_value`，注释掉 `mean_value` |
| `data_mean_and_scale` | 先减均值再乘系数 | 两个都配 |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

**`scale_value` 的计算公式是 `scale = 1/std`**，官方模板注释里写的就是这句。YOLO 标准的 `1/255` 对应 `0.003921568627451`。

这里有一个必须理解透的机制：**工具链会把 `input_type_rt → input_type_train` 的转换做成模型里的一个 `HzPreprocess` 节点**。官方在精度调优章节解释过：

> 「由于 HzPreprocess 节点的存在，会使得转换后的模型其预处理操作可能会和原始模型有所不同，该算子是在进行模型转换时，根据 yaml 配置文件中的配置参数（`input_type_rt`、`input_type_train` 以及 `norm_type`、`mean_value`、`scale_value`）来决定是否为模型加入 HzPreprocess 节点」

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

所以配了 `scale_value: 0.003921568627451` 之后，**板端喂进去的应该是 0~255 的原始像素值，不是归一化后的 0~1**。这一条是社区最致命的坑，下一节单独讲。

### 3.3.3.3 第三组：calibration_parameters

```yaml
calibration_parameters:
  cal_data_dir: './calib_f32'
  cal_data_type: 'float32'
  calibration_type: 'max'
  max_percentile: 0.99996
  per_channel: False
  preprocess_on: False
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `cal_data_dir` | ✅ | 校准数据目录；多输入时用 `;` 分隔多个目录 |
| `cal_data_type` | | `float32` / `uint8` 等 |
| `calibration_type` | | `default` / `max` / `kl` / `mix` / `skip` / `ml` |
| `max_percentile` | | 仅 `max` 用；常见 `0.99999` / `0.9999` / `0.9995` / `0.999` |
| `per_channel` | | 逐通道校准 |
| `preprocess_on` | | `True` 时自动用 skimage 读图并 resize 到输入尺寸 |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

`preprocess_on` 值得单独说。它确实方便 —— 开了之后直接把 jpg 扔进 `cal_data_dir` 就行，工具自动读图、resize。但社区教程给了明确建议：

> 「虽然这个参数很方便但是依旧建议阅读官方用户手册和 OE 包中的示例自己写一个数据处理的代码」

> 来源：社区帖 28624（https://forum.d-robotics.cc/t/topic/28624）

原因是 `preprocess_on` 的 resize 用 skimage，插值方式、配色通道转换都不一定和你的训练预处理一致。校准数据的分布一旦偏了，量化阈值就偏了，精度就掉了 —— 而这个偏差在转换日志里**看不出来**。

### 3.3.3.4 第四组：compiler_parameters

```yaml
compiler_parameters:
  compile_mode: 'latency'
  debug: False
  core_num: 1
  optimize_level: 'O3'
  input_source: {'input': 'ddr'}
  hbdk_pass_through_params: '--O3 --core-num 1 --fast'
```

| 字段 | 说明 |
| --- | --- |
| `compile_mode` | `latency`（低延迟，单帧快）或 `throughput`（高吞吐，批量快） |
| `debug` | 开调试信息，**部署必须 `False`** |
| `core_num` | 核心数；X5 只支持 1 |
| `optimize_level` | `O0`/`O1`/`O2`/`O3`，默认 `O3` |
| `input_source` | 输入从哪喂，`ddr` 或 `pyramid` |
| `hbdk_pass_through_params` | 透传给底层 `hbdk-cc` 的参数 |

`input_source` 是一个容易被忽略但影响很大的字段。社区帖 35444 的日志里，YOLO 类图像输入的模型显示：

```
input-source: {'images': 'pyramid', '_default_value': 'ddr'}
```

而 featuremap 输入的模型是：

```
input_source: {'input': 'ddr'}
```

`pyramid` 是给 NV12 图像输入用的硬件通路，`ddr` 是普通内存。**featuremap 输入必须用 `ddr`**，社区的说明是「featuremap 输入通常从 DDR 喂入」。

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

`compile_mode` 的选择，社区实测数据是 `latency` 比 `throughput` 在单帧场景快约 15%。

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

## 3.3.4 ONNX 导出：转换失败的源头在这里

一半以上的 `hb_mapper` 报错，根子不在 `hb_mapper`，在导出的 ONNX 本身。

### 3.3.4.1 硬约束一：opset 只能是 10 或 11

官方原文：

> 「支持 caffe 1.0 版本的 caffe 浮点模型和 ir_version≤7 、 opset10 、 opset11 版本的 onnx 浮点模型量化」

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

超出范围的报错原文：

```
ERROR The opset version of the onnx model is n, only model with opset_version 10/11 is supported
```

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

社区里还有一条更容易误解的变体，它来自 onnxruntime 而不是 hb_mapper：

```
ERROR [ONNXRuntimeError] : 9 : NOT_IMPLEMENTED : could not find a implementation for the node of `{op_name}`:{op_type}(opset)
```

官方的解释是「模型 opset 版本超出工具链支持限制，请重新导出模型，确保 `opset_version=10` 或者 `11`」。

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

**opset 11 不是万能的。** 社区帖 32970 记录了一个具体的死结：

```
RuntimeError: /github/workspace/onnx/version_converter/adapters/no_previous_version.h:26:
adapt: Assertion false failed: No Previous Version of LayerNormalization exists
```

> 来源：社区帖 32970（https://forum.d-robotics.cc/t/topic/32970）

`LayerNormalization` 是 opset 17 才引入的算子，在 opset 11 里根本没有，所以「降到 11」这一步本身就会失败。遇到这种算子，正确做法不是调 opset，而是**在模型定义里把它拆成 `ReduceMean/Sub/Pow/Sqrt/Div`** 这类基础算子 —— 这些在 BPU 支持列表里。

### 3.3.4.2 硬约束二：输入必须固定 4 维，N=1

```python
# 正确
torch.onnx.export(model, dummy, "m.onnx",
                  input_names=['images'],
                  output_names=['output'],
                  opset_version=11,
                  dynamic=False)      # 静态 shape
```

`dynamic=True`、`dynamic_axes` 一律不要用。报错原文：

```
ERROR The shape of model input:input is [xxx] which has dimensions of 0. Please specify input-shape parameter.
```

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

非四维输入的报错：

```
WARNING input shape [xxx] has length: n
ERROR list index out of range
```

官方建议「将模型输入修改至四维（例如 HxW -> 1x1xHxW）」。

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

### 3.3.4.3 硬约束三：输出层不要带解码和 NMS

官方明确要求「浮点模型中不要包含有后处理算子，例如：nms 计算」。

> 来源：官方文档 Advanced_development/toolchain_development/overview（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/toolchain_development/overview）

YOLO 系列的标准做法是自定义 `forward`，只输出卷积原始特征图，把 DFL 解码和 Sigmoid 留给板端后处理：

```python
# 从 YOLO head 里剥离解码：6 输出（3 个 bbox + 3 个 cls），保持 NCHW
def new_forward(self, x):
    result = []
    for i in range(self.nl):
        bbox = self.cv2[i](x[i])      # (B, 64, H, W)
        cls  = self.cv3[i](x[i])      # (B, nc, H, W)
        result.append(bbox)
        result.append(cls)
    return result

head.forward = types.MethodType(new_forward, head)

torch.onnx.export(
    model.model, dummy, ONNX_PATH,
    input_names=['images'],
    output_names=['bbox_P3', 'cls_P3', 'bbox_P4', 'cls_P4', 'bbox_P5', 'cls_P5'],
    opset_version=11,
    do_constant_folding=True,
)
```

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

这个帖子把「为什么不能直接用 `model.export()`」解释得很清楚：

> 「Ultralytics 默认导出会把 DFL（Distribution Focal Loss）解码和 Sigmoid 包含在 ONNX 图中。这些操作在 BPU 上量化效果极差（DFL 中的 Softmax 会被放到 CPU 上执行，导致模型被分割成十几个子图，推理速度骤降）。」

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

### 3.3.4.4 一个必须做对的细节：NCHW 还是 NHWC

同样是 YOLO 导出，社区帖 34084 的作者踩过一个坑并留下了明确结论：

> 「之前我在导出时加了 `.permute(0,2,3,1)` 转成 NHWC，导致输出 shape 变成 `(1,80,80,64)` 而不是 `(1,64,80,80)`。而官方 rdk_model_zoo 中所有能正常检测的模型都是 **NCHW 格式**。虽然 BPU 可以处理 NHWC，但后处理代码（reshape 方式）与 NCHW 是强耦合的。**不做 permute，保持 NCHW** 是最安全的做法。」

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

但注意：社区帖 33301 的作者给出的方案是**加 permute 转 NHWC**，且那个方案跑通了 47 FPS。两份教程在这里**直接矛盾**。

判断依据：两者其实都对，差别在配套的后处理。34084 用的是自己写的、按 NCHW 索引的后处理；33301 用的是按 NHWC 索引的后处理。**唯一不能做的是「导出用 A 格式、后处理按 B 格式解析」。** 选一种，全链路统一。

官方文档对 YOLOv5 的建议是倾向于 NHWC：

> 「推荐的做法是在导出 ONNX 模型时，将输出转换为明确的四维张量（例如 NHWC 格式：`[batch, grid_h, grid_w, num_anchors*(5+num_classes)]`），并且在板端的后处理代码中，再根据这个 NHWC 的输出格式进行正确的解析和解码」

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）Q9

**官方口径与本仓库建议**：官方推荐 NHWC（因为 BPU 内部高效布局是 NHWC），但社区大量跑通的案例是 NCHW。落地时优先跟着**你选的那份 Model Zoo 示例**走，不要混搭。

### 3.3.4.5 一个可以直接抄的导出模板

```python
import torch, onnx
from ultralytics import YOLO

model = YOLO('yolo11n.pt')
dummy = torch.randn(1, 3, 640, 640)

torch.onnx.export(
    model.model, dummy, 'yolo11n.onnx',
    input_names=['images'],
    output_names=['output0'],
    opset_version=11,      # X5 只支持 10/11
    dynamic=False,         # 静态 shape
    do_constant_folding=True,
)

# 导出后立刻自检，不要等 hb_mapper 报错
m = onnx.load('yolo11n.onnx')
print("IR Version:", m.ir_version)                    # 应为 6
print("Opset Version:", m.opset_import[0].version)    # 应为 11
print("输入数量:", len(m.graph.input))                 # 应为 1
print("输出数量:", len(m.graph.output))
softmax = [n.name for n in m.graph.node if n.op_type == 'Softmax']
print("Softmax 节点:", softmax)                        # 越少越好
```

> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

## 3.3.5 转换阶段报错速查

下面按官方 FAQ 的原文顺序整理，报错文本一字未改。

### 3.3.5.1 checker 阶段

| 报错原文 | 根因 | 处置 |
| --- | --- | --- |
| `ERROR The shape of model input:input is [xxx] which has dimensions of 0. Please specify input-shape parameter.` | 输入是动态 shape | 加 `--input-shape input_name input_shape` |
| `ERROR HorizonRT not support these cpu operators: {op_type}` | 用了不支持的 CPU 算子 | 按算子表替换；核心算子需联系官方 |
| `Unsupported op {op_type}` | 用了不支持的 BPU 算子 | **性能够就可忽略**；否则替换算子 |
| `ERROR nodes:['{op_type}'] are specified as domain:xxx, which are not supported by official onnx...` | 自定义算子 | 替换为官方算子，或参考自定义 CPU 算子注册 |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

### 3.3.5.2 makertbin 阶段

| 报错原文 | 根因 | 处置 |
| --- | --- | --- |
| `Layer ... expect data shape range:[[xxx][xxx]], but the data shape is [xxx]` | 算子超限，回退 CPU | 性能可接受就忽略；否则改 shape 到 BPU 支持范围 |
| `INFO： Layer ... will be executed on CPU` | CxHxW 超过 8192 | 替换为无 shape 限制的 BPU 算子 |
| `Start to parse the onnx model` 后 `core dump` | 导出时只给部分 output/input 指定了 name | 重导：不指定 name，或每个都指定 |
| `ERROR model conversion faild: Inferred shape and existing shape differ in dimension x: (n) vs (m)` | ONNX 输入 shape 非法或优化 pass 有误 | 先确认 ONNX 本身能正常推理 |
| `WARNING got unexpected input/output/sumin threshold on conv ...! value: xxx` | 预处理有误，或该节点 weight 太小/太大 | 检查预处理；用 BN 优化数据分布 |
| `ERROR hbdk-cc compile hbir model failed with returncode -n` | 编译失败 | 收模型 + log 给官方 |
| `ERROR {op_type} only support 4 dim input` | 该 op 输入非四维 | 调整为四维 |
| `ERROR {op_type} Not support this attribute/mode=xxx` | 不支持该属性 | 按算子表替换 |
| `ERROR There is no node can execute on BPU in this model, please make sure the model has at least one conv node which is supported by BPU.` | 模型没有可量化的 BPU 节点 | 确保至少有一个 BPU 支持的 conv |
| `ERROR tool limits for max output num is 32` | 输出节点超 32 | 控制在 32 以内 |
| `ERROR xxx file parse failed.` / `ERROR xxx does not exist in xxx.` | 环境配置不对 | 用官方 Docker 环境 |
| `ERROR exception in command: makertbin.` / `ERROR cannot reshape array of size xxx into shape xxx.` | 数据预处理异常 | 核对预处理配置 |
| `ERROR load cal data for input xxx error` / `ERROR cannot reshape array of size xxx into shape xxx` | 工具链版本不匹配 | 用 SDK 对应版本 |
| `ERROR No guantifiable nodes were found, and the model is not supported` | 模型结构里没有输出节点 | 检查 ONNX 输出 |
| `ERROR There is an error in pass:constant_folding. Error message: Could not find an implementation for the node ...` | 该算子 onnxruntime 不支持 | 按算子表替换 |

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）「hb_mapper checker」「hb_mapper makertbin」两节

`run_on_bpu` 相关的报错值得单独提：

> 「`run_on_bpu` 暂仅支持指定模型尾部的 Relu/Softmax/pooling（maxpool、avgpool 等）算子以及 CPU*+Transpose 组合（可通过声明 Transpose 节点名称，将 CPU*+Transpose 都运行在 BPU 上）」

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

也就是说 `run_on_bpu` 不是什么算子都能往 BPU 上塞，只有末端激活、池化、以及 Transpose 组合。这解释了为什么社区里把 `Gather`、`ScatterElements` 强行标 BPU 往往不生效。

## 3.3.6 校准数据：最容易做错的一步

转换流程里唯一「错了也不报错」的环节，就是校准数据。

### 3.3.6.1 尺寸和格式必须与 yaml 严格一致

社区帖 34084 的作者把这个坑标成「★★★ 最致命」。他的 yaml 配置是：

```yaml
input_type_rt: 'nv12'
input_type_train: 'rgb'
input_layout_train: 'NCHW'
norm_type: 'data_scale'
scale_value: '0.003921568627451'
```

这段配置的语义是（原文照抄）：

> 「- BPU 会自动做 ×(1/255) 归一化
> - 所以校准数据应该是 **0~255 范围的原始像素值**
> - 颜色通道是 **RGB**（不是 BGR）
> - Layout 是 **NCHW**」

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

于是他之前「校准脚本里 `/255` 一次 + BPU 的 `scale_value` 再一次」等价于 `pixel / 65025`，后果是：

> 「量化后的 cls 输出全部崩塌为强负数（max≈-10~-21），sigmoid 后全部为 0，一个检测框都出不来。而且这个错误**不会在量化过程中报错**，Chebyshev distance 看起来还不错，只有在板端推理时才会发现问题。」

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

### 3.3.6.2 校准数据自检脚本

生成校准数据后必须验证分布，这是唯一能在转换前拦住问题的手段：

```python
import numpy as np, os

cal_dir = "./calibration_f32"
files = sorted([f for f in os.listdir(cal_dir) if f.endswith('.f32')])
print("Total files:", len(files))

data = np.fromfile(os.path.join(cal_dir, files[0]), dtype=np.float32)
print("元素数:", data.size, " 应为 3*640*640 =", 3*640*640)
data = data.reshape(3, 640, 640)
print(f"Min:  {data.min():.1f}")    # 应接近 0
print(f"Max:  {data.max():.1f}")    # 应接近 255！接近 1.0 就是做了错误的 /255
print(f"Mean: {data.mean():.1f}")   # 应在 100~140
```

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

**判据只有一条：`max` 接近 255 才算对。** `max` 接近 1.0 说明你多做了一次归一化。

### 3.3.6.3 数量与多样性

官方模板的注释写的是：「图片来源一般是从测试集中选择 100 张图片，并要覆盖典型场景，不要是偏僻场景，如过曝光、饱和、模糊、纯黑、纯白等图片」。

> 来源：官方文档 FAQ/toolchain（https://developer.d-robotics.cc/rdk_x_doc/FAQ/toolchain）

社区的实践经验是「20-100 张（推荐 100 张）」，并且强调「场景：覆盖实际应用场景」。

> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

对于时序模型或 Transformer，100 张往往不够。社区帖 34983 的 MotionBERT 案例用了 50 条校准数据，被指出「50 条对时序 Transformer 模型严重不足」，建议提到 300~500 条。

> 来源：社区帖 34983（https://forum.d-robotics.cc/t/topic/34983）

### 3.3.6.4 多输入模型的校准数据

多输入时 `cal_data_dir` 用分号分隔多个目录，顺序必须与 `input_name` 一致：

```yaml
input_name: "decorated_voxels;coors_4d"
cal_data_dir: '../calibration_data/decorated_voxels_f32;../calibration_data/coors_4d_f32'
cal_data_type: 'float32;float32'
```

日志里能看到工具逐个目录读取：

```
created RawImageDirLoader of shape:[1, 9, 50, 6000]
created RawImageDirLoader of shape:[1, 4, 6000, 1]
```

> 来源：社区帖 35444（https://forum.d-robotics.cc/t/topic/35444）

形状对不上的话，报错是 `ERROR cannot reshape array of size xxx into shape xxx`。

## 3.3.7 两个语法陷阱

### 3.3.7.1 run_on_cpu 的写法

官方文档（以及多数示例）用的是 `calibration_parameters` 下的 `run_on_cpu`。社区帖 34578 记录了一次完整的失败-修正过程，结论反直觉：

用户按 `run_on_cpu: {"Gemm_128"}` 写，报：

```
WARNING node: { Gemm_128 : None} does not exist, please double check your input
```

改成 `run_on_cpu: ["Gemm_128"]`（方括号列表）依然被解析成一个节点名。用户最后总结：

> 「我只有这样配置才能让工具链找到节点，用 `{}`，`[]` 设置复数节点都只会解析成一个节点」

最终能工作的写法是**不带任何括号**：

```yaml
calibration_parameters:
  run_on_cpu: Gemm_128
```

> 来源：社区帖 34578（https://forum.d-robotics.cc/t/topic/34578）

这与官方文档的口径不一致（官方示例里写的是带括号的字典/列表形式）。判断：**这是不同工具链版本对 yaml 解析器的差异**。稳妥做法是先用单个算子不加括号试一次，能识别再加更多；或者直接用 `model_parameters.node_info` 的 `{'ON': 'CPU'}` 形式，那个形式在多个社区帖里都验证可用（见 34824、34885）。

### 3.3.7.2 node_info 的缩进与引号

`node_info` 是 yaml 里唯一一个内嵌 JSON 风格的字段，两种写法都有人用：

```yaml
# 块状（多行）
node_info: {
  "Resize_220": {'ON': 'BPU', 'InputType': 'int8', 'OutputType': 'int8'}
}

# 单行（节点多时更易读）
node_info: {"Resize_220": {'ON': 'BPU', 'InputType': 'int8', 'OutputType': 'int8'}}
```

社区日志里能看到工具把 yaml 解析成的最终结构：

```
node_info:
  Resize_220:
    InputType: int8
    'ON': BPU
    OutputType: int8
```

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

注意 `'ON'` 被 yaml 解析后带了引号 —— 因为 `ON`/`OFF` 在 YAML 1.1 里是布尔值。写的时候**必须给 `ON` 加引号**成 `'ON'`，否则会被解析成 `True`，导致节点配置被静默忽略。

## 3.3.8 一个最小可跑的完整流程

把上面所有内容压成一份可执行清单：

```bash
# 1. 宿主准备（一次性）
export version=v1.2.8
export ai_toolchain_package_path=/path/to/horizon_x5_open_explorer_v1.2.8-py310_20240926
export dataset_path=/path/to/dataset
docker load < docker_openexplorer_ubuntu_20_x5_gpu_v1.2.8.tar.gz

# 2. 起容器
docker run -it --rm --gpus all --shm-size=15g \
  -v "$ai_toolchain_package_path":/open_explorer \
  -v "$dataset_path":/data \
  openexplorer/ai_toolchain_ubuntu_20_x5_gpu:v1.2.8-py310

# === 以下在容器内 ===

# 3. 先检查 ONNX
hb_mapper checker --model-type onnx --march bayes-e --model /data/models/best.onnx \
  | tee checker.log
grep -iE "cpu|subgraph" checker.log | head -20   # 重点看这两类

# 4. 转换
hb_mapper makertbin --model-type onnx --config /data/config.yaml

# 5. 检查产物
ls -lh model_output/
hrt_model_exec model_info --model_file model_output/best.bin
```

第 3 步的 `grep` 是关键动作 —— 它能提前暴露「模型会被切成几个子图」「哪些算子在 CPU」，避免上板之后才发现性能不对。

## 常见误区

**误区一：`hb_mapper` 是板端工具。** 它跑在 x86 开发机的 Docker 里，板子上没有也不会装。社区帖 34523 里有用户去找「板子上的 hb_mapper」，答案是不可得。

> 来源：社区帖 34523（https://forum.d-robotics.cc/t/topic/34523）

**误区二：看到校准数据 `max` 接近 1.0 也以为没问题。** 这是最隐蔽的坑 —— 转换全程不报错，`Chebyshev distance` 看着也正常，只有上板推理才发现输出全是负数。判据是 `max` 应接近 255。

**误区三：把 `norm_type: data_scale` 和「校准数据自己归一化」同时做。** 这两件事是同一件事，做两遍就是除以 255 两次。要么让 BPU 做（配 `scale_value`，校准数据保持 0~255），要么自己做（配 `no_preprocess`，校准数据是 0~1）。不能既配 `scale_value` 又自己归一化。

**误区四：以为 opset 11 一定能导出。** `LayerNormalization` 这类新算子在 opset 11 里不存在，「降到 11」这一步本身就会崩在 `No Previous Version of LayerNormalization exists`。正确做法是把算子拆成基础算子，而不是调 opset 数字。

**误区五：`node_info` 里写 `ON: BPU` 而不加引号。** YAML 1.1 里 `ON` 是布尔真值，不加引号会被解析成 `True`，你的节点配置静默失效，日志里也不报错 —— 只能通过 `Dump config` 段确认实际生效的配置。

**误区六：`core_num` 填大于 1。** X5 只支持 `core_num: 1`。社区帖 34885 的配置注释直接写着「X5 仅支持 1」。填 2 不会给你双倍性能，只会让编译报错或被忽略。

> 来源：社区帖 34885（https://forum.d-robotics.cc/t/topic/34885）

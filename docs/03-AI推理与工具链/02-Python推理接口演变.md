---
id: 03-AI推理与工具链-02-Python推理接口演变
volume: 3
volume_title: AI 推理与工具链
title: Python 推理接口演变
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [hbm_runtime, pyeasy_dnn, bpu_infer_lib, 版本分界, 迁移]
summary: pyeasy_dnn（≤3.4.1）→ bpu_infer_lib（过渡，已停维护）→ hbm_runtime（3.5.0+）三代断代、能力矩阵、数据类型与 stride、迁移坑与示例目录对照。
source_policy: "official-first, community-verified"
---
# 3.2 Python 推理接口演变

## 本章解决什么

RDK X5 的 Python 推理接口在三年里换过三次，而且三次的分界线都不是「小版本升级」，是**互不兼容的断代**。这一章把三代接口的时间线、代码差异、迁移陷阱逐条拆开。

看完你应该能回答：我手上这段代码属于哪一代？在什么系统版本上能跑？换成当前版本要改哪几行？以及为什么照着网上教程抄代码会报 `ModuleNotFoundError`。

这一章是本卷最容易写错、也最容易读错的一章，**所有代码块都标注了适用版本**，抄之前先确认自己的系统版本。

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）
> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

## 3.2.1 三代接口的完整时间线

先把结论摆在前面，避免中途绕晕：

| 代际 | 包 / 模块 | 典型导入语句 | 适用 RDKOS 版本 | 现状 |
| --- | --- | --- | --- | --- |
| 第一代 | `hobot_dnn.pyeasy_dnn` | `from hobot_dnn import pyeasy_dnn as dnn` | X5 上 3.5.0 **之前**（3.0.0 ~ 3.4.1） | 3.5.0 起被替代 |
| 过渡代 | `bpu_infer_lib` | `from bpu_infer_lib import Infer` | 短暂存在过 | **已停止维护** |
| 第二代 | `hbm_runtime` | `from hbm_runtime import HB_HBMRuntime` | X5 上 **3.5.0（2026-04）及以上** | 当前唯一官方接口 |

**必须强调的一点**：`hbm_runtime` 不是 `pyeasy_dnn` 的别名，不是它的封装，也不是「同一个东西改了个名字」。两者是**两个独立实现、两套 API 形状、两套数据约定**。把 `hbm_runtime` 写成 `pyeasy_dnn` 的别名是本仓库明确禁止的错误。

### 3.2.1.1 分界线一：pyeasy_dnn 的时代

官方在 X3 的接口手册里对 pyeasy_dnn 的定位写得很清楚：

> 「pyeasy_dnn 是底层 DNN 推理能力的 C++ 封装实现，对外暴露轻量的 Python 接口，核心包含模块级模型加载方法、Model 对象推理方法，以及 TensorProperties 张量属性获取三类能力。该接口适配 RDK X3 以及 **RDK X5（软件版本 3.5.0 之前）**系列硬件平台的神经网络推理场景。」

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn）

注意括号里那句「软件版本 3.5.0 之前」—— 这是官方自己写的版本界碑，不是社区推测。

它的 API 只有三样东西：

| 类别 | API | 作用 |
| --- | --- | --- |
| 模块级 | `load` | 加载模型文件，返回 Model 推理对象 |
| Model 对象 | `forward` | 执行模型推理，输入张量数据，返回输出张量对象 |
| TensorProperties | `tensor_type` / `dtype` / `layout` / `shape` / `alignedShape` / `validShape` / `scale_data` | 只读张量属性 |

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn）

**注意 `hobot_dnn` 与 `pyeasy_dnn` 的关系**：`hobot_dnn` 是包名，`pyeasy_dnn` 是它下面的子模块。所以永远写 `from hobot_dnn import pyeasy_dnn as dnn`，而不是 `import pyeasy_dnn`。这个细节在第三章讲 `hobot_dnn` 的 C++ 侧时还会再出现一次 —— TROS 的 C++ 推理框架也叫 `hobot_dnn`，同名但不同物。

### 3.2.1.2 分界线二：bpu_infer_lib 的短暂存在

在 pyeasy_dnn 和 hbm_runtime 之间，还短暂存在过一个叫 `bpu_infer_lib` 的接口。它现在已经不能用了，官方在社区给出的答复非常直接：

> 「由于 bpu_infer_lib 已停止维护，新模型及推理流程全面迁移至 hbm_runtime 库，请更新 rdk 系统版本到 3.5.0 以上」

> 来源：社区帖 34823（https://forum.d-robotics.cc/t/topic/34823），发言者为社区技术支持

这条帖子里还有一个非常典型的报错，属于「接口与系统版本错配」的样本，原文照抄：

```
[BPU_PLAT]Make sure inst Suport (X5) Platform!!
[BPU_PLAT]Incompatible Platform!!
[BPU_PLAT]FC Parse error!
[BPU_PLAT]Calloc fc space failed!
[BPU_PLAT]core mask[0x1] write fc to hw failed[-2]!!
[E][DNN][funccall_handle.cpp:141][Schedule](2026-04-21,21:44:10.779.322) hb_bpu_core_set_fc_prio failed! error code: -2
```

用户的系统是 RDKOS 3.0.0，模型是用 1.24.3 工具链新编的。模型本身没问题（`hrt_model_exec model_info` 能正常打印），但 `bpu_infer_lib` 在 3.0.0 上调不动新模型。

这个案例的教训不止「换接口」：**报错发生在 forward 阶段而不是 load 阶段**。`load: True` 之后才崩，说明「模型能加载」不等于「模型能推理」。排查时要看完整日志，不能看到 `load: True` 就以为成功。

> 来源：社区帖 34823（https://forum.d-robotics.cc/t/topic/34823）

### 3.2.1.3 分界线三：RDKOS 3.5.0 统一为 hbm_runtime

官方的版本发布说明写得很硬：

> 「自 3.5.0 版本起，Python 算法推理、目标检测、语义分段等模块**统一升级为 hbm_runtime 接口**。该接口基于 pybind11 实现，提供对 libdnn C++ 库的高效访问，支持高性能模型加载与神经网络推理。」
> 「基于新版 hbm_runtime 接口，对 `/app/pydev_demo/` 下所有示例完成**全量重写**，确保接口统一、性能最优、使用更简洁。」
> 「RDK 文档已基于 hbm_runtime 与 `/app/pydev_demo/` 全新示例完成**全面修订**，与最新版本完全对齐。」

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）版本号 3.5.0，发布日期 2026 年 4 月

接口手册开头也重申了一遍：

> 「RDK X5 3.5.0 版本之后，使用 Python 进行算法推理、目标检测、语义分割等部分，全升级为 hbm_runtime 接口，该接口是基于 pybind11 的 Python 绑定接口，用于访问和操作 libdnn C++ 库」

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

这里有个容易读漏的因果：**接口换了 → 示例全量重写了 → 文档也全面修订了**。所以 3.5.0 之后你在官网上看到的 Python 示例，和 3.4.1 时代网上流传的示例，**连文件路径都不一样**。

## 3.2.2 三代代码逐行对照

### 3.2.2.1 pyeasy_dnn 版（RDKOS ≤ 3.4.1）

```python
# 仅适用于 RDKOS 3.5.0 之前的 X5（以及 X3 全系）
from hobot_dnn import pyeasy_dnn as dnn

# 加载模型：返回值是一个 Model 列表
models = dnn.load('/opt/hobot/model/x5/basic/resnet18_224x224_nv12.bin')
model = models[0]

# 查看输入属性
print(model.inputs[0].shape)
print(model.inputs[0].dtype)
print(model.inputs[0].layout)
print(model.inputs[0].scale_data)

# 推理：inputs 是列表，元素为 numpy 数组或字节流
outputs = model.forward([nv12_data])

# 取输出：outputs 是 TensorProperties 列表，数值在 .buffer 里
buf = np.array(outputs[0].buffer)
print(outputs[0].properties.shape)
```

接口签名来自官方手册：

```
model = dnn.load(model_path, **kwargs)
output_tensors = model.forward(inputs, **kwargs)
```

官方对 `forward` 的参数说明是：「inputs：模型推理输入数据列表，列表中每个元素为 numpy 数组 / 字节流，形状、数据类型需匹配模型输入张量定义」，返回值是「TensorProperties 对象列表，每个对象包含输出张量的数值和属性（shape/dtype 等）」。

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn）

社区代码里能看到的实际用法与此一致。比如性能测试脚本：

```python
# 仅适用于 RDKOS 3.5.0 之前的 X5
from hobot_dnn import pyeasy_dnn as dnn
models = dnn.load('yolo11n_detect_bayese_640x640_nv12.bin')
model = models[0]
outputs = model.forward(nv12_data)
```

> 来源：社区帖 33301（https://forum.d-robotics.cc/t/topic/33301）

注意这里 `model.forward(nv12_data)` 传的是裸数组而不是 `[nv12_data]` —— 单输入模型两种写法都能跑，这本身就是 pyeasy_dnn 的一个宽松之处，也是迁移到 hbm_runtime 时最容易踩空的差异之一。

取输出数值的社区写法：

```python
# 仅适用于 RDKOS 3.5.0 之前的 X5
outputs = model.forward(nv12)
for i, out in enumerate(outputs):
    buf = np.array(out.buffer)
    if buf.shape[1] == 1:      # cls 分支
        print(f"cls[{i}]: max={buf.max():.4f}")
```

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

`out.buffer` 是 pyeasy_dnn 独有的取数方式，hbm_runtime 里没有这个概念。

### 3.2.2.2 hbm_runtime 版（RDKOS ≥ 3.5.0）

```python
# 仅适用于 RDKOS 3.5.0 及以上的 RDK X5
import numpy as np
from hbm_runtime import HB_HBMRuntime

# 加载模型：构造即加载，返回运行时对象
model = HB_HBMRuntime("/opt/hobot/model/x5/basic/resnet18_224x224_nv12.bin")

# 模型名 → 输入名 → shape，三级字典
model_name = model.model_names[0]
input_name = model.input_names[model_name][0]
input_shape = model.input_shapes[model_name][input_name]

# 构造输入
input_tensor = np.ones(input_shape, dtype=np.float32)

# 推理：返回 Dict[str, Dict[str, np.ndarray]]
outputs = model.run(input_tensor)

# 取输出：二级字典直接给 numpy 数组
output_array = outputs[model_name]
print("Output:", output_array)
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）「单模型单输入推理」

三处结构性差异，需要单独拎出来：

**差异一：加载语义不同。** `dnn.load()` 返回 Model 列表（一个 `.bin` 一个 Model，但也可能返回多个）；`HB_HBMRuntime(path)` 返回一个运行时对象，里面可以装一个或多个模型。

**差异二：所有元信息都变成两级字典。** pyeasy_dnn 是 `model.inputs[0].shape`，hbm_runtime 是 `model.input_shapes[model_name][input_name]`。形状是「模型名 → 输入名 → shape」，因为一个运行时对象可以同时装多个模型。

**差异三：输出直接是 numpy 数组。** pyeasy_dnn 要 `np.array(out.buffer)` 再读 `out.properties`；hbm_runtime 的 `run()` 返回 `Dict[str, Dict[str, np.ndarray]]`，外层键是模型名、内层键是输出张量名、值就是数组。

### 3.2.2.3 多模型 / 多输入：hbm_runtime 的新能力

pyeasy_dnn 时代要跑多模型，得自己用 Python 线程调度。hbm_runtime 直接把多模型封装进了构造函数：

```python
from hbm_runtime import HB_HBMRuntime

model = HB_HBMRuntime(["model1.bin", "model2.bin"])
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

三个多输入场景的 `run()` 重载，签名分别是：

```python
run(input_tensor: np.ndarray, **kwargs) -> Dict[str, Dict[str, np.ndarray]]
run(input_tensors: Dict[str, np.ndarray], **kwargs) -> Dict[str, Dict[str, np.ndarray]]
run(multi_input_tensors: Dict[str, Dict[str, np.ndarray]], **kwargs) -> Dict[str, Dict[str, np.ndarray]]
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

官方对多模型并行推理的描述需要留意：

> 「对于多模型输入场景，底层自动采用多线程机制并行执行每个模型的推理任务（multi-threaded launch），在多核 BPU 系统上可获得更高吞吐（**单核 BPU 底层还是串行执行**）。」

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

这句括号很重要。X5 的 BPU 是单核（见第一章），所以「多线程并行」在 X5 上不会真的让两个模型同时在 BPU 上算，它优化的是「CPU 后处理与 BPU 计算重叠」。不要指望靠多模型加载把吞吐翻倍。

### 3.2.2.4 调度参数：pyeasy_dnn 没有，hbm_runtime 有了

这是 hbm_runtime 相对 pyeasy_dnn 最大的一项能力增量：

```python
def set_scheduling_params(
    priority: Optional[Dict[str, int]] = None,
    bpu_cores: Optional[Dict[str, List[int]]] = None,
    custom_id: Optional[Dict[str, int]] = None,
    device_id: Optional[Dict[str, int]] = None
) -> None
```

| 参数 | 说明 |
| --- | --- |
| `priority` | 每个模型的调度优先级，通常 0～255，**数值越高优先级越高** |
| `bpu_cores` | 绑定的 BPU 核心索引列表，默认自动分配 |
| `custom_id` | 自定义优先级（时间戳、frame id 等），**数值越小优先级越高**；优先级顺序 `priority > customId` |
| `device_id` | 指定模型运行在哪个设备上 |

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

注意 `priority` 和 `custom_id` 的方向是**相反**的：priority 大者优先，customId 小者优先。这个反直觉的设计是迁移时最常见的调错项 —— 按 priority 的习惯去设 customId，结果正好调反。

`bpu_cores` 还有一个约定：返回 `-1` 表示由调度器自动分配。官方示例日志里能看到：

```
# Model: yolov5nu_detect_nashe_640x640_nv12
# priority: 66
# bpu_cores: [-1]
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

## 3.2.3 迁移时最常见的坑

下面每一条都在社区里被真实踩过，按踩到的频率排序。

### 3.2.3.1 坑一：`ModuleNotFoundError`，两个方向都会撞

3.5.0 系统上跑旧代码：

```
ModuleNotFoundError: No module named 'hobot_dnn'
```

3.4.1 系统上跑新代码：

```
ModuleNotFoundError: No module named 'hbm_runtime'
```

第二个报错连官方文档的 FAQ 里都收录了：

> Q：运行示例时出现 "ModuleNotFoundError: No module named 'hbm_runtime'" 错误怎么办？
> A：请确保已正确安装 RDK 的 Python 环境，hbm_runtime 模块等官方提供的专用推理库。

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/classification_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/classification_sample）

**这里有一处官方文档内部的口径冲突，必须指出来。** 同一批 3.5.0 文档里，`classification_sample`、`instance_segment_sample`、`pose_sample`、`open_instance_segment_sample` 的 FAQ 写的都是 `hbm_runtime`，但 `detection_sample` 的 FAQ 仍然写的是旧接口：

> Q: 运行示例时出现 "No module named 'hobot_dnn'" 错误怎么办？

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）

而这份文档正文里明确写着「用于演示如何使用 hbm_runtime 模块进行目标检测任务」，API 流程里列的是 `hbm_runtime.HB_HBMRuntime(model_path)`。**判断依据：以文档正文的 API 说明为准，FAQ 那条是从 X3 版页面复制过来没改干净的残留。** 在 3.5.0 上你应该装 `hbm_runtime`，`hobot_dnn` 的 Python 子模块已经不在新示例的依赖里。

### 3.2.3.2 坑二：`dnn.load()` 返回的是列表，忘了取 `[0]`

pyeasy_dnn：

```python
models = dnn.load(path)
model = models[0]          # 必须取下标
```

hbm_runtime：

```python
model = HB_HBMRuntime(path)   # 直接就是运行时对象，不需要取下标
```

从 pyeasy_dnn 迁到 hbm_runtime 时如果保留 `[0]`，会得到 `TypeError` 或者拿到一个语义不对的对象；反过来迁移时会拿到列表却当成模型用，报 `AttributeError`。这两个方向都要改这一行。

### 3.2.3.3 坑三：输出的取数方式完全不同

| | pyeasy_dnn | hbm_runtime |
| --- | --- | --- |
| 返回类型 | `TensorProperties` 列表 | `Dict[str, Dict[str, np.ndarray]]` |
| 取数值 | `np.array(tensor.buffer)` | 直接是 ndarray |
| 取形状 | `tensor.properties.shape` 或 `tensor.shape` | `output_shapes[model][name]` |
| 取量化参数 | `tensor.scale_data` | `output_quants[model][name].scale / .zero_point` |

pyeasy_dnn 把「数值」和「属性」分成 `.buffer` 与 `.properties` 两块；hbm_runtime 把数值塞进 dict、把属性单独挂在 `output_shapes` / `output_quants` 上。迁移时「照抄后处理」一定会崩在这一步。

### 3.2.3.4 坑四：反量化（dequantize）从「隐式」变成「显式」

这是最隐蔽、后果最严重的差异。

pyeasy_dnn 时代，输出张量的量化参数挂在 `scale_data` 上，很多示例直接读 buffer 当 float 用（因为模型输出层常常已经带 Dequantize 节点）。

hbm_runtime 则要求你自己反量化。官方 3.5.0 的目标检测示例里，API 流程明确列出了一步：

```
dequantize_outputs(outputs, output_quants)
```

说明是「结果反量化，输入：模型输出，指定类型，返回：反量化后的结果」。

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）

`output_quants` 的结构与量化参数定义：

```python
output_quanti = model.output_quants
for model_name, outputs in output_quanti.items():
    for name, info in outputs.items():
        print("quant_type:", info.quant_type.name)
        print("quantize_axis:", info.axis)
        print("scale_data:", info.scale)
        print("zero_point_data:", info.zero_point)
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

`QuantParams` 有四个属性：`scale`（np.ndarray，量化比例因子）、`zero_point`（np.ndarray，零点）、`quant_type`（`hbDNNQuantiType` 枚举）、`axis`（per-channel 量化时的量化轴）。量化类型只有两种：`NONE`（非量化）和 `SCALE`（线性缩放量化）。

**反量化的标准公式**是 `float = (int_value - zero_point) * scale`。如果模型输出已经是 `F32`（`quant_type` 为 `NONE`），就不需要反量化 —— 直接乘一次 scale 反而会把结果乘坏。判断依据是 `output_quants` 里的 `quant_type`，不是「有没有 scale 值」。

社区里有一整类「量化后精度全崩」的问题，根子就在这里：删了 Dequantize 节点却没自己做反量化，输出值域变成 `[-300000, -8000]` 这种纯 int32 累加器数值。

> 来源：社区帖 35445（https://forum.d-robotics.cc/t/topic/35445）

### 3.2.3.5 坑五：`/app/pydev_demo/` 路径全变了

3.5.0 的「全量重写」不只是改代码，连目录名都改了。对照如下：

| 任务 | 3.4.1 及以前的路径 | 3.5.0 之后的路径 |
| --- | --- | --- |
| 图像分类 | `/app/pydev_demo/01_basic_sample/` | `/app/pydev_demo/01_classification_sample/` |
| 目标检测 | `/app/pydev_demo/07_yolov5_sample/` | `/app/pydev_demo/02_detection_sample/` |
| 实例分割 | （旧版另列） | `/app/pydev_demo/03_instance_segmentation_sample/` |
| 姿态估计 | （旧版另列） | `/app/pydev_demo/04_pose_sample/` |
| 开放域实例分割 | — | `/app/pydev_demo/05_open_instance_seg_sample/` |
| 语义分割 | （旧版另列） | `/app/pydev_demo/06_segment_sample/` |
| USB 摄像头 | `/app/pydev_demo/07_yolov5_sample/` | `/app/pydev_demo/07_usb_camera_sample/` |

> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X3/basic_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X3/basic_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/detection_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/detection_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/instance_segment_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/pose_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/pose_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/open_instance_segment_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/open_instance_segment_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/segment_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/segment_sample）
> 来源：官方文档 Basic_Application/pydev_demo_sample/RDK_X5/usb_camera_sample（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/pydev_demo_sample/RDK_X5/usb_camera_sample）

旧版 X3 文档里 `01_basic_sample` 下是一堆 `test_*.py`（`test_resnet18.py`、`test_mobilenetv1.py` 等）；3.5.0 的 X5 文档里 `01_classification_sample` 下是两个子目录 `01_resnet18/`、`02_mobilenetv2/`，每个目录里放 `resnet18.py`、`mobilenetv2.py`。文件名、目录层级、启动方式（`python xxx.py` 前要先 `cd` 进子目录）全都变了。

**照着 3.4.x 时代的教程在 3.5.0 上找文件，会找不到。** 这不是教程写错了，是它写的那个版本已经不存在了。

### 3.2.3.6 坑六：featuremap 多通道输入在旧接口上不完善

这一条不太算「迁移坑」，更像「不该迁移的时候别硬撑」。

社区帖 34824 的用户在 3.0.0 上部署一个 5 通道 featuremap 输入的模型，`quantized_model.onnx` 精度正常，`.bin` 上板后精度严重失真。官方回复：

> 「原接口对 featuremap 兼容不好，所以推出了接口」

> 来源：社区帖 34824（https://forum.d-robotics.cc/t/topic/34824），发言者为社区技术支持

用户升级到 3.5.0 之后，结论是：

> 「目前 RDK 系统由 3.0.0 升级到 3.5.0 版本后，板端部署的精度与 `*_quantized_model.onnx` 量化模型精度基本一致；核心问题在于：当前系统版本是初始版本，对于 featuremap 数据的输入支持比较差」

> 来源：社区帖 34824（https://forum.d-robotics.cc/t/topic/34824）

这说明：**3.5.0 换接口不只是「改写法」，还修好了旧接口在特定输入类型上的能力缺失。** 如果你在旧系统上遇到「ONNX 正常、bin 异常、转换日志也没报错」，先怀疑是不是这一类，而不是先怀疑自己的后处理。

### 3.2.3.7 坑七：把 Python 接口和 C++ 接口混为一谈

一个高频困惑是：官方文档一会儿说用 `hbm_runtime`，一会儿又提到 `hobot_dnn`，到底哪个。

答案是**两套并行，按语言分**：

| 语言 | 3.5.0 之前 | 3.5.0 及以后 |
| --- | --- | --- |
| Python | `hobot_dnn.pyeasy_dnn` | `hbm_runtime` |
| C++（原生） | `libdnn` / `hobot_dnn` C++ 头文件 | **不变** |
| C++（TROS） | `hobot_dnn`（TROS 的推理框架包） | **不变** |

3.5.0 的发布说明只提「Python 算法推理、目标检测、语义分段等模块统一升级为 hbm_runtime 接口」，没有提 C++。TROS 侧的 `hobot_dnn` 包仍然存在并持续更新 —— 3.4.1 的更新记录里还有「修复板端模型推理框架：hobot_dnn 统计推理延迟错误的问题」。

> 来源：官方文档 Release_Note/release_note（https://developer.d-robotics.cc/rdk_x_doc/Release_Note/release_note）

所以看到「Python 用 `hbm_runtime`、C++ 用 `hobot_dnn`」不要以为是矛盾，这是分工。

## 3.2.4 一张迁移检查表

从 pyeasy_dnn 迁到 hbm_runtime，按这个顺序改，改完一条划一条：

| # | 检查项 | 旧 | 新 |
| --- | --- | --- | --- |
| 1 | 系统版本 | `cat /etc/version` 输出 ≤ 3.4.1 | 需 ≥ 3.5.0 |
| 2 | 导入 | `from hobot_dnn import pyeasy_dnn as dnn` | `from hbm_runtime import HB_HBMRuntime` |
| 3 | 加载 | `models = dnn.load(p)` → `models[0]` | `model = HB_HBMRuntime(p)` |
| 4 | 输入 shape | `model.inputs[0].shape` | `model.input_shapes[m][n]` |
| 5 | 输入 dtype | `model.inputs[0].dtype` | `model.input_dtypes[m][n]`（枚举，需映射） |
| 6 | 推理调用 | `model.forward(data)` | `model.run(data)` |
| 7 | 输出取值 | `np.array(out.buffer)` | `results[m][name]` |
| 8 | 反量化 | 读 `scale_data`，多数情况可省 | 必须查 `output_quants[m][n].quant_type`，`SCALE` 时手动反量化 |
| 9 | 优先级 | 无 | `model.set_scheduling_params(priority={...}, bpu_cores={...})` |
| 10 | 示例路径 | `/app/pydev_demo/01_basic_sample/` | `/app/pydev_demo/01_classification_sample/` |

第 5 项要特别说明：`input_dtypes` 返回的是 `hbDNNDataType` 枚举对象，不是 numpy 类型。官方示例里给了一张映射表：

```python
hb_dtype_map = {
    "U8": np.uint8,
    "S8": np.int8,
    "F32": np.float32,
    "F16": np.float16,
    "U16": np.uint16,
    "S16": np.int16,
    "S32": np.int32,
    "U32": np.uint32,
}
# 用法
np_dtype = hb_dtype_map.get(input_dtypes[name].name, np.float32)
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

注意取的是 `.name` 字符串再查表，不是直接拿枚举当 dtype 用。另外 NV12 输入（`NV12` 枚举）不在通用映射表里，它的 numpy 表达是 `uint8` 的扁平数组，需要单独处理。

## 3.2.5 三代接口的能力对照

把三代接口放在一张表里横向对比，能更清楚地看出为什么要换。

| 能力 | pyeasy_dnn | bpu_infer_lib | hbm_runtime |
| --- | --- | --- | --- |
| 加载单个模型 | ✅ `dnn.load()` 返回列表 | ✅ `Infer().load_model()` | ✅ `HB_HBMRuntime(path)` |
| 加载多个模型 | ❌ 需自行管理 | ❌ | ✅ 传 list |
| 单模型多输入 | ✅ `forward([a, b])` | ✅ 按索引 `read_numpy_arr_*(x, i)` | ✅ 传 dict |
| 多模型多输入 | ❌ | ❌ | ✅ 传二级 dict |
| 查询输入 shape | ✅ `model.inputs[0].shape` | ✅ 加载日志打印 | ✅ `input_shapes[m][n]` |
| 查询输出 shape | ✅ `out.properties.shape` | ✅ 日志打印 | ✅ `output_shapes[m][n]` |
| 读取量化参数 | ✅ `scale_data`（只有 scale） | ❌ | ✅ `QuantParams`（scale + zero_point + quant_type + axis） |
| 指定推理优先级 | ❌ | ❌ | ✅ `set_scheduling_params(priority=)` |
| 绑定 BPU 核心 | ❌ | ❌ | ✅ `set_scheduling_params(bpu_cores=)` |
| 指定设备 | ❌ | ❌ | ✅ `set_scheduling_params(device_id=)` |
| 输出直接是 ndarray | ❌ 需 `np.array(buf)` | ✅ `get_infer_res_np_float32()` | ✅ |
| 数据类型枚举 | 字符串（`"float32"`） | 无 | ✅ `hbDNNDataType` |
| featuremap 多通道输入 | ⚠️ 支持不完善 | ❌ | ✅ |

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X3/pydev_multimedia_api_x3/object_pyeasy_dnn）
> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）
> 来源：社区帖 34823（https://forum.d-robotics.cc/t/topic/34823）

表里最值得注意的三行是：**多模型加载、调度参数、量化参数完整度**。这三项不是「写法不同」，是 pyeasy_dnn 时代**做不到**的能力。所以 3.5.0 的升级对复杂部署场景是能力增量，不只是改名。

`featuremap 多通道输入` 那一行的「支持不完善」，来自官方人员对 3.0.0 系统上 featuremap 模型精度异常的答复（详见本章「坑六」）。

### 3.2.5.1 数据类型枚举的实际用法

`hbm_runtime` 的 `hbDNNDataType` 是一个完整的枚举，官方列出的取值有 17 个：

| 枚举值 | 含义 |
| --- | --- |
| `Y` | 1-bit unsigned |
| `S4` / `U4` | 4-bit signed / unsigned |
| `S8` / `U8` | 8-bit signed / unsigned |
| `NV12` | 12-bit unsigned（NV12 图像） |
| `F16` / `S16` / `U16` | 16-bit float / signed / unsigned |
| `NV12_SEPARATE` | 16-bit unsigned |
| `YUV444` | 24-bit unsigned |
| `F32` / `S32` / `U32` | 32-bit float / signed / unsigned |
| `F64` / `S64` / `U64` | 64-bit float / signed / unsigned |
| `MAX` | 保留字段 |

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

注意 `NV12` 是整个枚举里唯一的「图像格式」而不是「数值类型」—— 它表示这个张量承载的是一帧 NV12 图像（Y 平面 + UV 交织平面），numpy 表达是扁平 `uint8` 数组，不是三维张量。这也是为什么官方的 dtype 映射表里没有 `NV12` 这一项：

```python
hb_dtype_map = {
    "U8": np.uint8, "S8": np.int8,
    "F32": np.float32, "F16": np.float16,
    "U16": np.uint16, "S16": np.int16,
    "S32": np.int32, "U32": np.uint32,
}
# NV12 不在表里，因为它不是标量数值类型
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

写映射代码时如果只按表查，遇到 NV12 输入会拿到默认值 `np.float32`，然后把 uint8 的 NV12 数据当 float 送进去，结果是一片乱码。正确做法是先判 `NV12`：

```python
def resolve_np_dtype(dtype_enum) -> np.dtype:
    name = dtype_enum.name
    if name in ("NV12", "NV12_SEPARATE", "YUV444"):
        return np.uint8        # 图像格式一律按 uint8 处理
    return hb_dtype_map.get(name, np.float32)
```

### 3.2.5.2 张量 stride 的含义

`hbm_runtime` 提供了 `input_strides` / `output_strides`，这是 pyeasy_dnn 完全没有的信息。官方示例里的输出是：

```
{'yolov5x_672x672_nv12': {'data_uv': [-1, -1, 2, 1], 'data_y': [-1, -1, 1, 1]}}
```

> 来源：官方文档 Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/multi_media_sp_dev_api/RDK_X5/pydev_multimedia_api_x5/ai-python-api）

官方对 stride 的说明是「stride 的详细含义可参考 OE 文档中 `hbDNNTensorProperties` 中的描述」，并给了 `-1` 的特殊含义：**`-1` 表示该维度是连续的，按 `alignedShape` 自动推算**。

这个信息什么时候有用？当你需要**避免一次拷贝**、把 numpy 数据直接按硬件期望的内存布局写进去时。多数场景用不上，但只要涉及零拷贝或自己管理 buffer，就必须看 stride —— 因为对齐后的内存布局（`alignedShape`）和逻辑形状（`validShape`）可能不一致，宽度不是 32 对齐时要补 padding。

## 3.2.6 版本与接口的组合矩阵

实际工程里，「我的板子是什么版本、我的代码是哪一代、我的模型是哪一年编的」这三件事经常对不齐。下面这张表列出所有常见组合及结果。

| RDKOS | 代码代际 | 模型编译工具链 | 结果 |
| --- | --- | --- | --- |
| ≤3.4.1 | pyeasy_dnn | 同期版本 | ✅ 正常 |
| ≤3.4.1 | pyeasy_dnn | 更新的工具链 | ⚠️ 加载有版本警告，可能行为异常 |
| ≤3.4.1 | hbm_runtime | 任意 | ❌ `ModuleNotFoundError` |
| 3.5.0+ | pyeasy_dnn | 任意 | ❌ `ModuleNotFoundError: No module named 'hobot_dnn'` |
| 3.5.0+ | hbm_runtime | 同期版本 | ✅ 正常 |
| 3.5.0+ | hbm_runtime | 更旧的工具链 | ⚠️ 版本警告，可能正常 |
| 3.0.0 | bpu_infer_lib | 新工具链 | ❌ `[BPU_PLAT]Incompatible Platform!!` |

> 来源：社区帖 35476（https://forum.d-robotics.cc/t/topic/35476）
> 来源：社区帖 34823（https://forum.d-robotics.cc/t/topic/34823）
> 来源：社区帖 34523（https://forum.d-robotics.cc/t/topic/34523）

第三行和第四行是「完全跑不起来」，排查成本最低（看报错就知道）；第二行和第六行是「能跑但有警告」，最容易被忽略 —— 因为程序没崩，但结果可能不对。

社区帖 34523 里就有一个真实的版本错配：模型编译版本 1.24.3，板端运行时 1.23.10，模型能加载（`Outputs: 6` 正常打印），但推理时 `exit code -11`。

> 来源：社区帖 34523（https://forum.d-robotics.cc/t/topic/34523）

所以「能加载」这个信号不足以下结论，必须跑通一次完整推理。

## 3.2.7 迁移实例：一段 YOLOv11 检测代码的前后对比

把散落在各处的差异集中到一个具体例子上。这是一段**只用官方文档记载的 API 重写的对照**，不是从某个真实项目直接抄的。

### 3.2.7.1 1（pyeasy_dnn）

```python
import numpy as np, cv2
from hobot_dnn import pyeasy_dnn as dnn

# --- 加载 ---
models = dnn.load('/opt/hobot/model/x5/basic/yolo11n_detect_bayese_640x640_nv12.bin')
model  = models[0]

# --- 输入元信息 ---
in_shape = model.inputs[0].shape      # (1, 3, 640, 640)
in_dtype = model.inputs[0].dtype      # 字符串，如 'uint8'
in_layout = model.inputs[0].layout    # 'NCHW'

# --- 预处理：BGR -> NV12 ---
img   = cv2.imread('kite.jpg')
nv12  = bgr_to_nv12(letterbox(img, 640))

# --- 推理 ---
outputs = model.forward([nv12])

# --- 取输出 ---
raw = []
for out in outputs:
    buf = np.array(out.buffer)
    scale = out.scale_data
    raw.append((buf, scale, out.properties.shape))

# --- 后处理（自己按 outputs 的索引组织）---
dets = decode_outputs_by_index(raw)
```

### 3.2.7.2 0（hbm_runtime）

```python
import numpy as np, cv2
from hbm_runtime import HB_HBMRuntime, hbDNNQuantiType

# --- 加载 ---
model = HB_HBMRuntime('/opt/hobot/model/x5/basic/yolo11n_detect_bayese_640x640_nv12.bin')
mname = model.model_names[0]

# --- 输入元信息（三级取值）---
in_names  = model.input_names[mname]
in_shapes = model.input_shapes[mname]
in_dtypes = model.input_dtypes[mname]

# --- 推理前置：设置调度（pyeasy_dnn 没有这一步）---
model.set_scheduling_params(
    priority={mname: 100},
    bpu_cores={mname: [0]},
)

# --- 预处理：BGR -> NV12 ---
img  = cv2.imread('kite.jpg')
nv12 = bgr_to_nv12(letterbox(img, 640))

# --- 组装输入 dict ---
inputs = {}
for name in in_names:
    shape = in_shapes[name]
    inputs[name] = nv12.reshape(shape)   # NV12 是扁平 uint8，按 shape 重整

# --- 推理 ---
results = model.run(inputs)

# --- 取输出 + 反量化（新增的一步）---
fp32 = {}
for name, tensor in results[mname].items():
    qp = model.output_quants[mname][name]
    if qp.quant_type == hbDNNQuantiType.SCALE:
        fp32[name] = (tensor.astype(np.float32) - qp.zero_point) * qp.scale
    else:
        fp32[name] = tensor.astype(np.float32, copy=False)

# --- 后处理（按输出名组织，不是按索引）---
dets = decode_outputs_by_name(fp32)
```

### 3.2.7.3 逐行差异表

| 行 | 3.4.1 | 3.5.0 | 为什么 |
| --- | --- | --- | --- |
| 加载 | `dnn.load()` → 列表 | `HB_HBMRuntime()` → 对象 | 构造即加载 |
| 模型名 | 无此概念 | 必须先取 `model_names[0]` | 支持多模型 |
| 输入名 | 无此概念 | `input_names[mname]` | 支持多输入 |
| shape | `model.inputs[0].shape` | `input_shapes[mname][name]` | 结构从链式变成字典 |
| 调度 | 无 | `set_scheduling_params()` | 新增能力 |
| 输入形式 | 列表 `[arr]` | dict `{name: arr}` | 按名字对应 |
| 输出形式 | 列表，按序 | dict，按名 | 不依赖顺序 |
| 反量化 | 可选（读 `scale_data`） | **必须判 `quant_type`** | 元信息更完整，责任交给你 |
| 后处理组织 | 按索引 | 按名字 | 名字比顺序稳定 |

最后一行值得强调：**按输出名遍历比按索引硬编码更稳。** 社区帖 34084 的作者踩过一个坑：

> 「BPU 编译器可能重排输出顺序。不要硬编码 `outputs[0]` 一定是 `bbox_P3`。解决方案：按 shape 动态匹配，C=64 的是 bbox，C=nc 的是 cls。」

> 来源：社区帖 34084（https://forum.d-robotics.cc/t/topic/34084）

`hbm_runtime` 的按名取用天然规避了这个问题 —— 只要模型里的输出名不变，顺序怎么排都无所谓。这是迁移时应该主动利用的一项改进。

## 常见误区

**误区一：把 `hbm_runtime` 当成 `pyeasy_dnn` 的新名字。** 这是最严重的错误。两者是独立实现：加载语义不同（列表 vs 单对象）、元信息组织不同（属性链 vs 两级字典）、输出取数不同（`.buffer` vs dict）、量化参数暴露方式不同（`scale_data` vs `QuantParams`）。写「`hbm_runtime` 是 `pyeasy_dnn` 的别名」会直接导致读者按旧 API 写代码。

**误区二：以为升级系统就自动兼容旧代码。** 3.4.1 → 3.5.0 是断代升级。官方在社区答复里明确说旧接口的应用「不兼容，需迁移到 hbm_runtime」，`bpu_infer_lib` 更是直接停止维护。

> 来源：社区帖 35476（https://forum.d-robotics.cc/t/topic/35476）

**误区三：看到 `load: True` 就以为模型能跑。** 社区帖 34823 的日志里，`load: True`、`read: True` 全打印出来了，`forward` 才报 `Incompatible Platform!!`。加载成功只说明文件能被解析，不说明运行时能执行。

**误区四：反量化想当然。** `output_quants` 里有 `scale` 不等于「必须乘 scale」。先看 `quant_type`：是 `NONE` 就直接用，是 `SCALE` 才做 `(v - zero_point) * scale`。反过来漏做反量化，会得到 `-300000` 这种值域，然后 sigmoid 全 0，一个框都检不出来。

**误区五：以为官方文档对所有页面都同步修订了。** 3.5.0 的 `detection_sample` 页面 FAQ 里仍留着 `hobot_dnn` 的旧问答，而正文写的是 `hbm_runtime`。遇到文档自相矛盾时，以正文 API 说明和 `Release_Note` 为准，FAQ 的复制残留不作为依据。

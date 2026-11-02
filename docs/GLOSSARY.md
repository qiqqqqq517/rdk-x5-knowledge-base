# 术语表

> 统一中英对照与别名映射。遇到文档里的不同叫法，先在这里对齐再检索。
>
> 标注约定：**RDK X5 专有** = 只在本平台成立；**通用** = 嵌入式/Linux 通用概念。

## 平台与厂商

| 中文 / 常见叫法 | 英文 / 官方名 | 说明 |
| --- | --- | --- |
| 地瓜、地瓜机器人、地平线 | D-Robotics、Horizon Robotics | 「地瓜机器人」是 D-Robotics 的中文品牌名；社区和官方文档混用。地平线（Horizon Robotics）是母公司/芯片方 |
| 旭日 X5、X5、RDK X5、RDKX5 | RDK X5、Sunrise 5 | 开发板名；芯片叫 Sunrise 5（旭日 5）。`RDKX5` 是社区常见连写 |
| X5 模组 | RDK X5 Module、X5 MD | 核心板 + IO 载板的形态，调试串口 921600 |
| RDK 套件 | D-Robotics RDK | 泛指 X3 / X3 Module / X5 / X5 Module / S100 系列 |
| RDKOS、RDK OS | RDKOS | 板端 Ubuntu 系统镜像，版本线 3.0.0 → 3.5.0 |
| 机器人中间件 | TogetheROS.Bot、TROS | 地瓜在 ROS2 Humble 之上的封装，版本线独立于 RDKOS |

## 芯片与算力

| 中文 / 常见叫法 | 英文 / 官方名 | 说明 |
| --- | --- | --- |
| BPU、神经网络加速器 | BPU（Brain Processing Unit） | 端侧 AI 加速单元。**X5 是单核 BPU，一次只能推理一个模型**，多模型是时间分片不是并发 |
| 算力、TOPS | TOPS | 10 TOPS 指 INT8 定点算力上限，不是 FP32 算力，与实际帧率无直接换算关系 |
| 变体命名 | X5H、X5M、X5U | X5H 支持超频，X5M 不可超频；X5U 为早期版本。用 `cat /sys/class/socinfo/soc_name` 判定 |
| 温度传感器 | thermal zone、hwmon | X5 有 DDR/BPU/CPU 三路，精度 0.001℃；Thermal 分 `zone0`(DDR) 与 `zone1`(CPU/BPU/GPU) |

## AI 工具链

| 中文 / 常见叫法 | 英文 / 官方名 | 说明 |
| --- | --- | --- |
| 算法工具链、OE | OpenExplore、OE | x86 上跑的模型转换工具链，Docker 镜像形式。X5 对应 V1.2.8，X3 对应 V2.6.6，**不通用** |
| 模型转换器 | `hb_mapper` | 核心命令，三段脚本 `01_check.sh` / `02_preprocess.sh` / `03_build.sh` |
| 模型文件 | `.bin`、`.hbm` | BPU 可执行模型。`.hbm` 也用于 QAT 场景 |
| 量化 | PTQ、QAT | PTQ 训练后量化（主力路径）；QAT 量化感知训练，官方有能力但社区无可复现案例 |
| 校准集 | calibration dataset | PTQ 的输入，质量直接决定量化精度 |
| 分位数 | `max_percentile` | 校准截断参数，降低 = 截断更多长尾 = 阈值更紧 |
| 算子回退 | fallback to CPU、`will be executed on CPU` | 转换日志里的关键线索，是性能不达预期的头号原因 |
| 反量化 | Dequantize | 把 int8 数字还原成浮点。**它承载「怎么解释这个数字」的语义，删掉后手动乘 scale 通常乘错层** |

## Python / C++ 推理接口（版本敏感）

| 中文 / 常见叫法 | 英文 / 官方名 | 适用版本 | 说明 |
| --- | --- | --- | --- |
| 旧 Python 接口 | `pyeasy_dnn` | ≤ 3.4.1 | 已被取代 |
| 过渡接口 | `bpu_infer_lib` | 过渡期 | 官方明确已停止维护 |
| 当前 Python 接口 | `hbm_runtime` | ≥ 3.5.0 | pybind11 封装 libdnn |
| TROS C++ 推理框架 | `hobot_dnn` | 全版本 | **注意**：与 Python 侧 `hbm_runtime` 是两套并行接口，不是矛盾 |
| 底层推理库 | `libdnn` | 全版本 | C++ 库，Python 与 TROS 都最终调用它 |

## 多媒体与视觉

| 中文 / 常见叫法 | 英文 / 官方名 | 说明 |
| --- | --- | --- |
| 视频输入 | VIO、VIN | 摄像头采集链路 |
| 图像处理加速 | VSE、`hobot_cv` | 硬件缩放/裁剪单元；`hobot_cv` 是 TROS 里的封装 |
| 图像信号处理 | ISP | 3A、调参、sensor 适配。X5 的 ISP 文档是全库最长的一篇 |
| 编解码 | `hobot_codec` | TROS 编解码节点，`in_format` 必须与上游精确匹配 |
| 共享内存 | `hbmem`、ION | 零拷贝传图的基础；ION 分 `cma_reserved` / `carveout` / `ion_cma` 三区 |
| 话题 | topic、QoS | `/hbmem_img` 是 **BestEffort**，订阅端写 Reliable 会一条都收不到 |

## 硬件与总线

| 中文 / 常见叫法 | 英文 / 官方名 | 说明 |
| --- | --- | --- |
| 40 针扩展口 | 40PIN | 3.3V 逻辑，**最大耐压 3.46V**；3.3V 合计 800mA / 5V 合计 500mA |
| 引脚复用 | pinmux、pinctrl | X5 的复用对：`uart3↔i2c5`、`i2c0↔pwm2`、`spi2↔pwm0`、`spi2↔pwm1`、`i2c1↔pwm3` |
| 物理引脚号 | physical pin | 1~40，丝印与官方示例用它 |
| GPIO 编号 | GPIO number | 芯片内部编号，与物理引脚号**不相等** |
| 调试串口 | debug UART | X5 115200 / X5 Module 921600，8-N-1 |
| 系统配置工具 | `srpi-config` | 全屏运行；改完后复用类配置**必须重启**才生效 |
| 启动固件 | Miniboot | 固化在板载 NAND，**重刷 SD 卡不会更新它**；用 `rdk-miniboot-update` 升级 |
| 设备树覆盖 | dtoverlay | 在 `config.txt` 里启用 |

## 常用命令与工具

| 命令 | 作用 |
| --- | --- |
| `rdkos_info` | 一站式采集软件/硬件版本、驱动清单、日志 |
| `hrut_somstatus` | 温度、CPU/BPU 频率、BPU 负载率 |
| `hrut_boardid` | 板卡 ID 与 DDR 属性（位域编码） |
| `rdk-miniboot-update` | 升级 NAND 上的 Miniboot |
| `rdk-backup` | 把当前系统备份成可烧录镜像（**输出介质必须 ext4**） |
| `hrt_model_exec` | 板端执行 `.bin` 模型，做推理验证与测速 |

## 状态与日志术语

| 词 | 含义 |
| --- | --- |
| 崩溃点漂移 | 同一镜像多次崩溃在不同函数 → 指向供电/内存不稳，不是软件 bug |
| 崩溃点固定 | 每次崩在同一位置 → 指向代码或数据问题 |
| `init success` + `grab failed` 并存 | 常态。前者只代表 I2C 寄存器写完，不代表能取到帧 |
| `exit code -11` | SIGSEGV。在 TROS dnn_node 上常见根因是 bbox 输出 F32 与 parser 按 int32 读取不匹配 |
| `exit code -6` | SIGABRT，通常是主动 abort 或断言失败 |
| 假警报 | 如 `modinfo: hbn_vps not found` —— 内建模块不产生 ko，属于正常现象 |

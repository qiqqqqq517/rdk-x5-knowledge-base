---
id: 05-进阶驱动与系统-04-srpi-config与config.txt与Thermal频率管理
volume: 5
volume_title: 进阶驱动与系统
title: srpi-config、config.txt 与 Thermal 频率管理
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [srpi-config, config.txt, Thermal, 超频, 调频]
summary: srpi-config 全部选项、config.txt 语法与 dtoverlay、Thermal 两个 zone 的差异、CPU/GPU/BPU/DDR 调频与超频边界。
source_policy: "official-first, community-verified"
---
# 5.4 srpi-config、config.txt 与 Thermal 频率管理

## 本章解决什么

X5 上有一批「不需要编译、改配置重启就生效」的系统级开关：串口和 I2C 的使能与互斥、ION 内存分区、PWM 引脚复用、CPU 调频策略、超频、限温点、天线选择。它们由两个入口管理——图形化的 `srpi-config` 和文本的 `/boot/config.txt`。这两个入口最终都落到同一批底层参数上，但语法、生效时机、优先级各不相同，混用会导致「改了没效果」或者「工具里的选项被配置文件过滤掉」。

本章讲清四件事：`srpi-config` 的**全部菜单项**、`config.txt` 的**完整语法与 dtoverlay 机制**、X5 的 **Thermal 温控体系与 CPU 定频/超频**、以及**功耗与散热策略**。所有结论都标注了适用条件是 X3 还是 X5——这两块板子的调频参数、温控 zone 数量、超频幅度完全不同。

> 来源：官方文档 System_configuration__srpi-config（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/srpi-config）、System_configuration__config_txt（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/config_txt）、System_configuration__frequency_management（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/frequency_management）

## 5.4.1 srpi-config 全部选项

### 5.4.1.1 入口与前提

```bash
sudo srpi-config
```

`sudo` 是必须的：默认的 `sunrise` 账号不具备系统文件修改权限。桌面系统也可以在菜单里找到 **RDK Configuration** 应用，效果相同。

**适用范围**：仅 RDK X3、RDK X5、RDK X3 Module。其他型号（如 RDK Ultra、RDK S100）不适用。

`srpi-config` 需要在**全屏命令行窗口**中运行。

### 5.4.1.2 菜单结构总览

| 主菜单 | 子项 | 作用 |
| --- | --- | --- |
| System Options | Wireless LAN / Password / Hostname / Boot-Auto login / Power LED / Browser | 系统级配置 |
| Display Options | FB Console Resolution / Display Chose DSI or HDMI | 显示配置 |
| Interface Options | SSH / VNC / Peripheral bus config / Configure Wi-Fi antenna / Audio | 接口开关 |
| Performance Options | CPU frequency / ION memory | 性能与内存 |
| Localisation Options | Locale / Time Zone / Keyboard | 本地化 |
| Advanced Options | Expand Filesystem / Network Proxy Settings / Boot Order | 高级 |
| Sensor Profiles | IMX219 Switch ISP | 摄像头效果库 |
| Update / About / Finish | — | 工具自身维护 |

### 5.4.1.3 System Options

| 子项 | 说明 |
| --- | --- |
| Wireless LAN | 设置无线网络的 SSID 和密码 |
| Password | 更改默认用户密码，默认账号为 `sunrise` |
| Hostname | 设置设备在网络上的可见名称 |
| Boot / Auto login | 选择引导到控制台还是桌面，以及是否自动登录。自动登录会用系统默认账号 `sunrise` |
| Power LED | 在型号允许时更改电源 LED 行为，默认是熄灭或闪烁 |
| Browser | 桌面系统下设置默认浏览器，不配置则默认 firefox；可 `sudo apt install chromium` 安装 chromium |

### 5.4.1.4 Display Options

| 子项 | 说明 | 平台限制 |
| --- | --- | --- |
| FB Console Resolution | 设置 Server 系统和 console 模式下的 HDMI 显示分辨率 | — |
| Display Chose DSI or HDMI | DSI 与 HDMI 显示切换 | **仅 RDK X5 支持切换显示屏** |

X5 的 DSI 与 HDMI 在硬件上互斥，只能二选一。系统默认启用 HDMI。这条限制在社区实战里被反复确认——社区帖 34342 里作者适配 DFRobot 5 寸 DSI 屏时明确写道：

> 重要限制：RDK X5 的 DSI 和 HDMI 不能同时使用，硬件上只能二选一。系统默认启用 HDMI，使用 DSI 需要手动切换。

> 来源：社区帖 34342（https://forum.d-robotics.cc/t/topic/34342）

### 5.4.1.5 Interface Options

| 子项 | 说明 |
| --- | --- |
| SSH | 启用/禁用远程登录，**默认启用** |
| VNC | 启用/禁用 X11vnc 虚拟网络计算服务器，远程访问桌面时用 |
| Peripheral bus config | 启用/禁用 40PIN 上的 SPI、I2C、Serial Port、I2S、PWM |
| Configure Wi-Fi antenna | 切换板载/外置天线 |
| Audio | 安装和卸载音频转接板 |

#### Peripheral bus config 与 X5 的复用互斥表

这是本菜单最重要的一项。**本配置方式会直接修改使用的设备树文件的对应总线 status，重启后生效**。

X5 在这项上增加了 PWM 接口。下表每行的接口使用**相同的引脚，同时只能生效一种功能**；当一行的所有接口都为 disable 时，引脚为 GPIO 功能脚：

| 功能 1 | 功能 2 |
| --- | --- |
| `serial3` | `i2c5` |
| `i2c0` | `pwm2` |
| `spi2` | `pwm0` |
| `spi2` | `pwm1` |
| `i2c1` | `pwm3` |

**注意这张表里 `spi2` 出现了两次**——意味着 `spi2` 同时与 `pwm0`、`pwm1` 冲突。想用 `pwm0` 和 `pwm1` 两路，就必须关掉 `spi2`。

#### Configure Wi-Fi antenna

支持设置使用板载还是外置天线：

- `Onboard`：板载天线；
- `External`：外置天线。

**型号支持范围**：RDK X3（V2.1）、RDK X5（V0.1、V1.0）、RDK X5 MD（< V1.1）。

确认天线状态：

```bash
cat /boot/config.txt
```

`antenna_option=trace` 表示板载天线，`antenna_option=cable` 表示外置天线。

#### Audio

安装和卸载音频转接板。可能支持的板子包括 Audio Driver HAT V1、Audio Driver HAT V2、WM8960 Audio HAT，不同硬件能支持的转接板也有差别。

### 5.4.1.6 Performance Options

#### CPU frequency

用于对 CPU 超频。官方原文的措辞是「一般不建议开启，如果做好充分散热工作可以尝试修改此选项」。X5 的超频细节必须先读 Thermal 和 CPU 频率管理文档中的「CPU 超频」一节。

#### ION memory

配置 ION 内存的常用大小。

> ION 内存是预留出来给 BPU 和图像、视频多媒体功能的物理内存空间。默认配置大小为 672MB，如果需要运行比较大的算法模型、同时编解码多路视频时，请根据具体需要调整该内存大小。

这里要澄清一个数字上的差异：`srpi-config` 说默认 672MB，而 `config.txt` 文档给出的三个 ION 区域默认值是 `ion_reserved_size` 320M、`ion_carveout_size` 320M、`ion_cma_size` 128M，三者相加 768M。两处口径不同（672 vs 768），是因为一个说的是「可用配置的常用值」、一个是分区默认上限，实际以 `dmesg | grep "Reserved ion"` 的输出为准。

### 5.4.1.7 Localisation Options

| 子项 | 说明 |
| --- | --- |
| Locale | 选择语言环境，如 `zh_CN.UTF-8`，**重启生效** |
| Time Zone | 选择时区，从地区开始（如亚洲→上海），键入字母可跳到列表对应位置 |
| Keyboard | 读取全部键盘类型需要较长时间；更改通常立即生效，但可能需要重启 |

### 5.4.1.8 Advanced Options

| 子项 | 说明 |
| --- | --- |
| Expand Filesystem | 扩展安装以填满整个 TF 卡 |
| Network Proxy Settings | 配置网络代理 |
| Boot Order | 切换 eMMC / SD 卡启动模式，**仅 RDK X3 Module 和 RDK X5 Module 支持** |

`Expand Filesystem` 的典型场景：系统是从另一张已完成初始化的卡复制来的，TF 卡容量不会被自动调整为当前卡容量，用这项完成扩展。

### 5.4.1.9 Sensor Profiles

提供多套 Sensor 效果库配置，用于适配同一 Sensor 的不同模组形态。由于模组在光学和调校上的差异，最终成像效果及强度会有所不同，因此需要分别进行 ISP 校准。

X5 上现有的选项是 **IMX219 Switch ISP**：

| 选项 | FOV | 对应模组 |
| --- | --- | --- |
| 1 | 79.3° | Jetson Nano 摄像头，适配 200FOV 和 160FOV 模组 |
| 2 | 120° | 树莓派 5 代摄像头，适配 120FOV 模组 |

这个菜单项的存在本身说明一件事：**同一个 sensor 芯片，不同镜头模组需要不同的效果库**。这直接解释了第 3 章里 OV5647 适配失败的原因——`mipi_cam/config/` 下没有对应校准文件，pipeline 起不来。

### 5.4.1.10 Finish

完成更改后点 Finish。如果修改需要重启才生效，系统会提示是否立即重启。

> 来源：官方文档 System_configuration__srpi-config（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/srpi-config）

## 5.4.2 config.txt 完整语法

### 5.4.2.1 基本机制

`config.txt` 在 **uboot 阶段被读取**，用于设置启动时的系统配置，支持修改设备树配置、IO 管脚状态、ION 内存、CPU 频率等。文件位置是 `/boot/config.txt`，**必须以 root 身份编辑**。如果文件不存在，直接新建一个文本文件即可。

这一点是 `config.txt` 相对其他配置方式的核心优势：**改完重启就生效，不需要重新编译内核或设备树**。

### 5.4.2.2 前置条件（不满足会静默失败）

| 条件 | 要求 |
| --- | --- |
| 适用型号 | 仅 RDK X3、RDK X5、RDK X3 Module |
| 系统版本 | 不低于 2.1.0 |
| miniboot 版本 | 不能低于 20231126 日期的版本 |

miniboot 升级参考 `rdk-miniboot-update` 命令在板更新。

**还有一条容易踩的**：

> 如果您在本配置文件添加了过滤项，那么使用 srpi-config 工具时请注意配置项是否会被过滤掉。

因为 `srpi-config` 修改的也是同一批参数，而 `config.txt` 里的过滤项可以按硬件型号屏蔽配置段。加了过滤项之后，工具写的配置可能落在被过滤掉的分段里，表现为「工具里改了但没生效」。

### 5.4.2.3 dtdebug

```text
dtdebug=1
```

非零时，在 uboot 阶段的设备树配置过程中会在串口输出配置日志。**`dtdebug` 必须先于 `dtoverlay` 配置**（写在前面）。

这是排查 overlay 问题的第一手段——串口能看到 overlay 到底应用了没有、哪一条失败。

### 5.4.2.4 dtoverlay

支持设备树覆盖，提供更灵活的设备树调整方式。

**X3 的例子里**（用于对比，不要在 X5 上抄）：

```text
# X3：调整 ION 内存大小为 1GB
dtoverlay=ion_resize,size=0x40000000
```

**X5 的 overlay 例子**：

```text
# X5：增加 /dev/spidev5.0
dtoverlay=dtoverlay_spi5_spidev
```

**必须记住的限制**：CAN 设备也接在 spi5 上，**spidev 和 can 只能二选一**。

### 5.4.2.5 X5 配置 ION：三条 ion 参数

这是 X5 与 X3 差异最大的一处。X5 通过 `ion_reserved_size`、`ion_carveout_size`、`ion_cma_size` 修改 boot 环境变量，进而修改 ION 分区大小：

| boot 环境变量名 | dts 标签 | dts compatible 字符串 | 默认大小 |
| --- | --- | --- | --- |
| `ion_reserved_size` | `ion_reserved` | `ion-pool` | 320M |
| `ion_carveout_size` | `ion_carveout` | `ion-carveout` | 320M |
| `ion_cma_size` | `ion_cma` | `ion-cma` | 128M |

```text
ion=ion_reserved_size=0x14000000
ion=ion_carveout_size=0x14000000
ion=ion_cma_size=0x08000000
```

验证：

```bash
dmesg | grep "Reserved ion"
```

```text
[ 0.207939] Reserved ion-pool MEM start 0xa4100000, size 0x14000000
[ 0.207964] Reserved ion-carveout MEM start 0xb8100000, size 0x14000000
[ 0.208068] Reserved ion-cma MEM start 0xcc100000, size 0x8000000
```

社区帖 32485 提供了一个真实的配置示例，可以作为参考格式：

```text
ion=ion_cma_size=0x14000000
ion=ion_reserved_size=0x28000000
ion=ion_carveout_size=0x28000000
bootargs=console=tty1 console=ttyS0,115200 rootfstype=ext4 rw rootwait root=/dev/mmcblk1p2 mtdparts=spi7.0:0x700000@0x0(miniboot),0x180000@0x700000(ubootenv) hobotboot.reason=REBOOT_CMD isolcpus=6,7
```

**但这个案例是一次失败**：用户按上述方式追写 `config.txt` 后重启，`cat /proc/cmdline` 显示的启动参数里**没有 `isolcpus=6,7`**，也就是 `bootargs=` 这一行没生效。社区的处置建议是先自查 miniboot 版本和系统版本是否都是最新的。

这个案例的教训：

- `ion=` 这类**独立参数**按行写是有效的；
- **整行覆盖 `bootargs=`** 这种做法，在 `config.txt` 里的支持度需要按版本确认，不是所有版本都会把它拼进内核命令行；
- 改完必须用 `cat /proc/cmdline` 回读验证，不能假设写进去就生效了。

> 来源：官方文档 System_configuration__config_txt、社区帖 32485（https://forum.d-robotics.cc/t/topic/32485）

### 5.4.2.6 dtparam：总线使能开关

支持设置 uart、i2c、spi、i2s 等总线的使能与关闭。

| 平台 | 支持的选项参数 |
| --- | --- |
| RDK X3 | `uart3`, `spi0`, `spi1`, `spi2`, `i2c0`~`i2c5`, `i2s0`, `i2s1` |
| RDK X5 | `uart1`, `uart2`, `uart3`, `uart6`, `spi1`, `spi2`, `i2c0`, `i2c1`, `i2c4`, `i2c5`, `dw_i2s1` |

**两个平台的参数列表差异很大，不能互抄**。X5 有 `uart6` 但**没有 `uart4`、`uart5`、`uart7`**；X5 有 `i2c4` 但**没有 `i2c2`、`i2c3`、`i2c6`、`i2c7`**；X5 没有任何 LPWM 参数。

这个限制在社区里造成过真实困惑。社区帖 35761 里用户想在 X5 Module 上启用 UART4，得到的确认是：

> srpi-config 里找不到是正常的——X5 上 config.txt 的 dtparam 目前只支持 uart1/uart2/uart3/uart6，uart4 不在列表里，所以图形工具没有配置项。启用 UART4 只能改设备树，但**只需重编 dtb，不用重编整个镜像**。

同一帖给出了完整做法（这也是「dtparam 覆盖不到时怎么办」的标准答案）：

1. 先在板上确认 `hrut_boardid` 和 `ls /dev/ttyS4`，若有 `ttyS4` 先做 TX/RX 回环验证串口本身；
2. 在板级 dts 里使能 `&uart4` 并绑定现成的 `pinctrl_uart4`；
3. 检查 GPIO0 的 12、13 脚没被别的功能占用——默认状态下它们被 `lsio_gpio0_12`/`lsio_gpio0_13` 声明，必须在 `pinmux-gpio.dtsi` 里删掉或不引用；
4. 按官方流程生成并替换对应 DTB（先备份原文件），重启后查 `/dev/ttyS4`。

X5 的 `dtparam` 用法：

```text
# 关闭串口 3
dtparam=uart3=off

# 打开 i2c5
dtparam=i2c5=on
```

X5 同样需要注意复用关系：当一行的所有接口都为 disable 时，引脚为 GPIO 功能脚。互斥表与 `srpi-config` 中的完全一致：

| 功能 1 | 功能 2 |
| --- | --- |
| `uart3` | `i2c5` |
| `i2c0` | `pwm2` |
| `spi2` | `pwm0` |
| `spi2` | `pwm1` |
| `i2c1` | `pwm3` |

> 来源：官方文档 System_configuration__config_txt、社区帖 35761（https://forum.d-robotics.cc/t/topic/35761）

### 5.4.2.7 IO 初始化：gpio 参数

支持设置 IO 的功能复用、输入输出模式、输出高低电平、上下拉模式。**应选择 BOARD 编码对应的 GPIO 编号**。

| 值 | 含义 |
| --- | --- |
| `ip` | Input，设置为输入模式 |
| `op` | Output，设置为输出模式 |
| `f0`~`f3` | Func0~Func3，设置功能复用。**X3 的 f3 功能都是设为 io 模式；X3 的其他功能和 X5 的所有功能请查看 40PIN 管脚定义或寄存器文档** |
| `dh` | Driving high，输出高电平 |
| `dl` | Driving low，输出低电平 |
| `pu` | Pull up，推挽上拉 |
| `pd` | Pull down，推挽下拉 |
| `pn` / `np` | No pull，无上下拉 |

示例：

```text
# 配置 40Pin 上的 GPIO5 和 GPIO6 为 IO 模式
gpio=5=f3
gpio=6=f3
# 连续管脚可以这样写
gpio=5-6=f3

# 配置 GPIO5 为输入模式
gpio=5=f3
gpio=5=ip

# 配置 GPIO6 为输出模式并输出低电平
gpio=6=f3
gpio=6=op,dl

# 配置 GPIO6 为输出模式、输出高电平、并设置上拉
gpio=6=f3
gpio=6=op,dh,pu
```

**注意 `gpio=5=f3` 这行不能省**。`f3` 是把引脚切成 IO 模式，之后 `ip`/`op` 才有意义。只写 `gpio=5=ip` 而引脚还在外设复用状态，设置不会生效。

> 来源：官方文档 System_configuration__config_txt

### 5.4.2.8 温度控制：throttling_temp 与 shutdown_temp

```text
# 降频温度点：超过此温度 CPU 和 BPU 降低频率
throttling_temp=86000

# 宕机温度点：超过此温度系统自动关机
shutdown_temp=112000
```

细节：

- 温度单位为千分之一摄氏度，`86000` = 86℃；
- 降频后 **CPU 最低降到 240MHz，BPU 最低降到 400MHz**；
- 宕机后**设备不会自动重启**，需要手动断电再上电。所以散热做不好不只是性能问题，是可用性问题。

### 5.4.2.9 选项过滤：按硬件型号分节

支持用 `[]` 设置过滤项。**过滤项的设置需要放在配置文件尾部**，因为文件前面未添加过滤项的部分属于 `all`；一旦添加过滤设置，则之后的配置只属于该过滤属性，直到文件结尾或设置另一个过滤项。

| 过滤项 | 适配型号 |
| --- | --- |
| `[all]` | 所有硬件，默认属性 |
| `[rdkv1]` | RDK X3 v1.0、v1.1 |
| `[rdkv1.2]` | RDK X3 v1.2 |
| `[rdkv2]` | RDK X3 v2.1 |
| `[rdkmd]` | RDK X3 Module |
| `[x5-rdk]` | RDK X5 V0.1 |

**注意 `[x5-rdk]` 只对应 RDK X5 V0.1**。X5 V1.0 和 X5 MD 系列在这张表里没有对应过滤项——这意味着想给 X5 V1.0 做差异化配置，不能靠过滤项，只能靠分板烧录不同的 `config.txt`。这是一个文档覆盖的空白点，实际项目里要自己处理。

### 5.4.2.10 电压域：voltage_domain

```text
# 40 Pin 电压域配置，3.3V 或 1.8V，默认 3.3V
# 仅 RDK Module 支持
[rdkmd]
voltage_domain=3.3V
```

**仅 RDK Module 支持本项配置**，且**需要配合硬件上的电压域切换跳线帽使用**。只改配置不动跳线帽，配置与实际电压不匹配——回顾第 2 章 IO-DOMAIN 的规则：外部 3.3V 而配置 1.8V 可能损伤芯片。

> 来源：官方文档 System_configuration__config_txt（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/config_txt）

### 5.4.2.11 X3 与 X5 的 config.txt 参数对照

把上面散落的差异汇总成一张表，写配置前对照一遍：

| 配置项 | RDK X3 | RDK X5 |
| --- | --- | --- |
| ION 调整 | `dtoverlay=ion_resize,size=` | `ion=ion_reserved_size=` / `ion_carveout_size` / `ion_cma_size` |
| dtparam 串口 | `uart1`~`uart6`（视版本） | `uart1`, `uart2`, `uart3`, `uart6` |
| dtparam I2C | `i2c0`~`i2c5` | `i2c0`, `i2c1`, `i2c4`, `i2c5` |
| dtparam SPI | `spi0`, `spi1`, `spi2` | `spi1`, `spi2` |
| dtparam I2S | `i2s0`, `i2s1` | `dw_i2s1` |
| PWM 复用 | 无对应参数 | 与 `spi2`/`i2c0`/`i2c1` 互斥 |
| 超频幅度 | 1.2GHz → 1.5GHz（V1.x）；1.8GHz（V2.0/Module） | 1.5GHz → 1.8GHz，仅 X5H |
| 可用 frequency 列表 | 240000 / 500000 / 800000 / 1000000 / 1200000 / 1500000 / 1800000 | 300000 / 600000 / 1200000 / 1500000 |
| 电压域配置 | 仅 Module | 仅 Module |
| 过滤项 | `[rdkv1]` `[rdkv1.2]` `[rdkv2]` `[rdkmd]` | `[x5-rdk]`（仅 V0.1） |

> 来源：官方文档 System_configuration__config_txt（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/config_txt）

## 5.4.3 Thermal 温控体系

### 5.4.3.1 X5 的三路温度传感器

X5 上有三个温度传感器，显示 DDR/BPU/CPU 的温度：

```bash
cat /sys/class/hwmon/hwmon0/temp1_input   # DDR，如 46643
cat /sys/class/hwmon/hwmon0/temp2_input   # BPU
cat /sys/class/hwmon/hwmon0/temp3_input   # CPU
```

**精度为 0.001 摄氏度**，所以 `46643` 是 46.643℃。

关键注意事项：

> BPU 的温度传感器位于 bpu subsystem，bpu subsystem 只有在 bpu 运行时才会上电，所以只有 bpu 运行时，bpu 的温度才可以查看。

这意味着空闲状态下 `temp2_input` 读不到有效值是正常的，不是传感器坏了。想读 BPU 温度必须先跑一个推理任务。

另外启动日志里会出现这条：

```text
[ 3.001660] hwmon hwmon0: temp2_input not attached to any thermal zone
```

它说的是 BPU 温度没有挂到任何 thermal zone 上（因为 thermal_zone1 整体管 CPU/BPU/GPU 的降频），不是错误。

### 5.4.3.2 X5 的两个 thermal zone

| Zone | 关联 cooling 设备 | trip_point 数量 | 用途 |
| --- | --- | --- | --- |
| `thermal_zone0` | DDR | 1 个 | 控制 DDR 的调频温度 |
| `thermal_zone1` | CPU / BPU / GPU | 3 个 | 控制 CPU/BPU/GPU 频率与关机 |

X5 一共有四个 cooling（降温）设备：

| cooling 设备 | 对应硬件 |
| --- | --- |
| `cooling_device0` | cpu |
| `cooling_device1` | bpu |
| `cooling_device2` | gpu |
| `cooling_device3` | ddr |

### 5.4.3.3 温控策略

```bash
# 查看当前策略
cat /sys/class/thermal/thermal_zone0/policy

# 查看支持的策略
cat /sys/class/thermal/thermal_zone0/available_policies
# user_space step_wise
```

X5 只支持两种策略：

| 策略 | 行为 |
| --- | --- |
| `user_space` | 通过 uevent 把温区当前温度、温控触发点等信息上报到用户空间，由用户空间软件制定温控策略 |
| `step_wise` | 每个轮询周期逐级提高冷却状态，相对温和的温控策略 |

默认使用 `step_wise`。动态切换：

```bash
echo user_space | sudo tee /sys/class/thermal/thermal_zone0/policy
```

选择哪个取决于产品需要：`step_wise` 是「够用就好」的默认策略；如果你的产品需要在特定温度做特定动作（比如先关 BPU 再降 CPU、或者主动降帧率），就用 `user_space` 自己在应用层接管。

### 5.4.3.4 温度点的设置

**thermal_zone0**（DDR 调频温度，当前默认 95℃）：

```bash
cat /sys/devices/virtual/thermal/thermal_zone0/trip_point_0_temp
# 调整为 85℃
echo 85000 | sudo tee /sys/devices/virtual/thermal/thermal_zone0/trip_point_0_temp
```

**thermal_zone1**（三个 trip_point）：

| trip_point | 作用 | 默认值 |
| --- | --- | --- |
| `trip_point_0_temp` | **预留作用** | — |
| `trip_point_1_temp` | 该 thermal zone 的调频温度，控制 CPU/BPU/GPU 频率 | 95℃ |
| `trip_point_2_temp` | 关机温度 | 105℃ |

```bash
# 结温到 85℃ 时 CPU/BPU/GPU 开始调频
echo 85000 | sudo tee /sys/devices/virtual/thermal/thermal_zone1/trip_point_1_temp

# 调整关机温度为 105℃
echo 105000 | sudo tee /sys/devices/virtual/thermal/thermal_zone1/trip_point_2_temp
```

**`trip_point_0_temp` 是预留的，不要动它**。这一点与 X3 完全不同：X3 只有一个 `thermal_zone0`，三个 trip_point 分别是启动温度（默认 80000）、降频温度（默认 95000）、宕机温度（默认 105000）。在 X5 上照抄 X3 的 `echo ... > thermal_zone0/trip_point_1_temp` 是无效操作——X5 的 zone0 只有一个 trip_point。

**所有设置断电重启后需要重新设置**。要持久化就写进 `/boot/config.txt` 的 `throttling_temp` / `shutdown_temp`，或者做成开机脚本。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_thermal_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_thermal_dev）、System_configuration__frequency_management（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/frequency_management）

### 5.4.3.5 关于「另一套阈值」的说明

社区帖 35824 里有一个重要提醒，值得记录：

> X5 SDK 设备树里另一组值：CPU passive 95℃、critical 110℃；DDR 热区 95℃ 触发 ddrc 降频。两套文档的 zone 编号和阈值不完全一致，**以你板子实际读数为准**。

给出的确认命令：

```bash
sudo hrut_somstatus    # 一次看到 DDR/BPU/CPU 温度 + CPU/BPU/DDR/GPU 频率
grep . /sys/class/thermal/thermal_zone*/type
cat /sys/class/thermal/thermal_zone*/trip_point_*_temp
```

这是处理「文档与实测不一致」的正确态度：不猜、以板端读数为准。

> 来源：社区帖 35824（https://forum.d-robotics.cc/t/topic/35824）

## 5.4.4 CPU 频率管理

### 5.4.4.1 两套不同的路径

X5 上控制 CPU 频率有两条路径，都在 `/sys/devices/system/cpu/` 下，但挂载结构不同：

| 路径 | 用于 |
| --- | --- |
| `/sys/devices/system/cpu/cpufreq/policy0/` | 查看频率列表、`scaling_setspeed`、`scaling_available_frequencies` |
| `/sys/devices/system/cpu/cpu0/cpufreq/` | 设置 `scaling_governor` |

官方文档里两种写法都出现过，功能上等价（`policy0` 是策略组视图，`cpu0/cpufreq` 是单核视图），但**设 governor 用后者、设频率用前者的 `scaling_setspeed`** 是最稳妥的组合。

`policy0` 目录下的关键文件：

| 文件 | 含义 |
| --- | --- |
| `affected_cpus` | 当前控制影响的 CPU 核（不含 offline 状态的） |
| `cpuinfo_cur_freq` | 当前 CPU 频率（KHz） |
| `cpuinfo_max_freq` | 当前调频策略下可用最高频率（KHz） |
| `cpuinfo_min_freq` | 当前调频策略下可用最低频率（KHz） |
| `cpuinfo_transition_latency` | 处理器切换频率所需时间（ns） |
| `related_cpus` | 该策略影响哪些核（含 online + offline 全部） |
| `scaling_available_frequencies` | CPU 支持的主频列表（KHz） |
| `scaling_available_governors` | 内核支持的所有 governor 类型 |
| `scaling_boost_frequencies` | boost（超频）模式下支持的主频列表（KHz） |
| `scaling_cur_freq` | cpufreq 模块缓存的当前频率，**不会检查硬件寄存器** |
| `scaling_disable_freq` | 禁止设置的 CPU 频率，只能设一个 |
| `scaling_driver` | 当前使用的调频驱动 |
| `scaling_governor` | governor 策略 |
| `scaling_max_freq` | 当前策略下可用最高频率（从 cpufreq 缓存读） |
| `scaling_min_freq` | 当前策略下可用最低频率（从 cpufreq 缓存读） |
| `scaling_setspeed` | **需将 governor 切为 userspace 才能用**，往里 echo 数值切频率 |

**`scaling_cur_freq` 与 `cpuinfo_cur_freq` 的区别很重要**：前者是软件缓存，后者是真实硬件读数。怀疑实际频率与设置不符时（比如超频没生效），要看 `cpuinfo_cur_freq`。

### 5.4.4.2 X5 支持的频率与 governor

```bash
cat /sys/devices/system/cpu/cpufreq/policy0/scaling_available_frequencies
# 300000 600000 1200000 1500000
```

**X5 只有四个频点**：300MHz、600MHz、1.2GHz、1.5GHz（外加超频档 1.8GHz）。

X3 是 240000 / 500000 / 800000 / 1000000 / 1200000 / 1500000 / 1800000——**七个频点，且含 240MHz 和 800MHz 这些 X5 没有的档位**。写死频率值的脚本跨平台跑会失败。

X5 支持的 governor：

| governor | 行为 |
| --- | --- |
| `performance` | 以最高频率执行 |
| `ondemand` | 按负载调整频率 |
| `userspace` | 根据用户设置频率 |
| `powersave` | 以最低频率执行 |
| `schedutil` | 按负载调整频率，与 CPU 调度器结合使用 |

X5 默认 governor 是 **`schedutil`**（X3 默认是 `ondemand`）。

```bash
# 性能模式
echo performance | sudo tee /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

# 定频 1.2GHz
echo userspace | sudo tee /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
echo 1200000 | sudo tee /sys/devices/system/cpu/cpufreq/policy0/scaling_setspeed

# 查看当前频率
cat /sys/devices/system/cpu/cpufreq/policy0/cpuinfo_cur_freq
```

**持久化到 config.txt**：

```text
governor=performance
```

```text
governor=userspace
frequency=1200000
```

### 5.4.4.3 CPU 超频

X5 的超频把最高频率从 **1.5GHz 提升到 1.8GHz**：

```bash
echo 1 | sudo tee /sys/devices/system/cpu/cpufreq/boost
echo performance | sudo tee /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

**注意这两条要一起执行**。只设 `boost=1` 而不把 governor 切到 `performance`，`schedutil` 在低负载时仍会降频，你感觉不到超频的效果。

关闭超频（出现稳定性问题时）：

```bash
echo 0 | sudo tee /sys/devices/system/cpu/cpufreq/boost
```

**以上配置仅在当前运行中生效，重启恢复默认**。

#### 关键限制：仅 X5H 支持超频

> 仅 X5H 支持超频，X5M 不可用超频。

查芯片类型：

```bash
cat /sys/class/socinfo/soc_name
# X5M
```

| soc_name | 是否支持超频 |
| --- | --- |
| `X5H` | 支持 |
| `X5M` | **不支持** |
| `X5U`（X5 UNKNOWN） | 早期出厂版本，eFUSE 未烧录标识位，未启用超频限制，理论上可配置但风险高 |

对于 `X5U` 芯片，官方明确提示：

- 超频后功耗将显著上升；
- 系统稳定性无法保证，可能存在异常运行或寿命缩短风险；
- **建议仅在研发阶段测试使用，量产不推荐依赖超频特性**。

芯片类型识别为 `X5U` 时无法通过软件读取准确型号，需要根据芯片丝印信息人工识别。

#### 超频的电压变化

1.8G 超频时，**CPU 工作电压为 1V**；其余频点对应的工作电压为 **800mV**。这解释了两件事：为什么超频后功耗和发热会跳一个台阶；为什么散热不足时会先崩。

> 来源：官方文档 System_configuration__frequency_management（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/frequency_management）、Advanced_development__linux_development__driver_development_x5__driver_lowpower（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_lowpower）

## 5.4.5 功耗与散热策略

### 5.4.5.1 硬件层面的四个可调对象

X5 共有 CPU / GPU 3D / BPU / DDR 支持调频，**CPU 同时支持调压**。降低功耗可以从降低电压、降低时钟频率、散热三方面入手；负载减轻也能降功耗。

各模块的 devfreq 路径与频点：

| 模块 | 路径 | 支持频点 |
| --- | --- | --- |
| BPU | `/sys/class/devfreq/3a000000.bpu` | `500000000` `1000000000` |
| GPU 3D | `/sys/class/devfreq/3c000000.gc8000` | `200000000` `400000000` `750000000` `1000000000` |
| DDR | `/sys/class/devfreq/soc:ddrc-freq` | `266000000` `1066000000` `2133000000` `3200000000` |
| CPU | `/sys/devices/system/cpu/cpufreq/policy0/` | `300000` `600000` `1200000` `1500000`（+1.8G 超频） |

**DDR 频点因颗粒而异**，`available_frequencies` 的实际输出可能不同，必须查不能假定。

各模块的 governor：

| 模块 | 支持的 governor |
| --- | --- |
| BPU | `userspace` `performance` `powersave` |
| GPU 3D | `userspace` `performance` `powersave` `simple_ondemand` |
| DDR | `userspace` `performance` `simple_ondemand` `powersave` |

**注意 BPU 没有 `simple_ondemand`**，只有三档固定策略，这是与 GPU/DDR 的一个差异点。

```bash
# DDR 降频到最低
echo userspace | sudo tee /sys/class/devfreq/soc:ddrc-freq/governor
echo 266000000 | sudo tee /sys/class/devfreq/soc:ddrc-freq/userspace/set_freq
cat /sys/class/devfreq/soc:ddrc-freq/cur_freq

# 改成按负载
echo simple_ondemand | sudo tee /sys/class/devfreq/soc:ddrc-freq/governor
```

社区帖 35824 对 DDR 的建议值得单独引出：

> DDR 支持 266M/2133M/2844M/4266M，可把 `soc:ddrc-freq` 的 governor 从 performance 改 `simple_ondemand`，避免常驻 4266MHz。

注意这里的频点列表与官方 lowpower 文档给出的（266M/1066M/2133M/3200M）不同——不同 DDR 颗粒支持的频点确实不一样，这正是官方文档强调「不同 DDR 颗粒支持的频点可能不一致」的原因。**以你自己板子上 `available_frequencies` 的输出为准**。

### 5.4.5.2 CPU hotplug

CPU core 不用时可以拔出进一步降功耗。**除 core0 不支持 hotplug 外，core1~core7 均支持**。

```bash
echo 0 | sudo tee /sys/devices/system/cpu/cpu1/online   # disable cpu1
echo 1 | sudo tee /sys/devices/system/cpu/cpu1/online   # enable cpu1
```

### 5.4.5.3 设备电源域：最有效的降功耗手段

> 对于 BPU/GPU/ISP/VIDEO CODEC/JPEG/HIFI 都是有独立的电源控制，目前这些设备只有在使用时（驱动 open）上电，使用结束（驱动 close）就会下电。可尽量降低 X5 SoC 的整体功耗。

这条信息量很大，它意味着 **X5 的功耗管理是「按需上电」模型**：不用的模块不耗电。

推论：**释放不再使用的资源，比调 governor 更有效**。

- 不跑的模型卸载掉（BPU 下电）；
- 不用的编解码节点关掉（CODEC 下电）；
- 不用的摄像头 pipeline 停掉（ISP 下电）；
- 不用的 HDMI 输出关掉。

社区帖 35824 的回复把这条总结得很准确：

> X5 的 BPU/GPU/ISP/CODEC 是独立电源域，驱动 close 即下电，所以释放不再使用的模型/编解码/摄像头节点，比调 governor 更有效；模型降分辨率、降帧率同样直接减热。

### 5.4.5.4 休眠唤醒

```bash
# 休眠
hobot-suspend
```

也可以通过长按按键休眠；短按按键唤醒。

### 5.4.5.5 散热问题实战：怎么判断是 DDR 还是 CPU 过热

社区帖 35824 是一个 2026 年 10 月的高质量问答，用户问「X5 EVB 有散热问题，加风扇看起来可以，有相关温度参数技术要求吗」，并猜测是 DDR 过热还是 CPU 过热。回复里的方法论值得完整记录。

#### 温度参数依据

| 项 | 值 |
| --- | --- |
| 整机环境温度 | 推荐 -20℃ ~ 60℃ |
| 启动降频温度 | 80℃（开机即降频） |
| CPU/BPU 降频温度 | 95℃（CPU 最低 240MHz、BPU 最低 400MHz） |
| 关机温度 | 105℃，**且不会自动重启** |
| X5 SDK 设备树另一组值 | CPU passive 95℃、critical 110℃；DDR 热区 95℃ 触发 ddrc 降频 |

**「宕机点不要往上调」**——这是回复中特别强调的。

同时明确了一个信息空白：**芯片级的 Tj 上限、DDR 颗粒温度规格，官方文档没有给出数值，需要向原厂确认**。

#### 区分 DDR 还是 CPU

```bash
cat /sys/class/hwmon/hwmon0/temp1_input   # DDR，精度 0.001℃
cat /sys/class/hwmon/hwmon0/temp2_input   # BPU，仅 BPU 运行时有值
cat /sys/class/hwmon/hwmon0/temp3_input   # CPU
cat /sys/class/devfreq/soc:ddrc-freq/cur_freq
```

**判断规则**：出现异常时看哪一路贴近阈值、以及**谁先被降频**。

这里有一个非常重要的提醒：

> DDR 那一路测量的是 SoC 内部 PVT 通道（设备树里 `thermal-sensors = <&pvt 0>`），反映 die 上 DDR 控制器/接口附近的温度，**不是 LPDDR 颗粒表面的温度**，所以「DDR 读数高」不能直接等同于「颗粒过热」。

这个区分直接推翻了「看到 DDR 温度高就换 DDR 颗粒」的思路。而且给出了后果判断：

> 如果 DDR 频率被压到 266MHz，才会明显影响带宽和推理耗时。

也就是说，判断 DDR 是否真的出问题，看的不是温度读数而是 `cur_freq` 有没有掉到 266MHz。

回复还纠正了一个方法论错误：

> 别用 5–10W 的总功率去反推——SoC 没有分模块功耗读数。

#### 软件侧的降功耗手段

| 手段 | 说明 |
| --- | --- |
| 确认 CPU governor | `performance` 是最高功耗，改 `schedutil` 或限制 `scaling_max_freq` |
| DDR governor | 从 `performance` 改 `simple_ondemand`，避免常驻最高频 |
| 释放资源 | 不用的模型/编解码/摄像头节点，比调 governor 更有效 |
| 降规格 | 模型降分辨率、降帧率直接减热 |
| 关外设 | 不用的 HDMI 输出、外设节点关掉 |

**软件只能减发热、不能提升散热能力**。风扇 + 散热片的贴合与风道仍是主线。

> 来源：社区帖 35824（https://forum.d-robotics.cc/t/topic/35824）

### 5.4.5.6 用 hrut_somstatus 一眼看全

```bash
sudo hrut_somstatus
```

输出包含：CPU 温度、各核 min/cur/max 频率、BPU 两核 min/cur/max 频率与负载率。

```text
=====================1=====================
temperature-->
CPU : 61.3 (C)
cpu frequency-->
min     cur     max
cpu0: 240000  240000  1800000
cpu1: 240000  240000  1800000
bpu status information---->
min        cur        max        ratio
bpu0: 400000000 1000000000 1000000000 0
bpu1: 400000000 1000000000 1000000000 0
```

注意这份输出里 `cpu0: max 1800000` 说明该板是 X5H 或已开启超频档位；`min 240000` 则是降频后的下限（与 `throttling_temp` 触发的「CPU 最低降到 240MHz」一致）。

排查散热问题的标准动作就是：跑起目标负载 → 隔一段时间 `sudo hrut_somstatus` → 看温度是否逼近阈值、频率是否被压下来。

> 来源：官方文档 Appendix__rdk-command-manual__cmd_hrut_somstatus（https://developer.d-robotics.cc/rdk_x_doc/Appendix/rdk-command-manual/cmd_hrut_somstatus）

## 5.4.6 开机自启动

配置需要持久化的温控点、频率设置、天线选项时，都需要自启动。Ubuntu 有两种常见做法。

### 5.4.6.1 方式一：init.d 脚本 + systemd

创建启动脚本 `/etc/init.d/your_script_name`：

```bash
#!/bin/bash

### BEGIN INIT INFO
# Provides:          your_service_name
# Required-Start:    $all
# Required-Stop:
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Start your_service_name at boot time
# Description:       Enable service provided by your_service_name
### END INIT INFO

/path/to/your/program &

exit 0
```

```bash
sudo chmod +x /etc/init.d/your_script_name
sudo update-rc.d your_script_name defaults
sudo systemctl enable your_script_name
```

验证：

```bash
systemctl status your_script_name.service
```

```text
● your_script_name.service - LSB: Start your_service_name at boot time
     Loaded: loaded (/etc/init.d/your_script_name; generated)
     Active: active (exited) since Wed 2023-04-19 15:01:12 CST; 57s ago
```

### 5.4.6.2 方式二：rc.local

```bash
sudo vim /etc/rc.local
```

在 `exit 0` 之前加命令：

```bash
#!/bin/bash -e
#
# rc.local
#
# This script is executed at the end of each multiuser runlevel.
# Make sure that the script will "exit 0" on success or any other
# value on error.
#
# In order to enable or disable this script just change the execution
# bits.
#
# By default this script does nothing.

# Insert what you need
echo 85000 > /sys/devices/virtual/thermal/thermal_zone1/trip_point_1_temp
echo performance > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

exit 0
```

`rc.local` 在 systemd 普及后被视作遗留服务，但依然可用，且是「几条命令」场景下最省事的做法。

**注意 `#!/bin/bash -e` 的 `-e`**：任何命令失败就退出。对温控设置这类「失败了也不该阻塞启动」的命令，要么去掉 `-e`，要么加 `|| true`。

> 来源：官方文档 System_configuration__self_start（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/self_start）

## 常见误区

1. **把 X3 的 ION overlay 写到 X5 上**。`dtoverlay=ion_resize,size=0x40000000` 是 X3 的语法。X5 要用 `ion=ion_reserved_size=0x14000000` 三条参数。写错不会报错，只会静默不生效——这是最难发现的一类失败，因为配置文件里看起来「配好了」。

2. **在 X5 上设置 `thermal_zone0/trip_point_1_temp`**。X5 的 `thermal_zone0` 只有**一个** trip_point（管 DDR 调频），`trip_point_1_temp` 是 `thermal_zone1` 的。X3 才是 `thermal_zone0` 有三个 trip_point（启动/降频/宕机）。两套 zone 编号完全不同，跨平台照抄会让「降温设置」落在一个不存在或含义不同的节点上。

3. **以为 `boost=1` 就等于超频生效**。必须同时把 governor 切到 `performance`，否则 `schedutil` 在低负载时仍会降频。而且 `cat /sys/class/socinfo/soc_name` 显示 `X5M` 时**根本不支持超频**，设了也没用。判断超频是否真生效看 `cpuinfo_cur_freq`，不看 `scaling_cur_freq`（后者是软件缓存，不检查硬件寄存器）。

4. **不加过滤项就到文件尾部乱写**。`config.txt` 的过滤项一旦出现，**之后的配置只属于该过滤属性**直到文件结尾或下一个过滤项。在 `[rdkmd]` 后面继续写通用配置，那些配置就只对 X3 Module 生效了。另外要记住 `[x5-rdk]` 只对应 **X5 V0.1**，X5 V1.0 和 X5 MD 没有对应过滤项。

5. **用总功耗或单一温度读数反推散热问题**。SoC 没有分模块功耗读数，5~10W 的总功率推不出「是 DDR 还是 CPU」；而且 DDR 那一路读的是 SoC 内部 PVT 通道（die 上 DDR 控制器附近），**不是 LPDDR 颗粒表面温度**。「DDR 读数高」不等于「颗粒过热」，真正该看的是 `soc:ddrc-freq/cur_freq` 有没有被压到 266MHz。

6. **调 governor 来降功耗，却留着一堆跑完没释放的资源**。X5 的 BPU/GPU/ISP/CODEC/JPEG/HIFI 都有独立电源域，驱动 open 才上电、close 就下电。卸载不跑的模型、停掉不用的 pipeline，比调 governor 有效得多。软件降低的是发热量，提升不了散热能力——风扇和散热片贴合才是主线。

7. **把 `dtparam` 的参数列表当成「所有总线都能开关」**。X5 只支持 `uart1/2/3/6`、`spi1/2`、`i2c0/1/4/5`、`dw_i2s1`。想开 `uart4`、`i2c2` 这类不在列表里的总线，`srpi-config` 和 `config.txt` 都做不到，只能改设备树重编 dtb。这不是工具缺陷，是预置项的有意收敛。

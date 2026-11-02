# 40PIN 管脚与 GPIO 编程

## 本章解决什么

RDK X5 的 40PIN 排针是绝大多数外设接入的第一入口，但它是**复用**的：同一根物理针脚在不同配置下可能是 UART、I2C、SPI、PWM 或普通 GPIO，且默认状态由设备树决定、由 `srpi-config` 切换。本章给出 40PIN 的电气边界（3.3V 电平、电流上限、IO-DOMAIN）、官方文档有文字依据的功能分配表、五个总线（GPIO / I2C / SPI / UART / PWM）的可复制用法，以及 Python（`Hobot.GPIO`）与 C/C++（WiringPi 现状、sysfs、libgpiod）两条路径的真实可用性。读完应能判断"我这一根针现在到底是什么功能"，并知道改错了要怎么退回去。

---

## 1. 40PIN 的电气边界

### 1.1 电平、耐压与电流

RDK X5 的 40PIN 上所有 GPIO 都是 **3.3V 逻辑**，最大耐压 3.46V；3.3V 电源轨最大 800mA 输出，5V 最大 500mA 输出，且在这两个最大输出电流下，要求输入适配器至少具备 25W 带载能力。

三条硬约束，写死在官方文档里：

| 项目 | 数值 | 说明 |
| --- | --- | --- |
| GPIO 逻辑电平 | 3.3V | 全部数字 IO 统一 3.3V |
| GPIO 最大耐压 | 3.46V | 超过即可能造成不可逆损伤 |
| 3.3V 轨最大输出 | 800mA | 需 25W 适配器才能满载 |
| 5V 轨最大输出 | 500mA | 同上 |

官方原文还有一条操作纪律：用杜邦线连接 RDK 与其他板卡时，**必须确保 RDK 处于下电关机状态**。带电插拔 40PIN 是烧板子的常见原因之一——尤其是 5V 与 GND 相邻针脚错位一格的情况。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/40pin_define（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/40pin_define）

### 1.2 5V 针脚能不能当输入

这是一个反复被问的问题，官方 FAQ 的答案是有条件的：

- **开发板 V1.2 及以上版本**才支持把 40PIN 的 `VDD_5V` 当电源输入；版本号看 PCB 丝印确认。
- 论坛侧补充：J9 的 2、4 脚与 Type-C 电源同网络，接受输入，GND 可供电，但**官方明确"并不推荐"**。

所以正确结论是：能，但只在 V1.2+，且不推荐作为常规供电方式。用非标适配器、或同时从 Type-C 和 40PIN 5V 供电，是"上电 5V 有电压但 3.3V 起不来"类故障的高发场景。

> 来源：官方文档 FAQ/interface（https://developer.d-robotics.cc/rdk_x_doc/FAQ/interface）、社区帖 33846（https://forum.d-robotics.cc/t/topic/33846）

### 1.3 IO-DOMAIN：3.3V 不是永远成立

"40PIN 是 3.3V"这个说法在**板卡层面**成立，但在**芯片层面**是一个可配置项：X5 部分模块的电压域（IO-DOMAIN）可以在 1.8V 与 3.3V 之间配置，配置必须与外部电路的供电电压一致。

官方给出的两条失效模式非常明确：

- 外接电压域为 3.3V，而对应 IO-DOMAIN 配成 1.8V → **可能对芯片造成损伤**；
- 外接电压域为 1.8V，而对应 IO-DOMAIN 配成 3.3V → **模块可能无法正常工作**。

X5 的 IO-DOMAIN 定义在 SDK 的 `arch/arm64/boot/dts/hobot/pinmux-func.dtsi`，DTS 里已经把所有模块 1.8V / 3.3V 的配置组列全了，正常开发只需选用、不需要改。特殊的是 SD 与 SDIO：芯片 PAD 上两者电压域会被同时配置，因此由 MMC 控制器通过自定义 `power-source` 宏独立控制。

在 RDK X5 Module 载板上，这件事是显式的——载板有一个"IO 电平选择 header"（接口 18），选错就等于把 IO-DOMAIN 配错。X5 核心模组的 `GPIO_VREF`（Pin78）按设计需连接到 `MD_3.3V` 或 `MD_1.8V`。

对 40PIN 应用开发者而言，可落地的结论是：**默认整板 3.3V，不要假设任何一根针是 1.8V；如果你自己做了载板或改了 DTS，必须回头核对 IO-DOMAIN 与外部供电是否一致。**

> 来源：官方文档 Advanced_development/linux_development/driver_development_x5/driver_io_domain_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_io_domain_dev）、Quick_start/hardware_introduction/rdk_x5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/hardware_introduction/rdk_x5）

---

## 2. 40PIN 功能分配速查表

官方 40PIN 定义以引脚图形式给出（`image-20220828203147852.png`），开发板丝印网表与图一致。下面是**官方文字文档明确记载**的引脚分配，凡本文档未用文字写明的引脚，一律以官方定义图为准，不做推测：

| 物理引脚 | 功能 | 所属外设 | 出处文档 |
| --- | --- | --- | --- |
| 1、17 | 3.3V | 电源 | 论坛实测（35089、33608） |
| 3、5 | I2C5（SDA5 / SCL5） | i2c5 | i2c.md、display_rdkx5.md |
| 4 | 5V | 电源 | display_rdkx5.md |
| 6 | GND | 电源 | display_rdkx5.md |
| 8、10 | UART1（TXD / RXD） | uart1 | uart.md |
| 19、21、23、24、26 | SPI1（含两个片选） | spi1 | spi.md |
| 27、28 | I2C0（SDA0 / SCL0） | i2c0 | i2c.md |
| 24、37 | PWM1（LSIO_PWM_OUT2 / OUT3） | pwm1 | pwm.md |
| 27、28 | PWM2（LSIO_PWM_OUT5 / OUT4） | pwm2 | pwm.md |
| 29、31 | PWM0（LSIO_PWM_OUT0 / OUT1） | pwm0 | pwm.md |
| 32、33 | PWM3（LSIO_PWM_OUT6 / OUT7） | pwm3 | pwm.md |
| 31、37 | 常用作 GPIO 输入输出（示例用） | gpio | gpio.md |

需要特别注意第 24、27、28 三根针**同时出现在两个表里**：24 既是 SPI1 的引脚又是 PWM1 的输出，27/28 既是 I2C0 又是 PWM2。这不是文档错误，而是复用关系本身——见下一节。

> 来源：官方文档 Basic_Application/01_40pin_user_sample 下的 40pin_define、gpio、i2c、spi、uart、pwm 六篇（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/40pin_define）、Quick_start/display_use/display_rdkx5（https://developer.d-robotics.cc/rdk_x_doc/Quick_start/display_use/display_rdkx5）

---

## 3. 管脚复用：`srpi-config` 是唯一正解

### 3.1 复用组的官方表述（两个版本，有差异）

40PIN 默认使能 UART、SPI、I2C、I2S 等专用功能。X5 上一部分接口存在复用，**同一组复用功能中只有开启其中一项才会生效；当一组内所有复用功能都关闭时，接口才表现为普通 GPIO。**

官方两篇文档给出的复用组表并不完全一致：

| 40pin_define.md 的表述 | srpi-config.md 的表述 |
| --- | --- |
| uart3 / i2c5 | serial3 / i2c5 |
| i2c0 / pwm2 | i2c0 / pwm2 |
| spi2 / pwm0 | spi2 / pwm0 |
| spi2 / pwm1 | spi2 / pwm1 |
| i2c1 / pwm3 | i2c1 / pwm3 |

差异在第一种：一篇写 `uart3`，另一篇写 `serial3`。判断依据是 `srpi-config` 菜单里实际显示的是 `serial3`（该工具直接修改设备树对应总线的 `status`），而 uart.md 又写明 X5 在 40PIN 上默认使能的是 **UART1**（8、10 脚）。因此这三处描述不能拼在一起用：**菜单项名称以 `srpi-config` 界面为准，实际设备节点以 `ls /dev/ttyS*` 为准**，不要靠文档里的名字推断。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/40pin_define、System_configuration/srpi-config（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/srpi-config）

### 3.2 操作步骤

`srpi-config` 必须在**全屏命令行窗口**中运行，并且要 `sudo`——默认的 `sunrise` 账号不具备系统文件修改权限。

```bash
# 需要 sudo，且必须是全屏终端（SSH 直接连也行，但不能在窄窗口里跑）
sudo srpi-config
```

进入路径：`3 Interface Options` → `I3 Peripheral bus config`。

界面操作：

- 上、下方向键选择功能项；
- **回车键**开关该功能（`okay` / `disabled`）；
- 左、右键在 `Select` 与 `Exit` 之间移动，回车确认；
- 配完 `Finish`，**重启后生效**。

`okay` = 配置该管脚为专用功能；`disabled` = 关闭该管脚的专用功能，可用作 GPIO。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/40pin_define、System_configuration/srpi-config

### 3.3 复用与 GPIO 的互斥，是最容易踩的坑

顺序必须是：**先在 `srpi-config` 里把该组所有功能设为 `disabled` → 重启 → 再用 GPIO 库操作**。

如果跳过这一步，典型现象是 `GPIO.setup()` 不报错、`GPIO.output()` 也不报错，但用万用表量针脚电平不变——因为该针脚的 pinmux 还指着 i2c/spi/pwm 功能，GPIO 控制器根本没有驱动这根线。

同理，反向也成立：一旦某组开了 `okay`，该组的 GPIO 就不能再当普通 IO 用。

---

## 4. GPIO 编程（Python）

### 4.1 库名与导入：`Hobot.GPIO`，不是 `hobot.gpio`

官方预置的 GPIO Python 库是 `Hobot.GPIO`，大小写敏感：

```python
# 必须在 sudo 下运行（要访问 /dev/gpiochip*，sunrise 无权限）
sudo python3

>>> import Hobot.GPIO as GPIO
>>> GPIO.VERSION
'0.0.2'
>>> GPIO.model
'RDK_X5'
```

`GPIO.model` 返回 `RDK_X5` 是判断"库加载的是不是 X5 版本"的最快手段。

社区里有大量 `import hobot.gpio` 报错的帖子，根因就是包名写错（写成 `hobot.gpio` 或 `hobot.ghio`）。正确的两种写法只有：

```python
import Hobot.GPIO as GPIO      # 官方文档写法
```

### 4.2 四种引脚编码模式

| 模式 | 含义 | 何时用 |
| --- | --- | --- |
| `GPIO.BOARD` | 物理引脚序号，与丝印一一对应 | **推荐**，与 40PIN 表直接对应 |
| `GPIO.BCM` | 博通 SoC 的 GPIO 命名规则 | 从树莓派代码移植时 |
| `GPIO.CVM` | 用字符串代替数字，对应 CVM / CVB 连接器信号名 | 需要按信号名定位时 |
| `GPIO.SOC` | 芯片内部 GPIO 管脚序号 | 与寄存器手册对照时 |

```python
GPIO.setmode(GPIO.BOARD)   # 或 BCM / CVM / SOC
GPIO.getmode()             # 返回 BOARD/BCM/CVM/SOC 或 None
```

**编码每次只能设置一次**，想重设必须先 `GPIO.cleanup()` 再 `setmode()`。

### 4.3 输入、输出与清理

```python
GPIO.setwarnings(False)                     # 抑制"管脚已被占用"类告警
GPIO.setup(31, GPIO.OUT, initial=GPIO.LOW)  # 输出，初值低电平
GPIO.setup(37, GPIO.IN)                     # 输入
GPIO.output(31, GPIO.HIGH)                  # 输出高
value = GPIO.input(37)                      # 读回 0 或 1
GPIO.cleanup()                              # 程序退出前清理
```

批量设置与批量清理：

```python
channels = [18, 12, 13]
GPIO.setup(channels, GPIO.OUT)

GPIO.cleanup(31)              # 清单个
GPIO.cleanup((31, 37))        # 清一组（元组）
GPIO.cleanup([31, 37])        # 清一组（列表）
```

`GPIO.gpio_function(channel)` 返回 `IN` 或 `OUT`，用于确认某根针当前方向。

### 4.4 边沿检测与中断

三种方式，按适用场景选：

```python
# 1) 阻塞等待边沿，可带超时（毫秒）。超时返回 None，检测到返回通道号
GPIO.wait_for_edge(37, GPIO.FALLING, timeout=500)

# 2) 轮询：先注册，再定期查
GPIO.add_event_detect(37, GPIO.RISING)
if GPIO.event_detected(37):
    print("Rising edge event detected")

# 3) 回调：回调在独立线程里跑
def callback_fn(channel):
    print("Callback called from channel %s" % channel)

GPIO.add_event_detect(37, GPIO.RISING, callback=callback_fn, bouncetime=200)
GPIO.remove_event_detect(37)   # 不再需要时注销
```

要点：

- 边沿类型为 `GPIO.RISING` / `GPIO.FALLING` / `GPIO.BOTH`；
- **所有回调跑在同一线程上**，因此多个回调是顺序执行、不是并发；
- `bouncetime`（毫秒）用于机械按键去抖，把多次跳变合并为一次。

### 4.5 预置例程

`/app/40pin_samples/` 下预置了全套测试脚本：

| 脚本 | 作用 |
| --- | --- |
| `simple_out.py` | 单管脚输出，1 秒翻转一次 |
| `simple_input.py` | 单管脚输入，忙轮询读电平 |
| `button_led.py` | 37 脚输入控制 31 脚输出 |
| `test_all_pins.py` | 全管脚输出测试 |
| `test_all_pins_input.py` | 全管脚输入测试 |
| `button_event.py` | 捕获上升沿/下降沿事件 |
| `button_interrupt.py` | 中断方式处理边沿 |
| `simple_pwm.py` | PWM 输出 |
| `test_i2c.py` / `test_spi.py` / `test_serial.py` | I2C / SPI / UART 测试 |

运行方式（**需要 sudo**，在 `sunrise` 用户下）：

```bash
cd /app/40pin_samples/
sudo python3 ./button_led.py
```

`button_led.py` 的接线说明：用杜邦线把 37 号管脚接到 3.3V 或 GND，用它的高低电平去控制 31 号的输出。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/gpio（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/gpio）、同目录 40pin_define

### 4.6 `hb_gpioinfo`：查 PinName / PinNode / PinNum

这是 X5 专用的 GPIO 帮助工具，解决"物理引脚 → 芯片管脚名 → 内核 GPIO 编号"的映射问题。它由驱动 + 应用两部分组成：驱动解析 `pinmux-gpio.dtsi` 并把 pinnode/pinname 导出到 debugfs，应用解析后打印。

驱动代码位置：`kernel/drivers/gpio/hobot_gpio_debug.c`。

```bash
# 需要 root
root@ubuntu:~# hb_gpioinfo
gpiochip0 - 8 lines: @platform/31000000.gpio: @GPIOs 498-505
[Number] [Mode] [Status] [GpioName] [PinName] [PinNode] [PinNum]
line 0: unnamed input AON_GPIO0_PIN0 aon_gpio_0 498
line 1: unnamed input AON_GPIO0_PIN1 aon_gpio_1 499
line 2: unnamed input active-low GPIO Key Power AON_GPIO0_PIN2 aon_gpio_2 500
...
gpiochip1 - 31 lines: @platform/35060000.gpio: @GPIOs 466-496
line 0: unnamed input HSIO_ENET_MDC hsio_gpio0_0 466
...
```

三个字段的含义：

- **PinName**：SoC 上的管脚名字，与原理图上 X5 SoC 的命名一致；
- **PinNode**：设备树里的 PinNode 信息；
- **PinNum**：X5 实际对应的 GPIO 编号（写 sysfs 时用这个数）。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/gpio

---

## 5. C/C++ 路径的真实可用性

### 5.1 WiringPi：X3 能用，X5 不行

官方 FAQ 只给出了 X3 的 WiringPi 链接（"旭日 X3 派 WiringPi"），并说明 C/C++ 操作 40PIN "支持，可参考社区文章"。

社区实测结论要直接得多：

- RDK X5 上运行 X3 时代的 WiringPi，`gpio readall` 直接报错：

```
Oops: Unable to determine board revision from /proc/cpuinfo
-> Bogus board_id line (too small)
-> You'd best google the error to find out why.
```

- 官方在 2024 年的回复是"相关材料未来会释放，目前以 Python 为主"；
- 到 2025 年，X5 上 WiringPi 仍存在"无法识别板子、PWM 不可用"的兼容性问题；
- 3.4.1 版本发布说明里有一条 "WiringPi 兼容性问题修复"，说明官方在推进，但并未宣称 X5 上的 WiringPi 已完整可用。

**判断依据**：`gpio readall` 依赖 `/proc/cpuinfo` 里的 `board_id`，这是树莓派专有字段，X5 没有。这不是配置问题，是设计前提不成立。因此**不要指望把 X3 的 WiringPi C 代码直接搬到 X5 上跑**，尤其涉及 PWM 的部分。

### 5.2 可行的 C/C++ 替代方案

按可靠度排序：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| sysfs | `/sys/class/gpio/export` + `direction` + `value` | 兼容性最好，但已属内核淘汰接口，性能差 |
| libgpiod | `gpioinfo` / `gpioget` / `gpioset`，C 库有 API | 现代做法，推荐 |
| 内核态 gpiod | `gpio_request` / `gpio_direction_output` / `gpio_set_value` | 需要写驱动 |
| WiringPi | 移植 X3 版本 | X5 上不可用，不建议 |

内核态 API 原型（来自官方驱动调试文档）：

```c
#include <linux/gpio.h>

int gpio_request(unsigned gpio, const char *label);      /* 申请 GPIO */
int gpio_direction_output(unsigned gpio, int value);     /* 初始化为输出并设电平 */
int gpio_direction_input(unsigned gpio);                 /* 初始化为输入 */
int gpio_get_value(unsigned int gpio);                   /* 读电平 */
int gpio_set_value(unsigned int gpio, int value);        /* 设电平 */
```

用户态查编号：

```bash
# 需要 root；列出所有 gpiochip 与 line 的占用状态
gpioinfo

# 或从 debugfs 看内核视角的 GPIO 使用表
cat /sys/kernel/debug/gpio
```

> 来源：官方文档 FAQ/interface、Advanced_development/linux_development/driver_development_x5/driver_gpio_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_gpio_dev）、Release_Note/release_note、社区帖 28193（https://forum.d-robotics.cc/t/topic/28193）、28025（https://forum.d-robotics.cc/t/topic/28025）

---

## 6. I2C

### 6.1 默认总线

| 平台 | 默认使能 | 物理引脚 | IO 电压 |
| --- | --- | --- | --- |
| RDK X3 | I2C0 | 3、5 | 3.3V |
| RDK X5 | **I2C5** 与 **I2C0** | I2C5 → 3、5；I2C0 → 27、28 | 3.3V |

X5 比 X3 多一路默认 I2C，这是移植时的直接差异点：X3 上写死 `/dev/i2c-0` 且接在 3/5 脚的代码，搬到 X5 上会打到 27/28 脚对应的总线（I2C0），现象是"程序不报错但读不到数据"。

### 6.2 测试与扫描

```bash
# 列出系统已使能的 I2C 控制器
ls /dev/i2c*

# 扫描某条总线上的从设备（-y 跳过交互确认，-r 用读方式探测）
i2cdetect -y -r 5

# 官方测试脚本（需要 sudo）
sudo python3 /app/40pin_samples/test_i2c.py
```

`test_i2c.py` 的交互流程是：先打印已使能的 I2C 控制器列表 → 输入总线号 → 脚本内部调用 `i2cdetect` 扫描 → 输入从设备地址（16 进制）→ 从该设备读一个字节。

典型输出（`UU` 表示该地址被内核驱动占用，`--` 表示无设备）：

```
List of enabled I2C controllers:
/dev/i2c-0 /dev/i2c-1
Please input I2C BUS num:1
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
30: -- -- -- -- -- -- -- -- -- -- -- UU -- -- -- --
40: 40 -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
Please input I2C device num(Hex):40
read value= b'`'
```

读单个寄存器（比 `i2cdetect` 更有诊断价值）：

```bash
# 向 0x10 写 1 字节 0x00（寄存器地址），再读 2 字节
i2ctransfer -y 5 w1@0x10 0x00 r2

# 只探测单个地址
i2cdetect -y -r 5 0x29 0x29
```

> 来源：官方文档 Basic_Application/01_40pin_user_sample/i2c（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/i2c）

---

## 7. SPI

### 7.1 默认总线

| 平台 | 默认使能 | 物理引脚 | 片选数 | IO 电压 |
| --- | --- | --- | --- | --- |
| RDK X3 | SPI2 | 19、21、23、24 | 1 | 3.3V |
| RDK X5 | **SPI1** | 19、21、23、24、26 | 2 | 3.3V |

### 7.2 回环测试

把 **MISO 与 MOSI 用跳线帽短接**，然后运行测试：写入什么就该读回什么。

```bash
sudo python3 /app/40pin_samples/test_spi.py
```

```
List of enabled spi controllers:
/dev/spidev1.0 /dev/spidev1.1
Please input SPI bus num:1
Please input SPI cs num:0
Starting demo now! Press CTRL+C to exit
0x55 0xAA
0x55 0xAA
```

判据很干脆：打印 `0x55 0xAA` = 回环成功；打印 `0x00 0x00` = 回环失败。

核心代码只有三行：

```python
import spidev
spi = spidev.SpiDev()
spi.open(1, 0)                 # bus=1, cs=0
spi.max_speed_hz = 12000000    # 12MHz
resp = spi.xfer2([0x55, 0xAA])
```

### 7.3 SPI 做从机（slave）时的吞吐边界

把 X5 的 SPI 配成 slave 是社区高频需求（MCU 主控、X5 做协处理）。实测边界：

- CPU 定频 1.5GHz 下，MOSI 方向（X5 收）实测可达 **32MHz**；
- MISO 方向（X5 发）实测可达 **16MHz**；
- 但 8MHz、每帧 252 字节、DMA 接收、长时间运行时仍会出现 `RX FIFO overflow`。

这说明瓶颈不在 CPU 主频，而在 slave 驱动的取数时机与 FIFO 深度。排查方向是：`dmesg -w | grep -iE "spi3|fifo|dma|overflow|error"` 观察溢出是否与用户态读取阻塞同步发生，而不是先怀疑 CPU 频率。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/spi（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/spi）、社区帖 35558（https://forum.d-robotics.cc/t/topic/35558）

---

## 8. UART

### 8.1 默认总线

| 平台 | 默认使能 | 物理引脚 | IO 电压 |
| --- | --- | --- | --- |
| RDK X3 | UART3 | 8、10 | 3.3V |
| RDK X5 | **UART1** | 8、10 | 3.3V |

注意 `/dev/ttyS0` 是**系统调试口**，官方明确"不建议对它进行测试，除非你完全明白它的作用"。把业务数据打到 ttyS0 上，轻则污染内核日志，重则顶掉登录控制台。

### 8.2 回环测试

把 **TXD 与 RXD 短接**：

```bash
sudo python3 /app/40pin_samples/test_serial.py
```

```
List of enabled UART:
/dev/ttyS0 /dev/ttyS1 /dev/ttyS3 /dev/ttyUSB0
请输出需要测试的串口设备名:/dev/ttyS1
请输入波特率(9600,19200,38400,57600,115200,921600):921600
Serial (port='/dev/ttyS1', baudrate=921600, bytesize=8, parity='N', stopbits=1, timeout=1, ...)
Send: AA55
Recv: AA55
```

发送与接收一致即为通过。

### 8.3 在 40PIN 上确认设备节点

不要背总线号，直接看：

```bash
ls /dev/tty[a-zA-Z]*          # 列出所有 tty 设备
ls /dev/ttyS*                 # 只看 SoC 串口
```

> 来源：官方文档 Basic_Application/01_40pin_user_sample/uart（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/uart）

---

## 9. PWM

### 9.1 硬件资源与默认状态

`Hobot.GPIO` 库**只在带硬件 PWM 控制器的引脚上支持 PWM**，不像 `RPi.GPIO` 那样提供软件模拟 PWM。

| 平台 | PWM 能力 | 引脚 |
| --- | --- | --- |
| RDK X3 | 2 个通道 | 32、33 |
| RDK X5 | **4 组 × 2 路 = 8 路** | 见下表 |

X5 的 8 路 PWM 分配：

| PWM 组 | 通道 | 40PIN 引脚 |
| --- | --- | --- |
| PWM0 | LSIO_PWM_OUT0 | 29 |
| PWM0 | LSIO_PWM_OUT1 | 31 |
| PWM1 | LSIO_PWM_OUT2 | 37 |
| PWM1 | LSIO_PWM_OUT3 | 24 |
| PWM2 | LSIO_PWM_OUT4 | 28 |
| PWM2 | LSIO_PWM_OUT5 | 27 |
| PWM3 | LSIO_PWM_OUT6 | 32 |
| PWM3 | LSIO_PWM_OUT7 | 33 |

X5 **默认只使能 PWM3**。要用其他组，必须 `srpi-config` → `3 Interface Options` → `I3 Peripheral bus config` → 把对应 pwm 组切到 `okay`，重启后生效；同时该组占用的引脚就不能再作别的用途。

### 9.2 频率范围：官方与社区说法冲突

这是一个必须点明的冲突：

- **官方代码注释**（`simple_pwm.py` 内）：

```
# 支持的频率范围： X3: 48KHz ~ 192MHz  X5: 0.05HZ ~ 1MHZ
```

- **社区助手回复**：称 X5 硬件 PWM"最低频率限制在 48kHz 左右"，因此无法驱动需要 50Hz 的舵机，建议改用 PCA9685。

**判断依据**：官方代码注释是随系统镜像发布的示例源码，直接对应驱动实现；社区那条回复没有给出版本源或寄存器依据，且与官方注释相差三个数量级（48kHz vs 0.05Hz）。因此**以官方注释为准**，X5 的 PWM 是能从 0.05Hz 起的，可以直接输出 50Hz 舵机信号。

但这不代表"舵机随便驱动"：40PIN 的 5V 轨最大 500mA，舵机堵转电流轻松超过 1A，从 40PIN 取电给舵机是社区反复警告的错误做法——必须独立供电、只共地。

### 9.3 可运行示例（修正官方排版截断）

官方 `pwm.md` 中的示例代码在网页抓取时被截断（`if val` 之后直接接了中文说明），下面给出完整逻辑，占空比从 25% 起、每 0.25 秒 ±5%、在 0 与 100 之间往返：

```python
#!/usr/bin/env python3
import signal
import sys
import time

import Hobot.GPIO as GPIO

output_pin = 33          # BOARD 编码 33，属于 PWM3（默认已使能）

GPIO.setwarnings(False)


def signal_handler(sig, frame):
    GPIO.cleanup()
    sys.exit(0)


def main():
    GPIO.setmode(GPIO.BOARD)
    # X5 支持 0.05Hz ~ 1MHz；这里用 48kHz 便于用示波器观察
    p = GPIO.PWM(output_pin, 48000)

    val, incr = 25, 5
    p.start(val)                    # 初始占空比 25%
    print("PWM running. Press CTRL+C to exit.")
    try:
        while True:
            time.sleep(0.25)
            val += incr
            if val >= 100:
                val, incr = 100, -incr
            elif val <= 0:
                val, incr = 0, -incr
            p.ChangeDutyCycle(val)
    finally:
        p.stop()
        GPIO.cleanup()


if __name__ == '__main__':
    signal.signal(signal.SIGINT, signal_handler)
    main()
```

运行（**需要 sudo**）：

```bash
cd /app/40pin_samples/
sudo python3 ./simple_pwm.py
```

验证方式只有一种可信：**示波器或逻辑分析仪量波形**。用万用表量"平均电压"只能看个大概，无法判断频率是否正确。

> 来源：官方文档 Basic_Application/01_40pin_user_sample/pwm（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/pwm）、社区帖 35351（https://forum.d-robotics.cc/t/topic/35351）、34913（https://forum.d-robotics.cc/t/topic/34913）

---

## 10. 四段式排障

### 10.1 PWM 完全没有输出

**现象**

```python
p = GPIO.PWM(33, 48000)
p.start(50)
```

程序不报错，但示波器上针脚无波形；或改为舵机时舵机不动。

**根因**

三种可能，按概率排序：

1. 该 PWM 组在 `srpi-config` 里没使能。X5 默认只开 PWM3（32、33），用 29/31/37/24/27/28 必须手动开对应组并重启。
2. 该引脚被另一组复用功能占用。例如 24 脚同时是 SPI1 引脚和 PWM1 输出，SPI1 为 `okay` 时 PWM1 不生效。
3. 用错了库。`hobot.gpio`（全小写）不是官方库；论坛中"hobot.gpio 无 PWM 功能"的结论，源于该写法指向了非官方包。

**处置**

```bash
# 1) 全屏终端下打开配置（需要 sudo）
sudo srpi-config
# 3 Interface Options -> I3 Peripheral bus config -> 打开目标 pwm 组 -> Finish -> 重启

# 2) 重启后确认引脚功能已切换
sudo hb_gpioinfo | grep -i pwm

# 3) 确认库路径正确（这一步必须在 sudo 下）
sudo python3 -c "import Hobot.GPIO as G; print(G.VERSION, G.model)"
```

**预防**

在写代码之前先跑官方 `simple_pwm.py`（默认引脚 33、默认已使能），能出波形说明库和权限都没问题，再把引脚换到目标针脚——把"库问题"和"复用问题"分开验证。

### 10.2 `import Hobot.GPIO` 失败 / VS Code 里报红线

**现象**

```
ModuleNotFoundError: No module named 'Hobot'
```

或 VS Code 里 `import Hobot.GPIO` 有黄色波浪线，但终端能跑。

**根因**

两种：

1. 包里名字写错成 `hobot.gpio` / `hobot.ghio` / `Hobot.gpio`——Python 包名大小写敏感。
2. VS Code 选中了虚拟环境解释器（`~/.venv/bin/python`、`~/miniconda3/bin/python`、`/home/sunrise/.local/...`），而 `Hobot.GPIO` 只装在**系统 Python** `/usr/bin/python3` 里。

**处置**

```bash
# 确认用的是系统 Python
which python3
# 期望输出：/usr/bin/python3

# 验证导入
sudo python3 -c "import Hobot.GPIO; print('OK')"
```

VS Code 中按 `Ctrl+Shift+P` → `Python: Select Interpreter` → 选 `/usr/bin/python3`；若仍有红线，`Ctrl+Shift+P` → `Python: Restart Language Server`。

**预防**

永远用 `sudo /usr/bin/python3 xxx.py` 而不是裸 `python3 xxx.py`；在 VS Code 里把工作区解释器固定为系统 Python 并写进 `.vscode/settings.json`。

> 来源：社区帖 35351（https://forum.d-robotics.cc/t/topic/35351）

### 10.3 `i2cdetect` 扫不到从设备

**现象**

`i2cdetect -y -r 5` 全表 `--`；或 `i2ctransfer` 报 `Remote I/O error`；或内核打印 `slave address not acknowledged (7bit mode)` / `controller timed out`。

**根因**

按证据分三类，处理完全不同：

| 内核报错 | 指向 | 处理方向 |
| --- | --- | --- |
| `slave address not acknowledged` | 地址阶段无人应答 | 从设备没上电、未使能（LPn / OE 脚）、地址错、SDA/SCL 接反 |
| `controller timed out` + `TXFLR=3, RXFLR=0` | 命令进队列后停滞 | 总线被拉低（SDA 短路/上拉不匹配）、电平转换芯片未使能 |
| `Remote I/O error` | 传输失败 | 上拉电阻缺失、线太长、速率过高 |

关键判据：**控制器本身通不通，看空载表现**。断开从设备、只接 SDA 或只接 SCL，若能在几毫秒内返回 NACK，说明 SCL 能发、地址阶段能走完，问题在从设备侧或总线物理状态，不在 X5 少配了某项使能。

**处置**

```bash
# 1) 先确认总线存在、速率正确
ls /dev/i2c*
cat /sys/bus/i2c/devices/i2c-5/of_node/clock-frequency 2>/dev/null

# 2) 只探测单个地址，缩小范围
i2cdetect -y -r 5 0x29 0x29

# 3) 读寄存器，区分"地址不应答"和"寄存器读失败"
i2ctransfer -y 5 w1@0x10 0x00 r2

# 4) 看内核怎么说
dmesg | tail -30
```

**预防**

接线前先确认四件事：模块供电电压（3.3V 还是 5V）、模块是否需要使能脚拉高、I2C 地址是否被跳线改过、总线上有没有第二个同地址设备。X5 有两路默认 I2C（I2C5 在 3/5 脚、I2C0 在 27/28 脚），从 X3 移植时必须核对总线号。

> 来源：社区帖 35796（https://forum.d-robotics.cc/t/topic/35796）、官方文档 Basic_Application/01_40pin_user_sample/i2c

---

## 11. 常见误区

1. **"40PIN 是 3.3V，所以随便接 5V 传感器也行"**——不行。最大耐压 3.46V，5V 直接进 GPIO 就是过压。5V 器件要么用分压/电平转换，要么选 3.3V 版本。

2. **"`GPIO.output()` 成功就等于针脚有电平"**——不等于。只要该组复用功能是 `okay`，GPIO 控制器就没接管这根线，`output()` 会静默成功但针脚不动。先用 `srpi-config` 把该组全部 `disabled` 并重启。

3. **"X3 的 WiringPi 代码可以直接搬到 X5"**——不行。`gpio readall` 依赖树莓派专有的 `/proc/cpuinfo` board_id，X5 没有该字段；X5 上 WiringPi 至今仍有兼容性问题。C/C++ 请走 libgpiod 或 sysfs。

4. **"X5 的 PWM 最低只能到 48kHz，驱动不了舵机"**——与官方示例源码注释矛盾。官方注释写明 X5 支持 0.05Hz ~ 1MHz，可输出 50Hz。真正的限制是电流：40PIN 5V 只有 500mA，舵机必须独立供电、只共地。

5. **"`import hobot.gpio` 是官方写法"**——不是。官方库是 `Hobot.GPIO`（大写 H、大写 GPIO），且只在系统 Python `/usr/bin/python3` 里，虚拟环境找不到。

6. **"40PIN 的 5V 可以直接给板子供电"**——只在 V1.2 及以上版本支持，且官方明确"并不推荐"。常规供电请走 Type-C 5V/5A。

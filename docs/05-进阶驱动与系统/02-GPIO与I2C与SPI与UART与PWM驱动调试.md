---
id: 05-进阶驱动与系统-02-GPIO与I2C与SPI与UART与PWM驱动调试
volume: 5
volume_title: 进阶驱动与系统
title: GPIO 与 I2C / SPI / UART / PWM 驱动调试
lang: zh-CN
rdkos_scope: "3.0.0 ~ 3.5.0"
tags: [驱动调试, i2c, spi, uart, pwm, pinctrl]
summary: 五个总线的驱动调试方法、X5 与 X3 的驱动文件与内核配置项差异、pinctrl 与 IO-DOMAIN、引脚复用冲突定位。
source_policy: "official-first, community-verified"
---
# 5.2 GPIO 与 I2C / SPI / UART / PWM 驱动调试

## 本章解决什么

40PIN 上接一个传感器、舵机、屏幕或者下位机串口，是 X5 上最常见的二次开发动作，也是最容易卡住的地方：`i2cdetect` 全是 `--`、`/dev/spidev` 根本不存在、PWM 节点 `echo` 报 `Invalid argument`、串口发出去没回音。这些现象表面各不相同，根因往往只有三类——引脚复用没配对、设备树没开、或者拿错了芯片的功能参数。

本章按总线逐条讲**五个外设的实际调试方法**：GPIO、I2C、SPI、UART、PWM，每个都给出 sysfs 路径、寄存器地址、引脚编号和可复制的验证命令，最后统一讲 pinctrl 与 IO-DOMAIN 这两层「总开关」，以及 X5 上最容易撞车的引脚复用冲突。

**本章只讲 X5**。X3 的同类页面在 IO 管脚数、控制器数量、驱动文件名、PWM 频率范围、40PIN 默认功能上全都不同，混用会得到完全错误的结论，第 1 章已给出完整对照表。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_gpio_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_gpio_dev）

## 5.2.1 X5 的引脚资源与 40PIN 现状

先把资源盘清楚，后面的所有讨论都建立在这组数字上：

| 项目 | X5 规格 |
| --- | --- |
| IO 功能管脚总数 | 308 个 |
| 可配置为 GPIO 的管脚 | 129 个 |
| GPIO 中断能力 | 129 个 pin 全部可配中断 |
| I2C 控制器 | 8 个（I2C0~6 在 LSIO，I2C7 在 DSP），仅 I2C4 支持 high-speed 3.4M |
| SPI 控制器 | 7 个（spi0~5 在 LSIO，spi6 在 DSP），全部支持主/从模式 |
| UART 控制器 | 8 个（UART0~7），UART0 为调试串口，UART1/UART7 支持硬件流控 |
| PWM | 4 组 × 2 路 = 8 路标准 PWM，另有 2 组 LPWM（每组 4 路，供 Sensor 同步曝光） |

40PIN 上实际引出的功能（这是动手前必须核对的一张表）：

| 总线 | X5 40PIN 引出情况 | 物理引脚 | 默认状态 |
| --- | --- | --- | --- |
| I2C | I2C5 与 I2C0 | I2C5：3、5；I2C0：27、28 | 两路默认均使能 |
| SPI | SPI1 | 19、21、23、24、26（两个片选） | — |
| UART | UART1 | 8、10 | 默认使能 |
| PWM | PWM0~PWM3 共 8 路 | 见下方 PWM 表 | 默认使能 PWM3 |

IO 电压全部为 3.3V，最大耐压 3.46V。3.3V 最大输出 800mA、5V 最大输出 500mA，此时要求输入适配器至少 25W 带载能力。

> 来源：官方文档 Basic_Application__01_40pin_user_sample__40pin_define（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/40pin_define）、__i2c（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/i2c）、__spi、__uart、__pwm

## 5.2.2 引脚复用：X5 上最高频的失败原因

X5 的 40PIN 并不是「每个脚都能当任何功能用」。有若干组功能共享同一批物理引脚，**同一时刻只能生效一个**：

| 功能 1 | 功能 2 |
| --- | --- |
| `uart3` | `i2c5` |
| `i2c0` | `pwm2` |
| `spi2` | `pwm0` |
| `spi2` | `pwm1` |
| `i2c1` | `pwm3` |

规则是：同一行里**只有开启其中一项功能时才生效**；当一行的所有接口都为 disable 时，该引脚表现为普通 GPIO。

这张表解释了两类非常典型的故障：

- 你打开了 `pwm0`，但 `spi2` 之前已经开着，于是 PWM 没波形——因为 `spi2` 和 `pwm0` 抢同一批脚；
- 你想把一个脚当 GPIO 点灯，但对应的总线上还有功能开着，`echo` 方向不生效。

配置入口有两个：

```bash
# 图形化配置（推荐，需全屏命令行窗口）
sudo srpi-config
# 3 Interface Options -> I3 Peripheral bus config
```

```text
# 或者直接写 /boot/config.txt 的 dtparam（需 root）
dtparam=uart3=off
dtparam=i2c5=on
```

**改完必须重启才生效**。

> 来源：官方文档 System_configuration__srpi-config（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/srpi-config）、System_configuration__config_txt（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/config_txt）、Basic_Application__01_40pin_user_sample__40pin_define

### 5.2.2.1 一个真实的复用排查案例

社区帖 35246 里用户问「怎么把 I2C5 关掉、复用成 uart3」。这个问题本身说明了一件事：**用户以为这是两个独立开关，实际上是一组互斥项**。正确操作是进 `srpi-config` 的 Peripheral bus config，把 `i2c5` 关掉、`uart3` 打开（或者反过来），重启后生效，而不是去找「关闭 i2c5 的单独命令」。

社区帖 35816 是同一组复用的反面案例：用户报「i2c5 一直识别不到设备，逻辑分析仪只有 SCL 有波形，SDA 一直高电平」。排查建议分两步走，这个思路值得记下来：

1. 抓一帧完整传输，看 SDA 在**地址字节**里有没有跳变。
   - 如果 SDA 连地址字节的 0 位都没有低电平（始终一条直线）→ 信号根本没从主机侧出来：SDA 这根线没通、接反，或者该脚没在用 I2C5 功能。
   - 如果地址字节期间 SDA 有跳变、只在第 9 个时钟（ACK 位）保持高 → 总线时序没问题，只是这个地址上没有从机应答。此时查从机侧：模组 VCC 是否真上电、是否共地、SDA/SCL 是否接反、有没有上拉到 3.3V、器件是否处于复位状态。
2. 如果怀疑 SDA 脚本身没通，把它临时当 GPIO 输出低再读回，看逻辑分析仪上的 SDA 是否真被拉低。仍为高就说明是线/焊点/引脚功能问题，不是从机不应答。

配套的三条快速核对命令：

```bash
ls /dev/i2c-*
sudo i2cdetect -l                # 确认 /dev/i2c-5 对应的就是 40PIN 这路
sudo i2cdetect -y -r 5           # -r 用读模式探测，避免误写；显示 UU 表示地址被驱动占用
```

另外要排除一个操作误区：用户在帖中说「用 python gpio 工具对 sda 对应引脚也控制不了高低电平，scl 可以控制」。这时候**不要先判定引脚坏了**，正确顺序是：断电拔掉外设 → 上电 → 在 `srpi-config` 里把 I2C5 和 Serial3 都关闭 → 重启 → 用 `GPIO.BOARD` 编号、输出模式测试物理 3 脚 → 板端测高低电平。裸板能翻转就查线和外设；仍固定高就查复用或硬件。

> 来源：社区帖 35246（https://forum.d-robotics.cc/t/topic/35246）、社区帖 35816（https://forum.d-robotics.cc/t/topic/35816）

## 5.2.3 GPIO 调试

### 5.2.3.1 用户空间控制（sysfs）

X5 使用的 Linux 6.1 基线中，GPIO 的 sysfs 节点已被 Linux 标记为 **Obsolete**，但仍然可用。

```bash
ls /sys/class/gpio/
# export    unexport    gpiochip0 ...
```

导出、设方向、设电平、反导出：

```bash
echo 356 | sudo tee /sys/class/gpio/export
echo out | sudo tee /sys/class/gpio/gpio356/direction
echo 1 | sudo tee /sys/class/gpio/gpio356/value
# echo 0 > value 拉低
echo 356 | sudo tee /sys/class/gpio/unexport
```

导出成功后出现的 `/sys/class/gpio/gpio<N>/` 目录下三个关键属性：

| 属性 | 取值 | 说明 |
| --- | --- | --- |
| `direction` | `in` / `out` | 读为当前方向，写可设置 |
| `value` | `0` / `1` | 0 低电平，1 高电平；配为输出时可写 |
| `edge` | `none` / `rising` / `falling` / `both` | 中断触发方式，`none` 表示非中断引脚 |

**注意**：`echo 356 > export` 在某些 shell 下会因为权限提示 `Permission denied`——重定向是 shell 在做，不是 echo 在做，所以必须用 `sudo tee`，或者先 `sudo su`。

### 5.2.3.2 GPIO 编号怎么来的

这是 X5 上最容易搞错的一点。**Linux 内的 GPIO 序号是纯软件概念，会随软件改变而变化，与芯片 Pin 脚没有物理绑定关系**。所以不要记数字，用工具查：

```bash
hb_gpioinfo
```

输出三列：`PinName`（SoC 管脚名，与原理图一致）、`PinNum`（X5 实际 GPIO 编号）、`PinFunc`（设备树中已使用的复用功能）。

真实输出片段（节选）：

```text
gpiochip4 - 32 lines: @34120000.gpio: @379-410
[Number] [Mode] [Status] [GpioName] [PinName] [PinNum] [PinFunc]
line 10: unnamed input LSIO_UART3_RX 389 i2c5grp
line 11: unnamed input LSIO_UART3_TX 390 i2c5grp
line 12: unnamed input LSIO_UART4_RX 391 lsio_gpio0_12
line 13: unnamed output LSIO_UART4_TX 392 lsio_gpio0_13_rdk_v1p0
```

从这段就能读出：`LSIO_UART3_RX` 的 PinNum 是 389，当前被 `i2c5grp` 占用——这正是「UART3 与 I2C5 互斥」在运行时的直接证据。

`PinFunc` 显示 `Default` 时要小心：这表示设备树没用这个复用功能，但**不代表它是空闲的**，要去查 pinlist 里该脚的默认功能是什么。

### 5.2.3.3 内核空间 GPIO 接口

```c
/* include/linux/gpio.h */
int gpio_request(unsigned gpio, const char *label);      /* 申请 GPIO */
int gpio_direction_output(unsigned gpio, int value);     /* 初始化为输出并设电平 */
int gpio_direction_input(unsigned gpio);                  /* 初始化为输入 */
int gpio_get_value(unsigned int gpio);                    /* 获取电平 */
void gpio_set_value(unsigned int gpio, int value);        /* 设置电平 */
void gpio_free(unsigned gpio);                            /* 释放 */
int gpio_to_irq(unsigned int gpio);                       /* 申请中断，返回值可传给 request_irq/free_irq */
```

X5 的 GPIO 控制器支持上升沿/下降沿/高电平/低电平作为中断触发条件，每个作为中断的 GPIO 触发条件可独立配置。驱动源码在 `kernel/drivers/gpio/gpio-dwapb.c`，内核配置项 `GPIO_DWAPB`。

### 5.2.3.4 debugfs 看 GPIO 申请情况

```bash
mount | grep debugfs
# 若输出为空则挂载
sudo mount -t debugfs none /sys/kernel/debug

cat /sys/kernel/debug/gpio
```

真实输出（示例，实际与板端 dts 相关）：

```text
gpiochip5: GPIOs 466-497, parent: platform/35060000.gpio, 35060000.gpio:
gpio-492 ( |power ) out hi
gpiochip4: GPIOs 498-505, parent: platform/31000000.gpio, 31000000.gpio:
gpio-500 ( |GPIO Key Power ) in hi IRQ ACTIVE LOW
gpio-503 ( |id ) in hi IRQ
```

读懂它的关键：`out hi` 表示已配为输出且当前高电平，`in hi IRQ` 表示输入且已申请中断，`ACTIVE LOW` 表示低有效。如果一个脚你以为配成了输出，这里却显示 `in`，说明你的 dts 改动没生效。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_gpio_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_gpio_dev）、Basic_Application__01_40pin_user_sample__gpio（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/gpio）

## 5.2.4 I2C 调试

### 5.2.4.1 硬件能力

| 能力 | X5 规格 |
| --- | --- |
| 速度模式 | standard 0~100Kb/s、fast 0~400Kb/s、fast plus 0~1000Kb/s、high-speed 0~3.4Mb/s |
| high-speed 支持 | **仅 I2C4** |
| 主从模式 | 支持 |
| 寻址 | 7 位与 10 位 |
| 控制器总数 | 8 个（I2C0~6 在 LSIO，I2C7 在 DSP） |

驱动文件与配置：

```text
drivers/i2c/i2c-dev.c                          # I2C 字符设备接口
drivers/i2c/i2c-core-base.c                    # I2C 框架
drivers/i2c/busses/i2c-designware-platdrv.c    # DW I2C 驱动
```

```text
CONFIG_I2C_CHARDEV=y                       # 应用层字符设备
CONFIG_I2C_DESIGNWARE_PLATFORM=y           # DW I2C 驱动
```

**注意配置文件名**：X5 的 I2C 内核配置段写的是 `arch/arm64/configs/hobot_x5_soc_defconfig`，这是 SoC 级配置，与第 1 章讲的板级 `hobot_x5_rdk_ubuntu_defconfig` 是两个不同层级的文件。X3 对应的是 `CONFIG_I2C_HOBOT` 与 `i2c-hobot.c`，两套驱动完全不通用。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_i2c_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_i2c_dev）

### 5.2.4.2 调整 I2C 速率

默认 100K。改速率要在板级 dts 的对应 i2c 节点里改 `clock-frequency` 与两个 falling-time 参数。

3.4MHz（I2C4）：

```dts
&i2c4 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&i2c4grp>;
    clock-frequency = <3400000>;
    i2c-scl-falling-time-ns = <50>;
    i2c-sda-falling-time-ns = <50>;
};
```

1MHz：

```dts
&i2c4 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&i2c4grp>;
    clock-frequency = <1000000>;
    i2c-scl-falling-time-ns = <100>;
    i2c-sda-falling-time-ns = <100>;
};
```

400kHz（只需 scl falling time）：

```dts
&i2c4 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&i2c4grp>;
    clock-frequency = <400000>;
    i2c-scl-falling-time-ns = <300>;
};
```

`i2c-scl-falling-time-ns` 与 `i2c-sda-falling-time-ns` 在不同 PCB 上可能需要用示波器实测调整。官方给出的参考值基于「I2C IO 使能上拉且板端配 1k 上拉电阻」的硬件条件，换板子要重测。

**改完要重新编译 dtb 并烧录/替换**（见第 1 章），改完不重启也不会生效。

### 5.2.4.3 I2C DMA 与握手号

```dts
&i2c4 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&i2c4grp>;
    dma-names = "tx", "rx";
    dmas = <&dma 19>, <&dma 18>;
};
```

I2C DMA 握手号（X5 专用，X3 没有这张表）：

| 控制器 | RX | TX |
| --- | --- | --- |
| I2C0 | 10 | 11 |
| I2C1 | 12 | 13 |
| I2C2 | 14 | 15 |
| I2C3 | 16 | 17 |
| I2C4 | 18 | 19 |
| I2C5 | 39 | 40 |
| I2C6 | 41 | 42 |
| I2C7 | 30 | 31 |

I2C7 位于 DSP 子系统，dts 内 dma 必须绑定 DSP 子系统的 DMA，不能绑 LSIO 的。

### 5.2.4.4 用户态工具

`i2c-tools` 已包含在 X5 rootfs 中：

| 工具 | 用途 |
| --- | --- |
| `i2cdetect` | 列举 I2C bus 及该 bus 上的所有设备 |
| `i2cdump` | 显示 i2c 设备所有 register 值 |
| `i2cget` | 读某个 register |
| `i2cset` | 写某个 register |
| `i2ctransfer` | 读写一个或多个 register |

字符设备接口为 `/dev/i2c-<N>`，例如 `/dev/i2c-5` 对应 40PIN 的 I2C5。用 `i2cdetect -l` 确认编号与实际总线的对应关系，不要假设。

```bash
# 探测 40PIN 上的 I2C5
sudo i2cdetect -y -r 5

# 读一个字节
sudo i2cget -y 5 0x40 0x00

# 写一个字节
sudo i2cset -y 5 0x40 0x00 0x12
```

**`UU` 的含义**：`i2cdetect` 输出里的 `UU` 表示该地址已被内核驱动占用，不是「探测失败」。看到 `UU` 说明器件在，只是驱动已经绑了它，你不该再用用户态去抢。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_i2c_dev、Basic_Application__01_40pin_user_sample__i2c

## 5.2.5 SPI 调试

### 5.2.5.1 硬件能力与限制

X5 使用新思（Synopsys）设计 ware SSI 控制器，驱动代码：

```text
drivers/spi/spi-dw-core.c
drivers/spi/spi-dw-mmio.c
drivers/spi/spi-dw-dma.c
```

| 模式 | 限制 |
| --- | --- |
| SPI-Controller 最高频率 | 50 MHz |
| SPI-Device 最高频率 | 32 MHz |
| SPI-Device 中断模式 Rx | CPU 定频 1.5GHz 时可达 32MHz |
| SPI-Device 中断模式 Tx | CPU 定频 1.5GHz 时可达 16MHz |
| SPI-Controller 中断模式 | 均可正常通讯 |

**X5 的 SPI 控制器默认关闭**，必须按实际硬件在对应 dts 里使能。X3 的驱动是 `spi-hobot.c`、配置项 `CONFIG_SPI_SPIDEV=y`；X5 是 `CONFIG_SPI_SPIDEV=m`（模块），这个 `=m` 与 `=y` 的差别会导致「`modprobe spidev` 之前根本没有 `/dev/spidev*`」。

使能 SPI2：

```dts
&spi2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi2grp>;
};
```

带 DMA：

```dts
&spi2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi2grp>;
    dma-names = "tx", "rx";
    dmas = <&dma 24>, <&dma 25>;
};
```

SPI DMA 握手号：

| SPI | DMA TX | DMA RX |
| --- | --- | --- |
| SPI0 | 20 | 21 |
| SPI1 | 22 | 23 |
| SPI2 | 24 | 25 |
| SPI3 | 26 | 27 |
| SPI4 | 28 | 29 |
| SPI5 | 30 | 31 |
| SPI6 | 21 | 22 |

SPI6 绑定时需指定 `dsp_axi_dma`。

### 5.2.5.2 spidev 设备节点

确认 `CONFIG_SPI_SPIDEV=m` 后，还需要在 dts 里创建 dummy 设备节点才会出现 `/dev/spidev*`：

```dts
&spi2 {
    spidev@2 {
        compatible = "dr,x5-spidev";
        spi-max-frequency = <50000000>;
        reg = <2>;
    };
};
```

`compatible` 必须是 `"dr,x5-spidev"`。X3 上用的是不同的 compatible 字符串，直接抄会 probe 失败。

此外 X5 的 `config.txt` 提供了一条专用 overlay 来加 spidev：

```text
# 增加 /dev/spidev5.0
dtoverlay=dtoverlay_spi5_spidev
```

**重要限制**：CAN 设备也接在 spi5 上，`spidev` 和 `can` **只能二选一**。开了这条 overlay，`can0` 就没了。这是 X5 硬件设计的既定约束，不是配置错误。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_spi_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_spi_dev）、System_configuration__config_txt（https://developer.d-robotics.cc/rdk_x_doc/System_configuration/config_txt）

### 5.2.5.3 内部回环与外部回环测试

**内部回环**（仅 SPI Controller 支持，原理是 tx fifo 直连 rx fifo）：

```bash
sudo modprobe spidev
sudo ./spidev_tc -D /dev/spidev2.0 -v -s 1000000 -m 3 -l -e 10 -t 1
```

预期输出 TX 与 RX 完全一致：

```text
spi mode: 0x20
bits per word: 8
max speed: 1000000 Hz (1000 KHz)
userspace spi read and write test, len=10 times=1
TX | 67 C6 69 73 51 FF 4A EC 29 CD __ __ ...
RX | 67 C6 69 73 51 FF 4A EC 29 CD __ __ ...
```

**外部回环**（SPI2 作 Device，SPI1.1 作 Controller）：

Device 侧 dts：

```dts
&spi2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi2grp>;
    spi-slave;

    slave@0 {
        compatible = "dr,x5-spidev";
        spi-max-frequency = <32000000>;
        reg = <0>;
    };
};
```

Controller 侧 dts（SPI1 有两个片选，所以有两个设备节点，对应 `/dev/spidev1.0` 与 `/dev/spidev1.1`）：

```dts
&spi1 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi1grp>;

    spidev@0 {
        compatible = "dr,x5-spidev";
        spi-max-frequency = <50000000>;
        reg = <0>;
    };

    spidev@1 {
        compatible = "dr,x5-spidev";
        spi-max-frequency = <50000000>;
        reg = <1>;
    };
};
```

执行顺序**必须先 Device 后 Controller**：

```bash
# 终端 1：先启动 SPI Device，程序会阻塞等待
sudo /app/chip_base_test/05_spi_test/spidev_tc -D /dev/spidev2.0 -e 1 -v -S 64 -I 1

# 终端 2：再启动 SPI Controller 发送
sudo /app/chip_base_test/05_spi_test/spidev_tc -D /dev/spidev1.1 -e 2 -v -S 64 -I 1
```

顺序反了会因 Controller 与 Device 不同步导致接收丢数据。这一点官方文档明确写了：

> 在进行外部回环测试时，需要先执行 SPI Device 程序，再执行 SPI Controller 程序。假如先执行 SPI Controller 程序，后执行 SPI Device 程序，可能会由于 Controller 与 Device 不同步导致 SPI 接收数据出现丢失。

**接线接好了却没结果怎么办**——官方给的答案很直接：拿示波器或逻辑分析仪，接在片选和时钟线上测。这是唯一能区分「软件没发」「硬件没到」的手段。

```bash
# 顺带看一眼 pinctrl 里这些脚被谁领走了
cat /sys/kernel/debug/pinctrl/34180000.lsio_iomuxc/pinmux-pins | grep spi
```

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_spi_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_spi_dev）

## 5.2.6 UART 调试

### 5.2.6.1 硬件能力

X5 有 8 路串口 UART0~UART7：

| 特性 | 说明 |
| --- | --- |
| UART0 | 调试串口（`dsp_uart`），内核默认输出口 |
| 硬件自动流控 | **仅 UART1、UART7** 支持 |
| 波特率 | 115.2K / 230.4K / 460.8K / 921.6K / 1.5M / 2M / 4Mbps |
| 传输模式 | 中断或 DMA |
| 默认状态 | 控制器默认关闭，需在板级 dts 里使能 |

驱动文件：

```text
drivers/tty/serial/8250/8250_dw.c
drivers/tty/serial/8250/8250_dwlib.c
drivers/tty/serial/8250/8250_dwlib.h
```

内核配置：`SERIAL_8250_DW`、`SERIAL_8250_DWLIB`。

X3 用的是 `drivers/tty/serial/hobot_serial.c` 与 `CONFIG_SERIAL_HOBOT_UART`，且只有 4 路串口、仅 UART1 支持流控。两套完全不同的驱动。

### 5.2.6.2 使能串口

在板级 dts 里改 `status = "okay"`。以 `x5-rdk-v1p0.dts` 使能 uart0、uart2、uart5 为例：

```dts
&uart0 {
    status = "okay";
};

&uart2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&uart2grp>;
};

&uart5 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&uart5grp>;
};
```

### 5.2.6.3 DMA 绑定的两个硬约束

```dts
&uart7 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&uart7grp>;
    dma-names = "tx", "rx";
    dmas = <&dma 0>, <&dma 1>;
};
```

必须记住的两条：

1. **UART0（dsp_uart）作为内核默认 UART 输出，Linux 禁止使用 DMA 搬运**；
2. **配置 DMA 传输后，传输必须 16 字节对齐**。

还有一条容易漏的：**UART7 在 EVB 上默认功能是 GPIO**。要使用 UART7，必须先从 `ls_gpio0_porta` 里把 UART7 对应的 PIN（`lsio_gpio0_0`~`lsio_gpio0_3`）删掉，否则 GPIO 组会把引脚占住。

这条规则对 X5 上任何「默认是 GPIO 的复用引脚」都适用，社区帖 35761 里用户想启用 UART4 时得到的建议完全一致：UART4 的两个脚被 `lsio_gpio0_12`/`lsio_gpio0_13` 声明，必须先在 `pinmux-gpio.dtsi` 里把这两个 GPIO 组删掉或不再引用。

UART DMA 握手号：

| UART | RX | TX |
| --- | --- | --- |
| UART1 | 2 | 3 |
| UART2 | 4 | 5 |
| UART3 | 6 | 7 |
| UART4 | 8 | 9 |
| UART5 | 35 | 36 |
| UART6 | 37 | 38 |
| UART7 | 0 | 1 |

### 5.2.6.4 回环测试

硬件上把 UART1 的 TX 和 RX 短接（对应 40PIN 的 8、10 脚），然后：

```bash
# 默认波特率 4Mbps，每轮 1MB，测 100 轮，读写并发，每收发 512 字节校验一次
sudo ./uart_duplex -c 100 -d /dev/ttyS1
```

预期输出：

```text
test size:1024 Kbytes, baud:4000000
Start receive thread
Start send thread
Start recv_check thread
This is receive test 1 times
This is uart send 1 times
receive sum:102416 bytes
...
send 1024Kbytes,time:2700.000000ms, BPS:379259.250000
### Check the received data is correct ###
```

**别用 UART0 做这个测试**。UART0 是系统调试口，短接它等于把内核日志输出环回给自己，会产生大量无意义输出，严重时干扰启动。官方 40PIN 示例里也专门提醒：`/dev/ttyS0` 是系统调试口，不建议对它进行测试，除非你完全明白它的作用。

用 Python 做单字节回环更简单：

```python
import serial
ser = serial.Serial("/dev/ttyS1", 921600, timeout=1)
ser.write(b"AA55")
print("Recv:", ser.read(2))
ser.close()
```

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_uart_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_uart_dev）、Basic_Application__01_40pin_user_sample__uart（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/uart）、社区帖 35761（https://forum.d-robotics.cc/t/topic/35761）

### 5.2.6.5 用 stty 做现场快速排查

`stty` 是不需要写代码就能验证串口参数是否生效的工具：

```bash
# 查看当前参数
stty -F /dev/ttyS1 -a

# 设为 921600 8N1，原始模式（不做任何字符转换）
sudo stty -F /dev/ttyS1 921600 cs8 -cstopb -parenb raw -echo

# 从终端直接发
echo -n "AA55" | sudo tee /dev/ttyS1

# 另一终端收
sudo cat /dev/ttyS1 | hexdump -C
```

`raw` 这个选项非常关键。默认的 canonical 模式会缓冲到换行才送出，还会把 `0x0D`/`0x0A` 做转换——如果你接的是二进制协议设备，忘记 `raw` 就会出现「明明发了但对面收到的字节不对」。

## 5.2.7 PWM 调试

### 5.2.7.1 硬件能力（X5 与 X3 差异极大）

X5 有两类 PWM 控制器：

| 类型 | 数量 | 频率范围 | 占空比精度 | 用途 |
| --- | --- | --- | --- | --- |
| 标准 PWM | 4 组 × 2 路 = 8 路 | 0.05Hz ~ 1MHz | RATIO 16bit | 通用 PWM 输出 |
| LPWM | 2 组 × 4 路 | 1Hz ~ 1MHz | 输出脉宽 1us ~ 4ms | Sensor 同步曝光专用 |

标准 PWM 的周期有效时间 1us 到 20s，占空比有效时间 10ns 到 20s。

**LPWM 不是通用 PWM**，单纯 PWM 功能应该用 PWM。X3 的 PWM 是 3 组共 9 路、频率范围 192MHz~46.8KHz、RATIO 8bit——X5 的频率下限低到 0.05Hz（可以驱动 50Hz 舵机级别的低速信号），精度也从 8bit 提到 16bit。这两个数字差异是判断「你看的文档是不是 X5」的最快标志。

驱动代码：

```text
# 标准 PWM
drivers/pwm/pwm-hobot.c

# LPWM
kernel/drivers/media/platform/horizon/camsys/lpwm/
```

内核配置（注意文件名是 `hobot_x5_rdk_ubuntu_defconfig`，X5 板级）：

```text
CONFIG_HOBOT_LPWM=m
CONFIG_PWM_DROBOT=y
```

### 5.2.7.2 使能 PWM

在板级 dts 里使能。以 `x5-rdk-v1p0.dts` 使能 lpwm1_0/1_1 与 pwm0~pwm3 的全部通道为例：

```dts
&lpwm1 {
    status = "okay";
    pinctrl-names = "default";
    /** for display backlight **/
    pinctrl-0 = <&pinctrl_lpwm1_0>, <&pinctrl_lpwm1_1>;
};

&pwm0 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_pwm0_0>, <&pinctrl_pwm0_1>;
};

&pwm1 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_pwm1_0>, <&pinctrl_pwm1_1>;
};

&pwm2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_pwm2_0>, <&pinctrl_pwm2_1>;
};

&pwm3 {
    /* LSIO_PWM_OUT6 and LSIO_PWM_OUT7 */
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_pwm3_0>, <&pinctrl_pwm3_1>;
};
```

X5 默认只使能 PWM3。其他组要用 `srpi-config` 打开（`3 Interface Options -> I3 Peripheral bus config`，选对应 pwm 组切到 okay），或改 dts，**重启后生效**。

### 5.2.7.3 40PIN 引脚与 pwmchip 对应关系

这张表是 PWM 调试的必备查询表。**pwm 引脚序号、pwmchip 序号、srpi-config 里的序号三者不是一回事**，混用必然调错通道。

官方两处资料都给出过这张表，前三个通道完全一致，**第四个通道的 40PIN 引脚号有分歧**，因此把两版并列：

| 40PIN 引脚 | pwm 引脚序号 | pwmchip 序号 | srpi-config 中 pwm 序号 | dts 配置标签 | 该脚默认功能 |
| --- | --- | --- | --- | --- | --- |
| 29 | pwm0 | pwm0 | pwm0 | `pinctrl_pwm0_0` | SPI2_SCLK |
| 31 | pwm1 | pwm0 | pwm0 | `pinctrl_pwm0_1` | SPI2_SSN |
| 37 | pwm2 | pwm1 | pwm1 | `pinctrl_pwm1_0` | SPI2_MISO |
| 28 | pwm4 | pwm2 | pwm2 | `pinctrl_pwm2_0` | SCL0 |
| 27 | pwm5 | pwm2 | pwm2 | `pinctrl_pwm2_1` | SDA0 |
| 32 | pwm6 | pwm3 | pwm3 | `pinctrl_pwm3_0` | SCL1 |
| 33 | pwm7 | pwm3 | pwm3 | `pinctrl_pwm3_1` | SDA1 |

第四个通道（PWM1 第二路，pwmchip1，dts 标签 `pinctrl_pwm1_1`）的引脚号两页不一致：

| 官方页面 | 给出的 40PIN 引脚 | 该脚默认功能 |
| --- | --- | --- |
| `driver_pwm`（驱动调试页） | 18 | SPI2_MOSI |
| `40pin_user_sample/pwm`（40PIN 应用页） | 24 | LSIO_PWM_OUT3 |

两页都来自官方，且驱动页附了默认功能为 SPI2_MOSI 的说明（18 脚与 `spi2`/`pwm1` 互斥表吻合），而应用页的表格用的是 SoC 侧的 `LSIO_PWM_OUT3` 命名。**实际以你板卡的 40PIN 丝印和 `hb_gpioinfo` 输出为准**。遇到这种官方内部不一致，用工具实测判定，不要靠猜，也不要在两种说法之间反复改代码。

确认映射关系的两种方法：

```bash
# 方法一：读 pwmchip 的 uevent，看 OF_FULLNAME 地址是否与目标 pwm 对应
cat /sys/class/pwm/pwmchip0/device/uevent
```

```text
DRIVER=drobot-pwm
OF_NAME=pwm
OF_FULLNAME=/soc/a55_apb/pwm@34140000
OF_COMPATIBLE_0=d-robotics,pwm
OF_COMPATIBLE_N=1
OF_ALIAS_0=pwm0
MODALIAS=of:NpwmT(null)Cd-robotics,pwm
```

这里 `OF_ALIAS_0=pwm0` 直接告诉你是哪一组。

```bash
# 方法二：直接查已被 PWM 占用的引脚
hb_gpioinfo | grep pwm
```

```text
line 24: unnamed input LSIO_SPI3_SCLK 403 pinctrl_lpwm1_0
line 25: unnamed input LSIO_SPI3_SSN 404 pinctrl_lpwm1_1
line 9: unnamed input LSIO_I2C1_SCL 356 pinctrl_pwm3_0
line 10: unnamed input LSIO_I2C1_SDA 357 pinctrl_pwm3_1
```

注意 `403`、`404`、`356` 是**该引脚的 GPIO 编号**，与 40PIN 物理引脚号不是一个概念。这也是为什么不能凭数字硬记。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_pwm（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_pwm）、Basic_Application__01_40pin_user_sample__pwm（https://developer.d-robotics.cc/rdk_x_doc/Basic_Application/01_40pin_user_sample/pwm）

### 5.2.7.4 PWM 输出与寄存器验证

以验证 PWM0 通道 0 为例：

```bash
cd /sys/class/pwm/pwmchip0/
echo 0 | sudo tee export
cd pwm0

# 周期 100us
echo 100000 | sudo tee period
# 占空比 50% = 50us
echo 50000 | sudo tee duty_cycle
# 使能输出
echo 1 | sudo tee enable
```

**必须先设 `period` 再设 `duty_cycle`**，且 `duty_cycle` 不能大于 `period`。反序会被内核拒绝并返回 `-EINVAL`，在 shell 里表现为写不进去。

用 `devmem` 直接读寄存器确认硬件真的被配置了（PWM 基地址 `0x34170000`）：

```bash
echo "PWM_EN        `devmem 0x34170000 32`"
echo "PWM_INT_CTRL  `devmem 0x34170004 32`"
echo "PWM0_CTRL     `devmem 0x34170008 32`"
echo "PWM0_CLK      `devmem 0x34170010 32`"
echo "PWM0_PERIOD   `devmem 0x34170020 32`"
echo "PWM0_STATUS   `devmem 0x34170028 32`"
echo "PWM1_CTRL     `devmem 0x34170030 32`"
echo "PWM1_CLK      `devmem 0x34170034 32`"
echo "PWM1_PERIOD   `devmem 0x34170040 32`"
echo "PWM1_STATUS   `devmem 0x34170048 32`"
```

`devmem` 用法：`devmem ADDRESS [WIDTH [VALUE]]`，WIDTH 为 8/16/32（缺省 32），给了 VALUE 就是写，不给就是读。

```bash
# 读 32 位
devmem 0x34170000 32
# 写 32 位
sudo devmem 0x34170008 32 0x1000100
```

**写寄存器前先读出来、只改需要的 bit 再写回**。整体覆写会把驱动正在维护的其他位一起冲掉。

### 5.2.7.5 为什么 `echo 1 > enable` 会报 `Invalid argument`

社区帖 32869 里用户报：`/sys/class/pwm/pwmchip0/pwm0` 目录下的 `enable` 文件写入 `echo 1 > enable` 输出 `Invalid argument`。社区回复（@CauchyKesai）说得很准确：

> 如果不是有文档描述这么做的话，不建议随便往设备节点里面 echo 任何值，有些 pwm 并不是开放到 40pin 使用的。

这句话点出了根因：`/sys/class/pwm/pwmchip*` 下存在的通道，不代表该通道的引脚已经复用为 PWM 输出。如果对应引脚当前被 SPI2 或 I2C 占着（见前面的复用冲突表），硬件上这个 PWM 通道根本没有连出去，使能它自然会被拒绝。正确做法是先在 `srpi-config` 或 dts 里把该组 PWM 使能、确认引脚复用了，再用 sysfs。

同一帖里用户还提到「WiringPi 显示 X5 不支持 PWM」，社区给的答复是——官方推荐的方法就是操作 `/sys/class/pwm/`，且需要 root 权限。

### 5.2.7.6 hobot.gpio 能不能输出 PWM

社区帖 35351 里用户问「为什么 RDK X5 调用 hobot.gpio 无输出 PWM，只能用 Linux 原生 sysfs pwm 库」。社区给出的结论是：

- `hobot.gpio` 库用于 GPIO 数字输入/输出，**不具备生成 PWM 波形的功能**；
- 官方 `Hobot.GPIO` 库确实提供了一个 `GPIO.PWM` 类（见 40PIN 示例 `simple_pwm.py`），但它走的是硬件 PWM 通道，不是软件模拟；
- **Hobot.GPIO 库不实现软件模拟 PWM**（与 RPi.GPIO 不同）。

`simple_pwm.py` 的实际用法：

```python
import Hobot.GPIO as GPIO
import time

output_pin = 33          # 40PIN 的 33 脚，对应 PWM3 第二路
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BOARD)  # BOARD 编码 = 物理引脚序号
# 支持的频率范围： X3: 48KHz ~ 192MHz   X5: 0.05Hz ~ 1MHz
p = GPIO.PWM(output_pin, 48000)
val = 25
p.ChangeDutyCycle(val)
p.start(val)
```

代码注释里那句「X5: 0.05HZ ~ 1MHZ」就是 X5 与 X3 频率范围的直接对照，写代码时按这个设频率下限。如果目标是驱动 50Hz 舵机，X5 的 0.05Hz 下限是够的；但如果看到 X3 文档里写的「48KHz 起」，那是因为 X3 的 PWM 范围完全相反（高频端）。

社区帖 35351 里另一条建议值得记录：多路舵机场景用 PCA9685（I2C 转 16 路 PWM）比占用 X5 有限的硬件 PWM 通道更实用，尤其是需要 50Hz 精准低频的场合。

> 来源：社区帖 32869（https://forum.d-robotics.cc/t/topic/32869）、社区帖 35351（https://forum.d-robotics.cc/t/topic/35351）、官方文档 Basic_Application__01_40pin_user_sample__pwm

## 5.2.8 pinctrl：引脚复用的统一配置层

X5 的 Pinctrl 使用自研驱动，**主要通过配置 DTS 实现功能**，不需要在代码里硬编码寄存器。

驱动代码：

```text
kernel/drivers/pinctrl/hobot/aon.c
kernel/drivers/pinctrl/hobot/common.c
kernel/drivers/pinctrl/hobot/display.c
kernel/drivers/pinctrl/hobot/dsp.c
kernel/drivers/pinctrl/hobot/hsio.c
kernel/drivers/pinctrl/hobot/lsio.c
kernel/drivers/pinctrl/hobot/common.h
```

内核配置项 `CONFIG_PINCTRL_SINGLE`（X3 也是这个，但两边驱动文件完全不同）。

### 5.2.8.1 配置组的结构

驱动在 probe 时会把 `"default"` 对应的那组 pinctrl 配置写进寄存器；其他组需要在代码里解析出来再切换。以 uart2 为例：

```dts
/* arch/arm64/boot/dts/hobot/x5-rdk-v1p0.dts */
&uart2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_uart2>;
};
```

配置组本身定义在 `pinmux-func.dtsi`：

```dts
/* arch/arm64/boot/dts/hobot/pinmux-func.dtsi */
pinctrl_uart2: uart2grp {
    horizon,pins = <...>;
};
```

GPIO 功能组在 `pinmux-gpio.dtsi`：

```dts
/* arch/arm64/boot/dts/hobot/pinmux-gpio.dtsi */
lsio_gpio0_8: lsio_gpio0_8 {
    horizon,pins = <...>;
};
```

### 5.2.8.2 `horizon,pins` 的五列含义

每个 Pin 的配置包含 5 列，理解这五列是能手写 pinctrl 组的前提：

| 列 | 含义 | 取值来源 |
| --- | --- | --- |
| 第 1 列 | 相关域的 Pin id | `kernel/include/dt-bindings/pinctrl/horizon-*-pinfunc.h` |
| 第 2 列 | 功能复用配置寄存器 | 《X5 PIN SW Reg-V1.1.xlsx》 |
| 第 3 列 | 功能复用配置的 bit 偏移 | 同上 |
| 第 4 列 | 对应功能的 Pin-mux 值 | 同上 |
| 第 5 列 | 上电默认状态、驱动能力、上下拉、施密特触发、电压域 | 见下方各节 |

### 5.2.8.3 Pin-mux 值

X5 每个引脚最多支持 4 种功能：

```c
/* The macro defines the mux mode of horizon pinctrl */
#define MUX_ALT0 0x0
#define MUX_ALT1 0x1
#define MUX_ALT2 0x2
#define MUX_ALT3 0x3
```

查法举例：`LSIO_UART7_RX` 的 mux 配为 0（`MUX_ALT0`）时是 uart rx；配为 `MUX_ALT2` 时是 gpio。

### 5.2.8.4 驱动强度、上下拉、施密特、电压域

```dts
pconf_drv_pu_mid_3v3: pconf-dev-pu-mid-3v3 {
    bias-pull-up;
    power-source = <HORIZON_IO_PAD_VOLTAGE_3V3>;
    drive-strength = <8>;
};
```

支持的上下拉配置：

```text
bias-pull-up
bias-disable
bias-pull-down
```

施密特触发：

```dts
input-schmitt-enable;
```

电压域：

```c
#define HORIZON_IO_PAD_VOLTAGE_3V3 0
#define HORIZON_IO_PAD_VOLTAGE_1V8 1
```

**驱动强度配置过大可能导致芯片管脚损坏**。X5 的引脚分 GPIO 型和 SDIO 型两类，同样 bit 值在两类引脚上表示的驱动电流不一致，具体对照要查官方表格。这是少数「配错了会烧硬件」的配置项，不要靠试。

### 5.2.8.5 debugfs 查看 pinctrl 实际状态

```bash
mount | grep debugfs || sudo mount -t debugfs none /sys/kernel/debug

# lsio 域的调试节点
ls /sys/kernel/debug/pinctrl/34180000.lsio_iomuxc/
# gpio-ranges pinconf-groups pinconf-pins pingroups pinmux-functions pinmux-pins pinmux-select pins

cat /sys/kernel/debug/pinctrl/34180000.lsio_iomuxc/pinmux-pins
```

真实输出（节选）是判断「谁占了这个脚」的唯一权威来源：

```text
pin 20 (lsio_spi2_sclk): 34020000.spi (GPIO UNCLAIMED) function lsio_iomuxc group spi2grp
pin 25 (lsio_spi3_ssn): 34110000.lpwm (GPIO UNCLAIMED) function lsio_iomuxc group pinctrl_lpwm1_1
pin 28 (lsio_spi4_sclk): 341a0000.serial (GPIO UNCLAIMED) function lsio_iomuxc group uart5grp
pin 41 (lsio_i2c1_scl): 34170000.pwm (GPIO UNCLAIMED) function lsio_iomuxc group pinctrl_pwm3_0
pin 10 (lsio_uart3_rx): 341c0000.i2c (GPIO UNCLAIMED) function lsio_iomuxc group i2c5grp
```

最后一行就是「UART3 被 I2C5 占了」的铁证：物理脚叫 `lsio_uart3_rx`，但当前归属 `341c0000.i2c`，组是 `i2c5grp`。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_pinctrl_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_pinctrl_dev）

### 5.2.8.6 在驱动里使用 pinctrl

```c
static int hobot_xxx_probe(struct platform_device *pdev)
{
    g_xxx_dev->pinctrl = devm_pinctrl_get(&pdev->dev);
    if (IS_ERR(g_xxx_dev->pinctrl)) {
        dev_warn(&pdev->dev, "pinctrl get none\n");
        g_xxx_dev->pins_xxxx = NULL;
    }

    /* 按 pinctrl-names lookup state */
    g_xxx_dev->pins_xxxx = pinctrl_lookup_state(g_xxx_dev->pinctrl, "xxx_func");
    if (IS_ERR(g_xxx_dev->pins_xxxx)) {
        dev_info(&pdev->dev, "xxx_func get error %ld\n", PTR_ERR(g_xxx_dev->pins_xxxx));
        g_xxx_dev->pins_xxxx = NULL;
    }
    return 0;
}

int xxxx_pinmux_select(void)
{
    if (!g_xxx_dev->pins_xxxx)
        return -ENODEV;
    /* 切换到对应的 state */
    return pinctrl_select_state(g_xxx_dev->pinctrl, g_xxx_dev->pins_xxxx);
}
```

## 5.2.9 IO-DOMAIN：电压域配置

IO-Domain 用来配置 X5 部分模块的电压域。以 RGMII 为例，电路上外接 3.3V 就要配 3.3V，外接 1.8V 就要配 1.8V。

**配错的后果不对称，必须记住**：

| 电路实际电压 | IO-DOMAIN 配成 | 后果 |
| --- | --- | --- |
| 3.3V | 1.8V | **可能对芯片造成损伤** |
| 1.8V | 3.3V | 相应模块可能无法正常工作 |

也就是说，宁可配高不配低——配高最多不工作，配低可能烧片。

驱动代码位置：

```text
drivers/pinctrl/hobot/                      # pinctrl 驱动所在目录
include/linux/platform_data/pinctrl-single.h
```

IO-Domain 在 pinctrl-single 框架下实现，因此 DTS 写法和 pinctrl 类似。`pinmux-func.dtsi` 里已经列出了所有模块 1.8V 和 3.3V 的配置组，**一般不需要新增，选择使用即可**。

### 5.2.9.1 SD 与 SDIO 的特殊处理

这两组 IO-Domain 比较特殊：芯片 PAD 上 SD 与 SDIO 的电压域会被**同时配置**。所以默认改用 SD 及 SDIO 的 MMC 控制器来独立控制它们的 PIN 电压域，配置选项为自定义的 `power-source` 宏：

```dts
pconf_sd_sdio_ds12_padctrl_3v3: pconf-sd-sdio-ds12-padctrl-3v3 {
    bias-pull-up;
    power-source = <HORIZON_IO_PAD_VOLTAGE_3V3>;
    drive-strength = <8>;
};

pconf_sd_sdio_pu_ds12_padctrl_1v8: pconf-sd-sdio-ds12-padctrl-1v8 {
    bias-pull-up;
    power-source = <HORIZON_IO_PAD_VOLTAGE_1V8>;
    drive-strength = <8>;
};

pinctrl_sd: sdgrp {
    horizon,pins = <...>;
};

pinctrl_sdio: sdiogrp {
    horizon,pins = <...>;
};
```

### 5.2.9.2 定义一个板级特有的电压域配置

以把 pwm0 ch1 配成 1.8V 为例，先在 dts 里定义配置组：

```dts
&lsio_iomuxc {
    pinctrl_pwm0_1_1v8: pinctrl-pwm0-1_1v8 {
        horizon,pins = <...>;
    };
}
```

再在 pwm 驱动的节点里引用：

```dts
&pwm0 {
    ...
    pinctrl-names = "default";
    /* 将 pwm0 Ch1 配置为 1.8V 电压域，PWM0 功能 */
    pinctrl-0 = <&pinctrl_pwm0_1_1v8>;
    ...
};
```

驱动侧调用与 pinctrl 完全一致，只是 state 名换了：

```c
g_xxx_dev->pins_voltage = pinctrl_lookup_state(g_xxx_dev->pinctrl, "xxx_voltage_func");
if (IS_ERR(g_xxx_dev->pins_voltage)) {
    dev_info(&pdev->dev, "xxx_voltage_func get error %ld\n", PTR_ERR(g_xxx_dev->pins_voltage));
    g_xxx_dev->pins_voltage = NULL;
}
if (g_xxx_dev->pins_voltage) {
    ret = pinctrl_select_state(g_xxx_dev->pinctrl, g_xxx_dev->pins_voltage);
    if (ret)
        dev_info(&pdev->dev, "xxx_voltage_func set error %d\n", ret);
}
```

### 5.2.9.3 uboot 下也要配电压域

X5 的 Uboot 内已实现 Pinctrl 驱动，使用方法与内核一致，均通过 DTS 定义 Pin 属性。所以**改电压域要同时确认 uboot 阶段的配置**——如果 uboot 里配的是 3.3V 而内核配 1.8V，启动早期这段时间引脚就在错误电压域下工作。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_io_domain_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_io_domain_dev）

## 5.2.10 用 devmem 直接查引脚寄存器

当 dts 和 sysfs 都看不出问题时，最后一招是读寄存器。官方给的完整查询范例是 `LSIO_UART3_RXD`：

### 5.2.10.1 定位复用寄存器

1. 打开《X5 PIN SW Reg-V1.1.xlsx》，选 `PIN Mux List` 表；
2. B 列 `PinName` 找到 `LSIO_UART3_RXD` 行，F 列是默认 function，为 `LSIO_GPIO0_PIN10`；
3. 选 `LSIO PIN Control Register` 表，第一行是寄存器基地址 **`0x34180000`**；
4. A 列是偏移，G 列是功能描述。在 G 列找 `lsio_uart3_rxd PIN mux selector`，偏移为 **`0x84`**；
5. 完整地址 = 基地址 + 偏移 = `0x34180000 + 0x84` = **`0x34180084`**。

### 5.2.10.2 写入功能值

`Function[x]` 表示要配成该功能需在对应 bit 写入 `[x]`：

| Function | bit20-21 取值 | 引脚功能 |
| --- | --- | --- |
| 0 | `0x0` | uart3 rx |
| 1 | `0x1` | i2c5 scl |
| 2 | `0x2` | gpio |

这直接印证了「`uart3` 与 `i2c5` 互斥」这张表的硬件根源——它们在同一个寄存器字段上争抢。

```bash
# 读当前值
devmem 0x34180084 32
# 改 bit20-21 为 0x2（GPIO）：先读、改位、再写回
sudo devmem 0x34180084 32 0x00200000
```

### 5.2.10.3 定位属性寄存器

在 `LSIO PIN Control Register` 表 G 列找 `lsio_uart3_rxd pull up enable`，PU/PD/施密特/驱动力寄存器的偏移为 **`0x3C`**，完整地址 `0x3418003C`。

电源域（mode select）在 G 列找到包含 `LSIO_UART3_RXD` 的那行，偏移 **`0x38`**，完整地址 `0x34180038`。

**配置寄存器时，建议先把值读出来，只修改所需 bit 后再写回。**

### 5.2.10.4 GPIO 数据与方向寄存器

在 `DW_apb_gpio8_mem_map_v1.0` 和 `DW_apb_gpio32_mem_map_v1.0` 两个表里查引脚的 GPIO 方向寄存器和数值寄存器。

以 `LSIO_GPIO0_PIN10` 为例：`LSIO_GPIO0` 控制器基地址 `0x34120000`，则

| 寄存器 | 地址 |
| --- | --- |
| 数值寄存器（data） | `0x34120000` |
| 方向寄存器（direction） | `0x34120004` |
| bit 偏移 | **10**（即 GPIO 序号） |

所以读写这个脚的电平只需要操作 `0x34120000` 的 bit10。

> 来源：官方文档 Advanced_development__linux_development__driver_development_x5__driver_gpio_dev（https://developer.d-robotics.cc/rdk_x_doc/Advanced_development/linux_development/driver_development_x5/driver_gpio_dev）、Appendix__rdk-command-manual__cmd_devmem（https://developer.d-robotics.cc/rdk_x_doc/Appendix/rdk-command-manual/cmd_devmem）

## 常见误区

1. **以为 `hb_gpioinfo` 里的 PinNum 就是 40PIN 物理引脚号**。完全不是一个概念。`hb_gpioinfo` 输出的是 SoC 内部 GPIO 编号（如 403、404、356），40PIN 物理引脚号是丝印上的 1~40。用 Python `Hobot.GPIO` 时 `GPIO.BOARD` 用的是物理引脚号，而 sysfs 的 `/sys/class/gpio/export` 用的是 GPIO 编号——两套体系混用是「点灯不亮」的头号原因。

2. **在 `uart3`/`i2c5`、`spi2`/`pwm0`、`i2c0`/`pwm2`、`i2c1`/`pwm3` 这几组里同时开两个功能**。同一组只能生效一个，第二个开了也不会工作，而且不会报错。判断当前实际生效的是哪个，用 `cat /sys/kernel/debug/pinctrl/34180000.lsio_iomuxc/pinmux-pins` 看归属，不要靠 dts 猜。

3. **`echo 1 > /sys/class/pwm/pwmchipN/pwmM/enable` 报 `Invalid argument` 就以为驱动坏了**。绝大多数情况是该 PWM 通道对应的引脚没有被复用为 PWM 输出（被 SPI2 或 I2C 占着），硬件上根本没连出去。先确认复用，再操作 sysfs。同理，`/sys/class/pwm/pwmchip*` 下存在的通道不代表该通道在 40PIN 上可用。

4. **用 UART0 做回环测试或接外设**。UART0 是内核默认调试输出口，Linux 明确禁止对它使用 DMA 搬运；短接它会把内核日志环回给自己，接外设则可能干扰启动。要测回环用 UART1（40PIN 的 8、10 脚）。

5. **在 X5 上照抄 X3 的 PWM 频率范围**。X3 是 48KHz~192MHz（下限很高），X5 是 0.05Hz~1MHz（下限极低、上限也低）。想驱动 50Hz 舵机，X3 直接做不到，X5 可以；想输出 100KHz 以上的方波，X5 反而到顶了。看到「PWM 最低 48KHz」这句话就该意识到那是 X3 的文档。

6. **改完 dts 或 `srpi-config` 不重启就测**。引脚复用、PWM 使能、总线开关全部是启动阶段生效的。改完 sysfs 立刻测、看到没反应就继续乱改，只会把状态搞得更乱。先重启，再验证。

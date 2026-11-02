// 结构改造：统一 H1 + H2 编号 + 注入 YAML frontmatter
// 人类可读（层级一致、可跳转）+ AI 可解析（frontmatter / 稳定 ID / 编号锚点）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

// 卷定义：目录名 -> {vol, 卷标题}
const VOLUMES = {
  '00-导读与选型': { vol: '0', title: '导读与选型' },
  '01-开箱与系统安装': { vol: '1', title: '开箱与系统安装' },
  '02-基础开发': { vol: '2', title: '基础开发' },
  '03-AI推理与工具链': { vol: '3', title: 'AI 推理与工具链' },
  '04-ROS2与TROS': { vol: '4', title: 'ROS2 与 TROS' },
  '05-进阶驱动与系统': { vol: '5', title: '进阶驱动与系统' },
  '06-错误反思与排障': { vol: '6', title: '错误反思与排障' },
  '07-附录与速查': { vol: '7', title: '附录与速查' },
};

// 每章元数据：目录/文件名 -> {title 规范标题, tags, summary}
const META = {
  '00-导读与选型/01-这份知识库是什么.md': {
    title: '这份知识库是什么，怎么用',
    tags: ['导航', '方法论', '数据来源'],
    summary: '说明本库定位、素材来源（官方 247 页 / 社区 961 帖）、写作纪律与三条阅读路径，并给出 RDKOS 版本自查方法。',
  },
  '00-导读与选型/02-RDK-X5硬件与型号速览.md': {
    title: 'RDK X5 硬件与型号速览',
    tags: ['硬件', '规格', '内存布局', '电源'],
    summary: 'X5 与 X5 Module 的型号差异、芯片规格、14 个接口、电源与 RTC 要求、约 1150MB 保留内存布局、温度传感器。',
  },
  '00-导读与选型/03-生态全景与版本总线.md': {
    title: '生态全景与版本总线',
    tags: ['版本', 'RDKOS', 'TROS', 'OE工具链', 'ModelZoo'],
    summary: 'RDKOS / TROS / OE 工具链 / Model Zoo 四条版本线的对应关系，RDKOS 3.0.0→3.5.0 时间线，3.5.0 起 Python 推理改 hbm_runtime 的硬分界。',
  },
  '01-开箱与系统安装/01-开箱检查与配件清单.md': {
    title: '开箱检查与配件清单',
    tags: ['开箱', '配件', '规格', '供电'],
    summary: '芯片与整机规格、接口清单、5V/5A 电源要求、RTC 电池要求、官方认证配件、存储卡选用、散热与开箱检查清单。',
  },
  '01-开箱与系统安装/02-系统镜像烧录.md': {
    title: '系统镜像烧录',
    tags: ['烧录', '镜像', 'miniboot', 'RDK Studio', 'Rufus'],
    summary: '镜像获取渠道、SD 卡烧录工具选型与参数、miniboot 升级、烧录失败与变砖恢复的六类故障排查。',
  },
  '01-开箱与系统安装/03-首次启动与入门配置.md': {
    title: '首次启动与入门配置',
    tags: ['首启', '串口', 'srpi-config', '指示灯', '默认账号'],
    summary: '指示灯判读、串口登录（X5 115200 / Module 921600）、入门配置向导、时区语言输入法、默认账号与首启异常。',
  },
  '01-开箱与系统安装/04-远程登录与文件传输.md': {
    title: '远程登录与文件传输',
    tags: ['SSH', 'VNC', 'scp', '网络', '默认IP'],
    summary: 'SSH / VNC / 串口 / 网口直连四种接入方式、默认静态 IP 192.168.127.10、固定 IP 配置、跨平台文件传输。',
  },
  '01-开箱与系统安装/05-系统升级备份与恢复.md': {
    title: '系统升级、备份与恢复',
    tags: ['升级', 'apt', 'rdk-backup', 'rdk-miniboot-update', '恢复'],
    summary: 'apt 在线升级流程、升级后必须执行的 rdk-miniboot-update、rdk-backup 备份（输出介质必须 ext4）、版本回退与变砖恢复。',
  },
  '02-基础开发/01-40PIN管脚与GPIO编程.md': {
    title: '40PIN 管脚与 GPIO 编程',
    tags: ['40PIN', 'GPIO', '引脚复用', 'Hobot.GPIO', '物理引脚号'],
    summary: '40PIN 电气限制、X5 引脚复用对清单（spi2 与 pwm0/pwm1 双重冲突）、物理引脚号与 GPIO 编号的区别、Hobot.GPIO 用法、WiringPi 在 X5 不可用的原因。',
  },
  '02-基础开发/02-摄像头MIPI与USB.md': {
    title: '摄像头：MIPI 与 USB',
    tags: ['摄像头', 'MIPI', 'USB', 'V4L2', 'sensor'],
    summary: 'MIPI CSI 双路与 sensor 选型清单、srpi-config 使能、V4L2 用法、USB UVC、摄像头不出图的 L1-L5 分层判据。',
  },
  '02-基础开发/03-显示HDMI与MIPI-DSI.md': {
    title: '显示：HDMI 与 MIPI-DSI',
    tags: ['显示', 'HDMI', 'MIPI DSI', '触摸屏', 'overlay'],
    summary: 'HDMI 分辨率与时序、MIPI DSI 屏适配清单、触摸坐标问题、DSI 与 HDMI 双 ignore 文件互斥机制。',
  },
  '02-基础开发/04-音频子系统.md': {
    title: '音频子系统',
    tags: ['音频', 'ES8326', 'WM8960', '声卡拓扑', 'PulseAudio'],
    summary: '板载 ES8326 与各音频 HAT 的声卡拓扑位移（插 HAT 后 hw:0,0 指向不同硬件）、srpi-config 切换、aplay/arecord 验证。',
  },
  '02-基础开发/05-网络蓝牙与多媒体示例.md': {
    title: '网络、蓝牙与多媒体示例',
    tags: ['网络', '蓝牙', '多媒体示例', 'VIO', '编码'],
    summary: '有线/WiFi/蓝牙配网、vio2display / vio2encoder / rtsp2display / bpu / decode2display 五个多媒体示例逐个说明。',
  },
  '03-AI推理与工具链/01-BPU与ModelZoo总览.md': {
    title: 'BPU 与 Model Zoo 总览',
    tags: ['BPU', 'ModelZoo', '算力', '单核'],
    summary: 'BPU 架构与 10 TOPS 算力口径（INT8 定点、单核非双核）、支持算子边界、Model Zoo 仓库结构与本版示例目录。',
  },
  '03-AI推理与工具链/02-Python推理接口演变.md': {
    title: 'Python 推理接口演变',
    tags: ['hbm_runtime', 'pyeasy_dnn', 'bpu_infer_lib', '版本分界', '迁移'],
    summary: 'pyeasy_dnn（≤3.4.1）→ bpu_infer_lib（过渡，已停维护）→ hbm_runtime（3.5.0+）三代断代、能力矩阵、数据类型与 stride、迁移坑与示例目录对照。',
  },
  '03-AI推理与工具链/03-模型转换与hb_mapper.md': {
    title: '模型转换与 hb_mapper',
    tags: ['hb_mapper', 'ONNX', 'opset', 'yaml', '算子回退'],
    summary: 'OE 工具链 Docker 环境、hb_mapper 三段脚本流程、yaml 逐项配置、ONNX 导出约束（opset 10/11）、算子回退 CPU 的判读。',
  },
  '03-AI推理与工具链/04-量化原理与精度调优.md': {
    title: '量化原理与精度调优',
    tags: ['量化', 'PTQ', '校准集', '精度掉点', 'QAT'],
    summary: 'PTQ 校准原理、校准集构造、精度掉点的排查顺序（预处理一致性优先）、敏感层分析与混合精度、QAT 的可行性边界。',
  },
  '03-AI推理与工具链/05-板端部署与性能调优.md': {
    title: '板端部署与性能调优',
    tags: ['部署', '性能', 'hrt_model_exec', '多线程', '零拷贝'],
    summary: '模型上板流程、hrt_model_exec 验证与测速、多线程与零拷贝、性能不达预期的分层根因（算子回退 / 单核时间分片 / 拷贝开销）。',
  },
  '04-ROS2与TROS/01-TROS架构与安装.md': {
    title: 'TROS 架构与安装',
    tags: ['TROS', 'ROS2', 'Humble', 'apt源', '版本对应'],
    summary: 'TogetheROS.Bot 在 ROS2 Humble 之上的定位、tros-humble 包体系、apt 安装与 GPG 密钥、TROS 与 RDKOS 版本对应关系。',
  },
  '04-ROS2与TROS/02-图像采集与hobot_cv.md': {
    title: '图像采集与 hobot_cv',
    tags: ['mipi_cam', 'usb_cam', 'hobot_cv', '共享内存', 'QoS'],
    summary: 'mipi_cam / usb_cam 采集、hobot_cv 的 vse 加速 resize、共享内存零拷贝、话题 QoS（/hbmem_img 是 BestEffort）。',
  },
  '04-ROS2与TROS/03-dnn_node模型推理节点.md': {
    title: 'dnn_node 模型推理节点',
    tags: ['dnn_node', 'hobot_dnn', 'exit code -11', '后处理', 'parser'],
    summary: 'dnn_node_example 完整用法、模型输入输出配置、后处理、以及 exit code -11 的完整根因链（bbox 输出 F32 与 parser 按 int32 读取的不匹配）。',
  },
  '04-ROS2与TROS/04-编解码RTSP与ROS1兼容.md': {
    title: '编解码、RTSP 与 ROS1 兼容',
    tags: ['hobot_codec', 'RTSP', 'ROS1', 'ros1_bridge', 'COLCON_IGNORE'],
    summary: 'hobot_codec 编解码与 in_format 精确匹配、RTSP 拉流推流、ROS1 兼容的三条路线（X5 无 Ubuntu 20.04 的硬约束）。',
  },
  '05-进阶驱动与系统/01-驱动开发总览与内核配置.md': {
    title: '驱动开发总览与内核配置',
    tags: ['驱动', '设备树', 'uboot', '实时内核', 'ION'],
    summary: 'BSP 结构、设备树 overlay、uboot/kernel 编译配置、内核头文件、实时内核切换（X5 与 X3 方式完全不同）、ION 与保留内存调整。',
  },
  '05-进阶驱动与系统/02-GPIO与I2C与SPI与UART与PWM驱动调试.md': {
    title: 'GPIO 与 I2C / SPI / UART / PWM 驱动调试',
    tags: ['驱动调试', 'i2c', 'spi', 'uart', 'pwm', 'pinctrl'],
    summary: '五个总线的驱动调试方法、X5 与 X3 的驱动文件与内核配置项差异、pinctrl 与 IO-DOMAIN、引脚复用冲突定位。',
  },
  '05-进阶驱动与系统/03-CAN-PoE与ISP摄像头调试.md': {
    title: 'CAN、PoE 与 ISP 摄像头调试',
    tags: ['CAN', 'TCAN4550', 'PoE', 'ISP', 'sensor适配'],
    summary: 'CAN FD（TCAN4550 SPI 转 CAN）配置与收发、CAN 卡死的驱动缺陷与修复包、PoE 供电、ISP 调试与 sensor 适配三件套。',
  },
  '05-进阶驱动与系统/04-srpi-config与config.txt与Thermal频率管理.md': {
    title: 'srpi-config、config.txt 与 Thermal 频率管理',
    tags: ['srpi-config', 'config.txt', 'Thermal', '超频', '调频'],
    summary: 'srpi-config 全部选项、config.txt 语法与 dtoverlay、Thermal 两个 zone 的差异、CPU/GPU/BPU/DDR 调频与超频边界。',
  },
  '06-错误反思与排障/01-排障总纲与信息采集.md': {
    title: '排障总纲与信息采集',
    tags: ['排障', '信息采集', 'rdkos_info', '日志', '求助模板'],
    summary: '分层排障模型 L0 供电→L1 启动→L2 系统→L3 外设→L4 应用、必备采集命令、串口启动日志分段判读法、求助模板。',
  },
  '06-错误反思与排障/02-启动供电与烧录故障.md': {
    title: '启动供电与烧录故障',
    tags: ['启动', '供电', '烧录', 'miniboot', '崩溃点漂移'],
    summary: '启动链六阶段判读、10 条故障四段式复盘。核心判据：崩溃点漂移=供电/内存不稳，崩溃点固定=软件 bug。',
  },
  '06-错误反思与排障/03-网络与远程登录故障.md': {
    title: '网络与远程登录故障',
    tags: ['网络', 'SSH', 'VNC', 'IP配置', 'WiFi'],
    summary: '12 条网络与远程登录故障复盘：默认 IP 网段不匹配、Wi-Fi 掉线、SSH 拒绝、VNC 黑屏、闪连 IP 冲突。',
  },
  '06-错误反思与排障/04-摄像头与多媒体故障.md': {
    title: '摄像头与多媒体故障',
    tags: ['摄像头', 'MIPI', '多媒体', '取帧', 'ISP'],
    summary: '12 条摄像头与多媒体故障复盘：摄像头五级判据 I2C→sensor→MIPI host→ISP/VSE→topic hz、init success 与 grab failed 并存、尺寸不匹配返 -10。',
  },
  '06-错误反思与排障/05-AI推理与模型精度故障.md': {
    title: 'AI 推理与模型精度故障',
    tags: ['AI推理', '量化', '精度', 'Dequantize', 'exit code -11'],
    summary: '12 条 AI 推理与精度故障复盘：接口三代分界、反量化与 Dequantize 的语义、精度掉点的五步 Pipeline 检查。',
  },
  '06-错误反思与排障/06-ROS2与硬件接口故障.md': {
    title: 'ROS2 与硬件接口故障',
    tags: ['ROS2', 'TROS', '节点退出码', '硬件接口', '41pin'],
    summary: '16 条 ROS2 与硬件接口故障复盘：节点死亡四性质按退出码分类（-6 abort / -11 SIGSEGV / -2 正常 / 活着但无数据）、总线与外设故障。',
  },
  '07-附录与速查/01-命令与状态速查.md': {
    title: '命令与状态速查',
    tags: ['速查', '命令', 'rdkos_info', 'hrut_somstatus', '诊断'],
    summary: '按用途编组的排查命令与判读方法：系统信息、温度频率、内存、日志、存储、网络、外设、BPU、ROS2，附三分钟初诊组合。',
  },
  '07-附录与速查/02-报错速查-模型转换与推理.md': {
    title: '报错速查表：模型转换与推理',
    tags: ['速查', '报错', 'hb_mapper', 'opset', 'core dump'],
    summary: '官方 FAQ 工具链错误码重组：01_check/03_build 两阶段全部报错原文、根因、处置，含 Pipeline 五步检查与提问必供信息清单。',
  },
  '07-附录与速查/03-接口与引脚速查.md': {
    title: '接口与引脚速查',
    tags: ['速查', '引脚', '40PIN', '复用', '电气参数'],
    summary: '40PIN 电气参数（3.3V/3.46V 耐压/800mA 与 500mA 上限）、X5 引脚复用对、各总线默认配置、调试串口与传感器接口。',
  },
};

const FRONT = (m, vol, volTitle, rel) => {
  const id = rel.replace(/\.md$/, '').replace(/\//g, '-');
  return [
    '---',
    `id: ${id}`,
    `volume: ${vol}`,
    `volume_title: ${volTitle}`,
    `title: ${m.title}`,
    'lang: zh-CN',
    'rdkos_scope: "3.0.0 ~ 3.5.0"',
    `tags: [${m.tags.join(', ')}]`,
    `summary: ${m.summary}`,
    'source_policy: "official-first, community-verified"',
    '---',
    '',
  ].join('\n');
};

let changed = 0;
const report = [];

for (const [dir, volInfo] of Object.entries(VOLUMES)) {
  const absDir = path.join(DOCS, dir);
  if (!fs.existsSync(absDir)) continue;
  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.md')).sort();

  files.forEach((file, idx) => {
    const rel = `${dir}/${file}`;
    const abs = path.join(absDir, file);
    const meta = META[rel];
    if (!meta) { report.push(`!! 缺元数据: ${rel}`); return; }

    let txt = fs.readFileSync(abs, 'utf8');
    // 剥离已有 frontmatter（幂等）
    txt = txt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, '');

    const chapterNo = String(idx + 1).padStart(2, '0');
    const chapterId = `${volInfo.vol}.${idx + 1}`;

    // 统一 H1：卷X · 章Y｜标题
    txt = txt.replace(/^# .*$/m, `# ${volInfo.vol}.${idx + 1} ${meta.title}`);

    // H2 编号：跳过「本章解决什么」与结尾类，其余按 n.1 起编，前缀卷章号
    let counter = 0;
    txt = txt.replace(/^## (.+)$/gm, (line, h) => {
      const t = h.trim();
      if (/本章解决什么|常见误区|本章故障速查表|本章小结|小结|反馈与共建/.test(t)) {
        return `## ${t}`;
      }
      // 已有编号的先剥掉（形如 1.1 / 一、/ 2.3 ）
      const bare = t.replace(/^(\d+(\.\d+)*[\.\s、]+|第[一二三四五六七八九十]+[章节][\s、]*|^[一二三四五六七八九十]+[、\.]\s*)/, '').trim();
      counter += 1;
      return `## ${volInfo.vol}.${idx + 1}.${counter} ${bare}`;
    });

    txt = FRONT(meta, volInfo.vol, volInfo.title, rel) + txt;
    fs.writeFileSync(abs, txt, 'utf8');
    changed++;
    report.push(`ok ${rel}  -> # ${volInfo.vol}.${idx + 1} ${meta.title}  (H2 编号 ${counter} 个)`);
  });
}

console.log(report.join('\n'));
console.log(`\n改造 ${changed} 章`);

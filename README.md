# MEMS Sensor Dashboard

> 实时 3-DOF MEMS 传感器数据监控面板 — 基于 Web Serial API，零依赖纯前端实现。

![技术栈](https://img.shields.io/badge/Tech-HTML%20%2F%20CSS%20%2F%20JS-blue)
![API](https://img.shields.io/badge/API-Web%20Serial-green)
![版本](https://img.shields.io/badge/版本-3dof-orange)
![协议](https://img.shields.io/badge/License-MIT-lightgrey)

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 🔌 **串口连接** | 通过 Web Serial API 直连 MCU，支持扫描、选择、即点即连 |
| 📊 **Bar Chart** | 实时柱状图，双向（正负值），渐变色，正负方向圆角区分 |
| 📈 **Line Chart** | 滚动折线图（示波器风格），支持暂停 / 清除 / 时间窗口调节 |
| 🎭 **演示模式** | 无硬件时自动切换正弦波模拟数据，开箱即用 |
| 📟 **串口日志** | 原始数据实时查看，每 200 ms 批量刷新，吞吐量显示 |
| ⚡ **高性能渲染** | rAF 驱动，Canvas 2D 手绘，DPR 自适应，FPS 实时显示 |

---

## 数据格式

固件端只需通过串口按如下格式输出即可（C 语言示例）：

```c
printf("%6d, %6d, %6d\r\n", accel_x, accel_y, accel_z);
```

**示例输出：**
```
   103,   -78,   980
  -512,   256,  1001
```

- 三列分别对应 **X、Y、Z** 轴加速度（或角速度）原始 LSB 值
- 列间以逗号分隔，行尾 `\r\n`
- 仅需整数，无需浮点或额外协议

---

## 快速开始

> ⚠️ Web Serial API 要求页面运行在 `localhost` 或 `HTTPS` 下。直接双击 `index.html` 打开时 Serial API 不可用，会自动进入演示模式。

### 方式一：Python 本地服务（推荐）

```bash
cd /path/to/mems
python3 -m http.server 8080
```

浏览器访问：**http://localhost:8080**

### 方式二：VS Code Live Server

1. 安装 [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) 插件
2. 右键 `index.html` → **Open with Live Server**

### 方式三：npx serve

```bash
npx serve .
```

---

## 支持的串口芯片

| 厂商 | 芯片型号 |
|------|----------|
| WCH（沁恒） | CH340 / CH341 / CH340K / CH9102 |
| Silicon Labs | CP2102 / CP2105 / CP2106 / CP2108 |
| FTDI | FT232R / FT2232 / FT4232 / FT232H / FT-X |
| Prolific | PL2303 / PL2303HXD |
| Arduino | Uno / Mega2560 / Leonardo |
| ARM/mbed | DAPLink |

---

## 界面说明

```
┌─ Top Bar ──────────────────────────────────────────┐
│  M  MEMS Sensor Dashboard          [连接状态 ●]    │
├─ Sidebar ──┬─ Control Bar ────────────────────────┤
│            │  波特率 ▼  [扫描串口] [连接串口] [断开]│
│ Bar Charts │──────────────────────────────────────│
│ Line Charts│  Port Panel（扫描后展开，卡片式设备列）│
│            │──────────────────────────────────────│
│            │  PAGE: Bar Chart / Line Chart        │
│            │  （Canvas 实时渲染区域）              │
├────────────┴──────────────────────────────────────┤
│  Footer Tabs: Motion | Analog Frontend | Virtual  │
├───────────────────────────────────────────────────┤
│  Status Bar: 总帧数 | 错误 | 当前串口设备          │
└───────────────────────────────────────────────────┘
```

### Bar Chart 页

- Y 轴范围可选：**±1000 / ±2000 / ±4000 / ±8000 / ±32768 raw**
- 实时显示 X、Y、Z 当前数值（LSB）
- 顶部显示渲染 FPS 和解析速率（/s）

### Line Chart 页

- 可调时间窗口：10s / 30s / 60s / 2min / 5min
- Y 轴范围可独立调节
- 支持 **暂停**（冻结当前历史快照）和**清除历史**
- 最大缓存约 6 分钟（36,000 帧 @ 100 Hz）

---

## 项目结构

```
mems/
├── index.html              # 主页面（布局 + 控件）
├── css/
│   └── style.css           # 全局样式（暗色主题，CSS变量）
└── js/
    ├── serial.js            # Web Serial 驱动 + 状态管理 + 历史缓冲
    ├── app.js               # 页面路由 + 共享控件初始化
    └── pages/
        ├── bar-chart.js     # 柱状图页面模块
        └── line-chart.js    # 折线图页面模块
```

### 模块依赖关系

```
serial.js  ──→  bar-chart.js
           ──→  line-chart.js
                     ↑
              app.js（路由 + 初始化）
```

> **加载顺序**：`serial.js` → `bar-chart.js` → `line-chart.js` → `app.js`

---

## 技术实现要点

- **无框架、零依赖**：纯 HTML / CSS / JavaScript，无任何 npm 包
- **Canvas 2D 手绘图表**：DPR 感知，ResizeObserver 自适应
- **niceTick 算法**：柱状图与折线图共用同一坐标系公式，网格线严格对齐
- **环形历史缓冲**：最大 36k 条，超出后自动从头覆盖（`.shift()`）
- **批量日志刷新**：setInterval 200 ms 合并 DOM 写入，减少重绘
- **USB VID/PID 识别**：内置主流串口芯片的 VID/PID 映射表，自动识别品牌

---

## 浏览器兼容性

| 浏览器 | 最低版本 | 说明 |
|--------|----------|------|
| Chrome | 89+ | ✅ 完整支持 |
| Edge | 90+ | ✅ 完整支持 |
| Firefox | — | ❌ 不支持 Web Serial（自动演示模式） |
| Safari | — | ❌ 不支持 Web Serial（自动演示模式） |

---

## License

MIT

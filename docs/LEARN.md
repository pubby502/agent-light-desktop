# Cursor Traffic Light — 新手学习文档

> 一个用 Electron 构建的桌面红绿灯挂件，实时展示 Cursor AI 编程助手的工作状态。
> 适合 **Electron + WebSocket + Node.js** 初学者阅读。

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈](#2-技术栈)
3. [架构图](#3-架构图)
4. [项目结构](#4-项目结构)
5. [逐文件讲解](#5-逐文件讲解)
   - [挂件端（widget）](#挂件端widget)
   - [桥接端（hooks-bridge）](#桥接端hooks-bridge)
   - [测试工具（scripts）](#测试工具scripts)
6. [数据流详解](#6-数据流详解)
7. [核心概念](#7-核心概念)
8. [动手实验](#8-动手实验)

---

## 1. 项目概览

当你使用 Cursor 编辑器让 AI 帮你写代码时，AI 的状态变化很多：思考中、执行命令、等待你的确认、完成、出错……这个项目做了一个**桌面小挂件**，像一个红绿灯，用不同颜色和闪烁效果告诉你 AI 当前在干什么。

```
Cursor AI 状态变化
    ↓
hooks-bridge（桥接脚本，解析事件）
    ↓  WebSocket
widget（Electron 桌面挂件，红绿灯显示）
```

---

## 2. 技术栈

| 技术 | 作用 | 你需了解的 |
|---|---|---|
| **Electron** | 把网页打包成桌面应用 | HTML/CSS/JS 就能写桌面软件 |
| **Node.js** | JavaScript 运行环境 | 文件读写、进程管理、网络通信 |
| **WebSocket** | 实时双向通信 | 桥接脚本 ↔ 挂件之间的消息管道 |
| **CSS Animations** | 红绿灯闪烁效果 | `@keyframes` 动画 |
| **npm workspaces** | 单仓库多子项目 | 根目录统一管理依赖 |
| **electron-builder** | 打包成 .exe 分发 | 一键生成安装包 |

---

## 3. 架构图

```
┌──────────────────────────────────────────────┐
│                  Cursor 编辑器                │
│  Hook 事件: 思考/执行/停止/Plan/提问...       │
│  通过 ~/.cursor/hooks.json 配置触发           │
└──────────────────┬───────────────────────────┘
                   │ 调用命令行
                   ▼
┌──────────────────────────────────────────────┐
│         hooks-bridge/agent-light.js           │
│  ┌────────────┐  ┌──────────┐  ┌───────────┐ │
│  │ 事件解析    │→│ 状态机    │→│ 防抖去重  │ │
│  │ HOOK_INPUT │  │ 6种状态  │  │ state.json│ │
│  └────────────┘  └──────────┘  └───────────┘ │
│                      │                        │
│              WebSocket 发送                   │
└──────────────────────┼────────────────────────┘
                       │ ws://127.0.0.1:17654
                       ▼
┌──────────────────────────────────────────────┐
│            widget/ (Electron 桌面挂件)         │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ server.js│→│ main.js  │→│ renderer/   │  │
│  │ WS 服务端│  │ Electron │  │ 红绿灯 UI  │  │
│  │ 端口17654│  │ 无边框窗 │  │ HTML/CSS   │  │
│  └──────────┘  └──────────┘  └────────────┘  │
└──────────────────────────────────────────────┘
```

---

## 4. 项目结构

```
traffic-light/
│
├── package.json              # 根配置（npm workspaces 管理）
├── BUILD.md                  # 打包分发说明书
│
├── widget/                   # ★ Electron 桌面挂件
│   ├── package.json          #   挂件专属配置 + electron-builder 打包配置
│   ├── main.js              # ★ Electron 主进程（窗口、托盘、生命周期）
│   ├── preload.js           #   安全桥接（主进程 ↔ 渲染进程）
│   ├── server.js            #   WebSocket 服务端（接收桥接脚本消息）
│   ├── renderer/
│   │   ├── index.html       #   挂件 UI 结构
│   │   ├── renderer.js      #   挂件 UI 逻辑（状态切换、超时）
│   │   └── style.css        #   挂件样式（红绿灯 CSS 动画）
│   └── dist/                #   [构建产物] 打包好的 .exe 文件
│
├── hooks-bridge/            # ★ 桥接脚本（Cursor Hooks 调用）
│   └── agent-light.js       #   核心：事件解析 → 状态机 → WS 发送
│
├── scripts/                 # 测试工具
│   └── test-client.js       #   手动模拟 WS 客户端，测试挂件
│
└── docs/                    # 文档（当前目录）
    └── LEARN.md             #   本文件
```

---

## 5. 逐文件讲解

---

### 挂件端（widget）

#### `widget/package.json` — 项目身份证

```json
{
  "name": "traffic-light-widget",  // 包名
  "version": "0.1.0",             // 版本号（打包时写入 exe）
  "main": "main.js",               // Electron 入口文件
  "scripts": {
    "start": "electron .",         // npm run start → 启动开发模式
    "build": "electron-builder --win"  // npm run build → 打包成 exe
  },
  "dependencies": {
    "ws": "^8.18.0"               // WebSocket 库（运行时需要）
  },
  "devDependencies": {
    "electron": "31.7.7",         // Electron 框架（开发时用）
    "electron-builder": "^26.8.1" // 打包工具（开发时用）
  },
  "build": {                       // ★ electron-builder 打包配置
    "appId": "com.cursor.traffic-light",
    "productName": "Cursor Traffic Light",  // 生成的 exe 名称
    "win": {
      "target": [
        { "target": "nsis" },      // 生成安装包 .exe
        { "target": "portable" }   // 生成便携版 .exe
      ]
    }
  }
}
```

**关键概念：**
- `dependencies` 和 `devDependencies` 的区别：`dependencies` 会打包进 exe，`devDependencies` 只在开发时用
- `main` 字段告诉 Electron 从哪个 JS 文件启动

---

#### `widget/main.js` — Electron 主进程（应用的大脑）

这是整个挂件的**入口文件**。Electron 应用启动时首先执行它。分为几个部分：

**① 窗口创建**

```javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 110,           // 宽 110 像素
    height: 260,          // 高 260 像素
    frame: false,         // 无边框（看起来像悬浮挂件）
    transparent: true,    // 背景透明
    alwaysOnTop: true,    // 始终置顶
    skipTaskbar: true,    // 不在任务栏显示
    resizable: false,     // 不可调整大小
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),  // 预加载脚本
      contextIsolation: true,   // 上下文隔离（安全）
      nodeIntegration: false,   // 渲染进程禁用 Node.js（安全）
    },
  });
  mainWindow.loadFile('renderer/index.html');  // 加载 UI 页面
}
```

**关键概念：**
- **主进程**：控制窗口、托盘、系统菜单
- **渲染进程**：显示 HTML/CSS/JS 页面
- 两者通过 `preload.js` 安全通信（不能直接在渲染进程用 `require('fs')`）

**② 系统托盘**

```javascript
function createTray() {
  tray = new Tray(icon);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => { ... } },
    { label: '置顶', type: 'checkbox', ... },
    { label: '退出', click: () => app.quit() },
  ]));
}
```

系统托盘图标在右下角通知区域，右键菜单可以显示/隐藏挂件、切换置顶、退出。

**③ 窗口位置记忆**

```javascript
function loadWindowState() { /* 从文件读取上次位置 */ }
function saveWindowState() { /* 把位置写入文件 */ }
```

每次关闭挂件时，会把窗口位置存到 `userData/window-state.json`。下次启动自动恢复位置。

**④ 接收 WebSocket 消息**

```javascript
wsServer = startServer({
  onStatus: broadcastStatus,          // 收到状态 → 发给渲染进程
  onConnectionChange: broadcastConnection,  // 连接变化 → 发给渲染进程
});
```

---

#### `widget/preload.js` — 主进程 ↔ 渲染进程的桥梁

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, value) => cb(value)),
  onConnectionChanged: (cb) => ipcRenderer.on('connection-changed', ...),
  getInitial: () => ipcRenderer.invoke('get-initial'),
});
```

**关键概念：**
- `contextBridge` 安全地向渲染进程暴露 API
- 渲染进程通过 `window.electronAPI.onStatus(...)` 监听主进程消息
- 不能直接在渲染进程调用 Node.js API（`contextIsolation: true`）

---

#### `widget/server.js` — WebSocket 服务端

```javascript
const wss = new WebSocketServer({ port: 17654, host: '127.0.0.1' });
```

核心逻辑：
1. 监听 `127.0.0.1:17654` 端口
2. 当桥接脚本连接上来时，接收 JSON 消息：`{ type: 'status', value: 'thinking' }`
3. 把状态转发给 `main.js` → `broadcastStatus()` → 渲染进程

```javascript
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'status' && VALID_STATUSES.has(msg.value)) {
    onStatus(msg.value);  // 回调通知 main.js
  }
});
```

**注意：** 使用 `127.0.0.1` 而不是 `localhost`，避免 Windows 上 IPv6 解析问题。

---

#### `widget/renderer/index.html` — UI 结构

```html
<div class="light-box" id="lightBox" data-status="idle">
  <div class="light red"></div>      <!-- 红灯 -->
  <div class="light yellow"></div>   <!-- 黄灯 -->
  <div class="light green"></div>    <!-- 绿灯 -->
  <div class="conn-dot"></div>       <!-- 连接状态小点 -->
  <div class="label">IDLE</div>      <!-- 状态文字 -->
</div>
```

结构很简单：一个外壳容器里装三盏灯 + 一个连接指示灯 + 状态文字。

---

#### `widget/renderer/renderer.js` — UI 逻辑

```javascript
function applyStatus(value) {
  box.dataset.status = value;    // 设置 data-status 属性
  label.textContent = LABELS[value];  // 更新文字

  // 设置超时自动回到 idle
  const ms = TIMEOUTS[value];
  if (ms > 0) {
    timeoutId = setTimeout(() => applyStatus('idle'), ms);
  }
}
```

**工作原理：**
1. 主进程发来状态（如 `'thinking'`）
2. `applyStatus()` 给 `.light-box` 设置 `data-status="thinking"`
3. CSS 根据 `data-status` 属性决定哪些灯亮、怎么闪

**超时机制：** 每种状态都有超时时间，超过后自动切回 IDLE。避免状态"卡住"。

- thinking/busy → 5 分钟超时
- success/error → 30 秒超时
- alarm → 10 分钟超时
- idle → 永不过期

---

#### `widget/renderer/style.css` — 红绿灯视觉效果

CSS 的精髓是通过 `data-status` 属性选择器来控制动画：

```css
/* idle 状态：三灯暗光 */
.light-box[data-status="idle"] .light.red {
  background: radial-gradient(...#5a3030, #3a1010);  /* 暗红色 */
}

/* thinking 状态：跑马灯动画 */
.light-box[data-status="thinking"] .light.red   { animation: think-red    1.5s infinite; }
.light-box[data-status="thinking"] .light.yellow { animation: think-yellow 1.5s infinite; }
.light-box[data-status="thinking"] .light.green  { animation: think-green  1.5s infinite; }

/* busy 状态：黄灯慢闪 */
.light-box[data-status="busy"] .light.yellow { animation: busy-blink 0.8s infinite; }

/* success 状态：绿灯常亮 */
.light-box[data-status="success"] .light.green { /* 亮绿色 */ }

/* error 状态：红灯快闪 */
.light-box[data-status="error"] .light.red { animation: error-blink 0.4s infinite; }

/* alarm 状态：红黄交替 */
.light-box[data-status="alarm"] .light.red    { animation: alarm-red    1s steps(1) infinite; }
.light-box[data-status="alarm"] .light.yellow { animation: alarm-yellow 1s steps(1) infinite; }
```

**六种状态视觉效果：**

| 状态 | 灯效 | 含义 |
|---|---|---|
| `idle` | 三灯暗光 | AI 空闲，等待你的指令 |
| `thinking` | 绿→黄→红跑马灯 | AI 正在思考 |
| `busy` | 黄灯慢闪 | AI 正在执行工具（写文件、运行命令） |
| `success` | 绿灯常亮 | 任务顺利完成 |
| `error` | 红灯快闪 | 任务出错或被中断 |
| `alarm` | 红黄交替闪烁 | AI 在等你（提问、Plan 等待确认） |

---

### 桥接端（hooks-bridge）

#### `hooks-bridge/agent-light.js` — 核心桥接逻辑

这是整个系统最复杂的文件（610 行）。它被 Cursor 的 Hook 系统调用，负责把 AI 事件翻译成挂件状态。

**① 事件输入**

Cursor Hook 调用时传入两个数据源：
- `HOOK_INPUT` 环境变量：JSON 格式的事件数据
- `stdin` 管道：某些事件可能只走管道

```javascript
const rawEnv = process.env.HOOK_INPUT;  // 环境变量
const stdinData = await readStdin();     // 管道输入
```

**注意：** Windows 上 Cursor 的 stdin 可能带有 BOM 字符（`U+FEFF`），需要去掉后再解析 JSON。

**② 状态机（gateCheck）**

"状态机" 是一个编程概念：系统在不同状态之间按规则切换。比如：

```
当前状态: idle
收到事件: turn-start（用户发了新消息）
    ↓ gateCheck
新状态: thinking
```

`gateCheck` 函数实现了**防抖**和**相位阻塞**：
- **防抖**：相同状态短时间内重复发送会被忽略（避免闪烁）
- **相位阻塞**：busy 状态期间，thinking 事件不会覆盖 busy

```javascript
// 防抖示例：5000ms 内重复的 thinking 事件被忽略
if (mode === lastMode && (now - lastTs) < 5000) {
  send = false;  // 不发
}
```

**③ Plan 模式检测**

Cursor 有个 "Plan"（计划）模式：AI 先生成计划让你审阅，你点 Build 后才执行。

桥接脚本检测以下信号来判断 AI 在等你确认计划：
- 文本中有 "执行计划"、"Review Plan"、"Build 即可" 等关键词
- 文件路径匹配 `*.plan.md` 或 `.cursor/plans/`
- 计划文件最近 8 分钟内被修改

检测到后，挂件显示 **alarm**（红黄交替），提醒你去看。

**④ 状态持久化（state.json）**

所有状态存到 `state.json` 文件，跨 Hook 调用保持上下文：

```json
{
  "lastMode": "thinking",
  "lastTs": 1716900000000,
  "turnPhase": "busy",
  "awaitingBuild": false,
  "buildStarted": true,
  "planTouched": true,
  "turnStartedMs": 1716899000000
}
```

**⑤ WebSocket 发送**

```javascript
ws = new WebSocket('ws://127.0.0.1:17654');
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'status', value: 'thinking' }));
  ws.close();  // 发完就断（无连接池）
});
```

**注意：** 连接是瞬态的（连→发→断），不是持久连接。因为 Hook 调用很快（<1秒），保持长连接没必要。

---

### 测试工具（scripts）

#### `scripts/test-client.js` — 手动测试挂件

```bash
# 循环测试所有 6 种状态
node scripts/test-client.js

# 测试单个状态
node scripts/test-client.js thinking
```

**用法：** 先启动挂件，再运行这个脚本。你会看到挂件依次展示 6 种状态。

---

## 6. 数据流详解

从头到尾一条完整路径：

```
1. 你在 Cursor 里发了一条消息："帮我写一个排序函数"
                ↓
2. Cursor Hooks 触发 beforeSubmitPrompt 事件
   调用: node agent-light.js turn-start
   传入: HOOK_INPUT={"matcher":"UserPromptSubmit","text":"帮我写..."}
                ↓
3. agent-light.js 解析事件
   → gateCheck('turn-start', 'thinking')
   → 发送 WebSocket: { type: 'status', value: 'thinking' }
                ↓
4. widget/server.js 收到 WS 消息
   → 解析 JSON → 校验状态值
   → onStatus('thinking') 回调
                ↓
5. widget/main.js 收到回调
   → broadcastStatus('thinking')
   → mainWindow.webContents.send('status', 'thinking')
                ↓
6. widget/preload.js 转发 IPC 消息
   → window.electronAPI.onStatus(callback)
                ↓
7. widget/renderer/renderer.js
   → applyStatus('thinking')
   → box.dataset.status = 'thinking'
   → label.textContent = 'THINK'
                ↓
8. widget/renderer/style.css
   → [data-status="thinking"] 选择器生效
   → 跑马灯动画播放
                ↓
9. 你看到：红绿灯在跑马灯
   你知道：AI 在思考
```

---

## 7. 核心概念

### Electron 的双进程模型

```
┌─ 主进程 (Main Process) ─┐     ┌─ 渲染进程 (Renderer) ─┐
│                          │     │                        │
│  main.js                 │ IPC │  renderer.js           │
│  - 创建窗口               │←───→│  - 操控 HTML/CSS        │
│  - 系统托盘               │     │  - 不能直接用 Node.js   │
│  - 文件读写               │     │                        │
│  - WebSocket 服务         │     │  preload.js            │
│                          │     │  - 暴露安全 API         │
└──────────────────────────┘     └────────────────────────┘
```

### WebSocket vs HTTP

| | HTTP | WebSocket |
|---|---|---|
| 连接方式 | 请求→响应→断开 | 持久连接 |
| 推送能力 | 客户端轮询 | 服务端主动推送 |
| 本项目用法 | ❌ | 桥接脚本 → 挂件（瞬时推送） |

### 防抖（Debounce）

防止同一个事件在短时间内重复触发。比如 Cursor 连续调用 3 次 `preToolUse`，桥接脚本只在第一次发送 `busy`。

### 状态机（State Machine）

预先定义好的状态和转换规则。本项目的 6 种状态和它们的转换规则构成了一个状态机。

---

## 8. 动手实验

### 实验 1：启动挂件（开发模式）

```bash
cd F:\traffic-light\widget
npm run start
```

你会看到一个悬浮的红绿灯挂件出现在屏幕右下角。

### 实验 2：手动测试所有状态

```bash
# 新开一个终端
cd F:\traffic-light
node scripts/test-client.js
```

观察挂件依次展示：IDLE → THINK → BUSY → DONE → ERROR → ALARM

### 实验 3：修改 CSS 看效果

编辑 `widget/renderer/style.css`，找到 `busy-blink` 动画：

```css
@keyframes busy-blink {
  0%, 49.999% { opacity: 1; }
  50%, 100%   { opacity: 0.45; }
}
```

把 `0.8s` 改成 `0.2s`（更快闪烁），重启挂件看看变化。

### 实验 4：读懂数据流

在 `widget/server.js` 的 `ws.on('message', ...)` 里加一行：

```javascript
console.log('[DEBUG] 收到消息:', raw.toString());
```

重启挂件，再跑 `test-client.js`，看终端输出的消息。

---

## 延伸学习

- [Electron 官方文档](https://www.electronjs.org/docs)
- [WebSocket 协议简介](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket)
- [CSS @keyframes 动画](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@keyframes)
- [Cursor Hooks 文档](https://docs.cursor.com/agent/hooks)

# Agent Traffic Light — 新手学习文档

> 一个用 Electron 构建的桌面红绿灯挂件，实时展示 AI 编程助手的工作状态。
> 支持 **Cursor** / **Claude Code** 等多种 Agent。
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

当你使用 AI 编程助手（Cursor、Claude Code 等）写代码时，AI 会经历多种状态：思考、执行、等待你确认、完成、出错……这个项目做了一个**桌面小挂件**，像一个红绿灯，用不同颜色和闪烁效果告诉你 AI 当前在干什么。

**v2 新增：** 支持两种 Agent，右键托盘一键切换。首次启动自动配置 hooks，无需手动操作。

```
Agent 状态变化 (Cursor / Claude / ...)
    ↓
hooks-bridge（桥接脚本，共享状态机 + 防抖）
    ↓  WebSocket
widget（Electron 桌面挂件，红绿灯显示）
```

---

## 2. 技术栈

| 技术 | 作用 | 你需了解的 |
|------|------|-----------|
| **Electron** | 把网页打包成桌面应用 | HTML/CSS/JS 就能写桌面软件 |
| **Node.js** | JavaScript 运行环境 | 文件读写、进程管理、网络通信 |
| **WebSocket** | 实时双向通信 | 桥接脚本 ↔ 挂件之间的消息管道 |
| **CSS Animations** | 红绿灯闪烁效果 | `@keyframes` 动画 |
| **npm workspaces** | 单仓库多子项目 | 根目录统一管理依赖 |
| **electron-builder** | 打包成安装包分发 | 一键生成 Win/Mac/Linux 安装包 |

---

## 3. 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                     Agent 层（状态来源）                        │
│                                                              │
│  Cursor          Claude Code                               │
│  hooks.json      settings.json                             │
│  (编辑器内置)      (项目级/全局)                               │
└────────┬─────────────────┬──────────────────────────────────┘
         │                 │
         ▼                 ▼
┌──────────────────────────────────────────────────────────────┐
│                   hooks-bridge/（桥接层）                       │
│                                                              │
│  cursor-bridge.js   claude-bridge.js                          │
│         │                 │                                   │
│         └─────────────────┘                                   │
│                           ▼                                   │
│                   bridge-core.js（共享核心）                    │
│           状态机 + 防抖 + 文件锁 + WS 发送                       │
│                           │                                   │
│                ws://127.0.0.1:17654                           │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                widget/（Electron 桌面挂件）                     │
│                                                              │
│  server.js ──→ main.js ──→ preload.js ──→ renderer/          │
│  (WS 服务端)   (主进程)     (安全桥接)       (红绿灯 UI)        │
│                                                              │
│  右键托盘 → 切换 Agent: Cursor / Claude / ...               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 项目结构

```
agent-light-desktop/
│
├── package.json               # 根配置（npm workspaces）
│
├── widget/                    # ★ Electron 桌面挂件
│   ├── package.json           #   挂件配置 + electron-builder 打包配置
│   ├── main.js                # ★ Electron 主进程（窗口、托盘、自动安装、Agent 切换）
│   ├── preload.js             #   安全桥接（主进程 ↔ 渲染进程）
│   ├── server.js              #   WebSocket 服务端（接收桥接脚本消息）
│   ├── renderer/
│   │   ├── index.html         #   挂件 UI 结构（含 Agent 标签）
│   │   ├── renderer.js        #   挂件 UI 逻辑（状态切换、心跳检测、超时）
│   │   └── style.css          #   红绿灯 CSS 动画 + Agent 配色
│   └── dist/                  #   [构建产物] 安装包输出目录
│
├── hooks-bridge/              # ★ Agent 桥接脚本
│   ├── bridge-core.js         #   ★ 共享核心：状态机 + 防抖 + WS 发送 + 日志
│   ├── cursor-bridge.js       #   Cursor Agent 桥接
│   ├── claude-bridge.js       #   Claude Code Agent 桥接
│   ├── locate-bridge.js       #   跨平台查找 hooks-bridge 安装路径
│   ├── hooks.json             #   Cursor hooks 配置模板
│   ├── claude-hooks.json      #   Claude Code hooks 配置模板
│   ├── hook-*.js              #   LEGACY: 旧版包装脚本（当前未使用）
│   └── state/                 #   [运行时] 各 Agent 独立状态
│       ├── cursor-state.json
│       └── claude-state.json
│
├── scripts/                   # 测试工具
│   └── test-client.js         #   手动模拟 WS 客户端，测试挂件
│
├── docs/                      # 文档
│   ├── BUILD.md               #   打包分发说明书
│   └── LEARN.md               #   本文件
│
├── install.ps1                # Windows 一键安装
└── install.sh                 # Mac / Linux 一键安装
```

---

## 5. 逐文件讲解

---

### 挂件端（widget）

#### `widget/main.js` — Electron 主进程（应用的大脑）

这是整个挂件的**入口文件**。主要职责：

**① 窗口创建**

```javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 110,           // 宽 110 像素
    height: 280,          // 高 280 像素
    frame: false,         // 无边框（看起来像悬浮挂件）
    transparent: true,    // 背景透明
    alwaysOnTop: true,    // 始终置顶
    skipTaskbar: true,    // 不在任务栏显示
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 上下文隔离（安全）
      nodeIntegration: false,   // 渲染进程禁用 Node.js（安全）
    },
  });
}
```

**关键概念：**
- **主进程**（Main Process）：`main.js` 运行在此，控制窗口、托盘、文件读写、WebSocket
- **渲染进程**（Renderer Process）：`renderer.js` 运行在此，操控 HTML/CSS
- 两者通过 `preload.js` 安全通信（不能直接在渲染进程用 `require('fs')`）

**② 系统托盘 + Agent 切换**

```javascript
const AGENTS = {
  cursor: { label: 'Cursor', desc: 'Cursor AI Agent' }  // 未来可扩展更多 Agent
  claude:  { label: 'Claude', desc: 'Claude Code Agent' },
};
```

右键托盘菜单可一键切换 Agent。切换后：
- 挂件顶部 Agent 标签变色（各 Agent 不同配色）
- 日志和状态文件切换到对应 Agent

**③ 首次启动自动安装**

挂件首次启动时自动执行：
1. 从 `resources/hooks-bridge/`（打包模式）或项目目录（开发模式）复制桥接脚本到系统配置目录
2. 自动配置 Cursor hooks（写入 `~/.cursor/hooks.json`，已有则备份后合并）
3. 自动配置 Claude Code hooks（写入 `~/.claude/settings.json`，保留用户已有的 env/permissions/theme 等设置）
4. 写入安装标记 `.installed`，后续启动跳过

**④ 窗口位置记忆**

每次关闭挂件时，把窗口位置存到 `userData/window-state.json`。下次启动自动恢复位置。

---

#### `widget/preload.js` — 主进程 ↔ 渲染进程的桥梁

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  onStatus:           (cb) => ipcRenderer.on('status', (_e, value) => cb(value)),
  onConnectionChanged:(cb) => ipcRenderer.on('connection-changed', ...),
  onAgentChanged:     (cb) => ipcRenderer.on('agent-changed', ...),
  getInitial:         ()  => ipcRenderer.invoke('get-initial'),
});
```

**关键概念：**
- `contextBridge` 安全地向渲染进程暴露 API
- 渲染进程通过 `window.electronAPI.onStatus(...)` 监听主进程消息
- `contextIsolation: true` 且 `nodeIntegration: false` 确保安全

---

#### `widget/server.js` — WebSocket 服务端

```javascript
const wss = new WebSocketServer({ port: 17654, host: '127.0.0.1' });
```

核心逻辑：
1. 监听 `127.0.0.1:17654` 端口（仅本地连接，安全）
2. 当桥接脚本连接上来时，接收 JSON 消息：`{ type: 'status', value: 'thinking', agent: 'claude' }`
3. 校验 `value` 是否为 6 种有效状态之一
4. 把状态转发给 `main.js` → `broadcastStatus()` → 渲染进程

```javascript
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'status' && VALID_STATUSES.has(msg.value)) {
    onStatus(msg.value, msg.agent || null);
  }
});
```

**注意：** 使用 `127.0.0.1` 而不是 `localhost`，避免 Windows 上 IPv6 解析问题。

---

#### `widget/renderer/index.html` — UI 结构

```html
<div class="light-box" id="lightBox" data-status="idle" data-agent="cursor">
  <div class="agent-label">AGENT</div>  <!-- Agent 标签（顶部） -->
  <div class="light red"></div>
  <div class="light yellow"></div>
  <div class="light green"></div>
  <div class="conn-dot"></div>           <!-- 连接状态小点 -->
  <div class="label">IDLE</div>          <!-- 状态文字（底部） -->
</div>
```

Agent 标签颜色随 `data-agent` 属性变化，各 Agent 不同配色。

---

#### `widget/renderer/renderer.js` — UI 逻辑

```javascript
function applyStatus(value) {
  box.dataset.status = value;       // 设置 data-status 属性
  label.textContent = LABELS[value]; // 更新文字

  const ms = TIMEOUTS[value];
  if (ms > 0) {
    timeoutId = setTimeout(() => applyStatus('idle'), ms);
  }
}
```

**超时机制：** 每种状态都有超时时间，超过后自动切回 IDLE：

| 状态 | 超时 |
|------|------|
| thinking / busy | 5 分钟 |
| success / error | 30 秒 |
| alarm | 10 分钟 |
| idle | 永不过期 |

**心跳指示器：** 每 30 秒检查一次最后活动时间。如果超过 30 秒无消息，连接指示灯变灰（未连接）。

---

#### `widget/renderer/style.css` — 红绿灯视觉效果

通过 `data-status` 属性选择器控制动画：

| 状态 | 灯效 | 含义 |
|------|------|------|
| `idle` | 三灯暗光 | 空闲 |
| `thinking` | 绿→黄→红 连贯跑马灯 | AI 思考/分析中 |
| `busy` | 黄灯慢闪 | AI 执行工具（写文件、运行命令） |
| `success` | 绿灯常亮 | 任务成功完成 |
| `error` | 红灯快闪 | 任务出错 |
| `alarm` | 红黄交替警灯 | AI 等你操作（提问、Plan 确认） |

---

### 桥接端（hooks-bridge）

#### `hooks-bridge/bridge-core.js` — 共享核心（最重要的文件）

这是整个系统的大脑，被所有 Agent 桥接脚本共用。约 530 行，提供：

**① 初始化和状态隔离**

```javascript
function init(opts = {}) {
  AGENT = opts.agent || 'cursor';  // 每个 Agent 独立，默认 cursor
  baseDir = path.join(BRIDGE_DIR, 'state');
}
```

每个 Agent（cursor/claude）有独立的 `state/{agent}-state.json` 和 `{agent}-hooks.log`，互不干扰。

**② 状态机（gateCheck）**

系统的核心：决定是否发送状态、发送什么状态。

```javascript
function gateCheck(action, mode) {
  // 读取上次状态 + 时间戳
  // 根据 action 类型（turn-start/busy/stop/idle...）决定新状态
  // 防抖：相同状态短时间内重复发送被忽略
  // 相位阻塞：busy 期间 thinking 事件不覆盖
  // 返回 { send: true/false, mode: 'thinking'|'busy'|... }
}
```

**③ 工具分类系统**

```javascript
const AUTH_REQUIRED_TOOLS = new Set(['Shell', 'Bash', 'Write', ...]);
const ASK_TOOLS = new Set(['AskUserQuestion', ...]);
const EXEC_TOOLS = new Set(['Shell', 'Delete', ...]);
```

- 高风险工具（Bash/Write）→ 标记 `authPending`（可能需要用户授权）
- 提问工具（AskUserQuestion）→ 直接转为 `alarm`
- 执行工具（Shell/Task）→ 标记 `buildStarted`

**④ Plan 模式检测**

检测 AI 是否在等待用户确认计划：
- 文本关键词："执行计划"、"Build 即可"、"Review Plan"
- 文件路径：`*.plan.md` / `.cursor/plans/`
- 计划文件最近 8 分钟内修改

检测到后，挂件显示 **alarm**。

**⑤ 三层防御（等待用户检测）**

| 层级 | 机制 | 触发条件 |
|------|------|---------|
| 第 1 层 | 工具名匹配 | AskUserQuestion / 高风险工具 |
| 第 2 层 | 静默窗口 | stop 后 4 秒无新活动 |
| 第 3 层 | 心跳超时 | 45 秒无任何 Hook 事件 |

**⑥ WebSocket 发送（多路径 ws 解析）**

```javascript
function resolveWsModule() {
  // 依次尝试 4 个位置:
  // 1. 正常 require('ws')
  // 2. hooks-bridge/node_modules/ws
  // 3. 系统安装目录下
  // 4. 向上遍历查找 node_modules/ws
}
```

连接是瞬态的（连→发→断），因为 Hook 调用很快，保持长连接没必要。

---

#### `hooks-bridge/cursor-bridge.js` — Cursor Agent 桥接

由 Cursor 编辑器的 Hook 系统调用。处理 8 种事件类型：

| 事件 | 触发时机 | → 状态 |
|------|---------|--------|
| `turn-start` | 用户提交 Prompt | `thinking` |
| `busy` | 工具调用前 | `busy`（检测后可能转 `alarm`） |
| `await-user` | AskQuestion 调用 | `alarm` |
| `plan-created` | CreatePlan 完成 | `alarm` |
| `plan-detect` | Agent 回复文本 | Plan 检测 → `alarm` |
| `plan-file` | 编辑 .plan.md | Plan 检测 → `alarm` |
| `stop` | Agent 停止 | `success` / `error` / `alarm` |
| `idle` | 会话结束 | `idle` |

#### `hooks-bridge/claude-bridge.js` — Claude Code Agent 桥接

由 Claude Code 的 Hook 系统调用（通过 `.claude/settings.json` 配置）。结构与 cursor-bridge 相同，但针对 Claude Code 的 HOOK_INPUT 字段名做了兼容（`toolName` vs `tool_name`）。

**注意：** Claude Code 没有 `afterAgentResponse` 事件，plan 文本检测整合在 `Stop` 事件中。

---

### 测试工具（scripts）

#### `scripts/test-client.js` — 手动测试挂件

```bash
# 循环测试所有 6 种状态
node scripts/test-client.js

# 测试单个状态
node scripts/test-client.js thinking
```

---

## 6. 数据流详解

### 完整路径：Cursor Agent

```
1. 你在 Cursor 里发了一条消息："帮我写一个排序函数"
                       ↓
2. Cursor Hooks 触发 beforeSubmitPrompt 事件
   调用: node cursor-bridge.js turn-start
   传入: HOOK_INPUT={"tool_name":"UserPromptSubmit","text":"帮我写..."}
                       ↓
3. cursor-bridge.js 解析
   → 调用 bridge.readHookInput() 读取 HOOK_INPUT + stdin
   → normalizeInput() 统一字段名（兼容 Cursor 和 Claude 不同命名）
   → bridge.updateHeartbeat() 更新心跳时间戳
   → bridge.gateCheck('turn-start', 'thinking')
   → bridge.sendToWidget('thinking')
                       ↓
4. bridge-core.js sendToWidget()
   → resolveWsModule() 查找 ws 模块
   → new WebSocket('ws://127.0.0.1:17654')
   → send({ type: 'status', value: 'thinking', agent: 'cursor' })
   → close()
                       ↓
5. widget/server.js 收到 WS 消息
   → JSON.parse → 校验 VALID_STATUSES
   → onStatus('thinking', 'cursor') 回调 main.js
                       ↓
6. widget/main.js
   → broadcastStatus('thinking')
   → mainWindow.webContents.send('status', 'thinking')
                       ↓
7. widget/preload.js 转发 IPC
   → window.electronAPI.onStatus(callback)
                       ↓
8. widget/renderer/renderer.js
   → applyStatus('thinking')
   → box.dataset.status = 'thinking'
   → label.textContent = 'THINK'
   → 设置 5 分钟超时
                       ↓
9. widget/renderer/style.css
   → [data-status="thinking"] 选择器生效
   → think-green / think-yellow / think-red 动画播放
                       ↓
10. 你看到：跑马灯 🟢→🟡→🔴
    你知道：AI 在思考
```

### Cursor / Claude Code 的区别

| 步骤 | Cursor | Claude Code |
|------|--------|------------|
| Hook 触发 | `~/.cursor/hooks.json` | `.claude/settings.json` |
| Bridge 脚本 | `cursor-bridge.js` | `claude-bridge.js` |
| WS agent 字段 | `"cursor"` | `"claude"` |
| 状态文件 | `state/cursor-state.json` | `state/claude-state.json` |

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
| 连接方式 | 请求→响应→断开 | 握手→持久连接 |
| 推送能力 | 客户端轮询 | 服务端主动推送 |
| 本项目 | ❌ | 桥接脚本 → 挂件（瞬时推送） |

### 防抖（Debounce）

防止同一个事件在短时间内重复触发。例如 Cursor 连续调用 5 次 `preToolUse`，桥接脚本只在第一次发送 `busy`，后续 4 次被防抖拦截。

配置在 `bridge-core.js`：
```javascript
const DEBOUNCE_MS = {
  thinking: 5000,  // 5 秒内重复 thinking → 忽略
  busy:     8000,  // 8 秒内重复 busy → 忽略
  alarm:    500,   // 0.5 秒内重复 alarm → 忽略
  success:  3000,  // ...
  error:    3000,
};
```

### 状态机（State Machine）

"A 状态下收到 B 事件，应该转到 C 状态" 的规则集合。

```
当前状态: idle
收到事件: turn-start（用户发了新消息）
    ↓ gateCheck('turn-start', 'thinking')
新状态: thinking
    ↓ renderer CSS 动画
你看到: 跑马灯

当前状态: thinking
收到事件: busy（AI 开始调用工具）
    ↓ gateCheck('busy', 'busy')
新状态: busy
    ↓
你看到: 黄灯慢闪
```

---

## 8. 动手实验

### 实验 1：启动挂件（开发模式）

```bash
cd agent-light-desktop/widget
npm run start
```

你会看到一个悬浮的红绿灯挂件出现在屏幕右下角。首次启动会弹窗提示自动配置 hooks。

### 实验 2：手动测试所有状态

```bash
# 新开一个终端
cd agent-light-desktop
node scripts/test-client.js
```

观察挂件依次展示：IDLE → THINK → BUSY → DONE → ERROR → ALARM

### 实验 3：测试单个 Agent 的桥接

```bash
# 模拟 Claude Code 的 turn-start 事件
node hooks-bridge/claude-bridge.js turn-start

# 查看日志
cat hooks-bridge/state/claude-hooks.log
```

### 实验 4：修改 CSS 看效果

编辑 `widget/renderer/style.css`，找到 `busy-blink` 动画：

```css
@keyframes busy-blink {
  0%, 49.999% { opacity: 1; }
  50%, 100%   { opacity: 0.45; }
}
```

把 `0.8s` 改成 `0.2s`，重启挂件看看变化。

### 实验 5：读懂数据流

在 `widget/server.js` 的 `ws.on('message', ...)` 里加一行：

```javascript
console.log('[DEBUG] 收到消息:', raw.toString());
```

重启挂件，再跑 `test-client.js`，看终端输出的消息。

### 实验 6：理解状态机

看 `hooks-bridge/state/claude-state.json` 的内容：

```json
{
  "lastMode": "thinking",
  "lastTs": 1716900000000,
  "turnPhase": "busy",
  "awaitingBuild": false,
  "buildStarted": true,
  "lastHookTs": 1716900005000
}
```

手动调用两次 `claude-bridge.js turn-start`，观察第二次被防抖拦截（日志显示 "debounce"）。

---

## 延伸学习

- [Electron 官方文档](https://www.electronjs.org/docs)
- [WebSocket 协议简介](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket)
- [CSS @keyframes 动画](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@keyframes)
- [Cursor Hooks 文档](https://docs.cursor.com/agent/hooks)
- [Claude Code Hooks 文档](https://code.claude.com/docs/en/hooks)

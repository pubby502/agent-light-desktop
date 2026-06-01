# Agent Traffic Light 🚦

桌面红绿灯挂件，通过 Agent Hooks 实时感知 AI Agent 的工作状态，用红绿灯动画直观展示 AI 编程全流程。

**v2 更新**: 支持 **Cursor** / **Claude** 等多种 Agent，右键托盘菜单一键切换。

## 状态映射

| 状态 | 灯效 | 含义 |
| --- | --- | --- |
| `idle` | 三灯全灭 | 空闲 |
| `thinking` | 🟢🟡🔴 连贯跑马灯 | Agent 分析/规划中 |
| `busy` | 🟡 黄灯慢闪 | 执行工具/构建中 |
| `success` | 🟢 绿灯常亮 | 任务成功 |
| `error` | 🔴 红灯快闪 | 任务失败/报错 |
| `alarm` | 🔴🟡 红黄交替警灯 | 等待用户操作 / Plan 等待 Build |

### 等待用户操作检测（三层防御）

1. **工具名匹配** — AskQuestion / 高风险工具 → 自动 alarm
2. **静默窗口** — stop 后 4 秒无新活动 → alarm
3. **心跳超时** — 45 秒无任何 Hook 事件 → alarm

## 架构 (v2)

```
┌──────────────────────────────────────────────────────┐
│  托盘右键菜单 → 选择 Agent (Cursor/Claude/...)            │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Cursor Hooks ──→ cursor-bridge.js ──┐               │
│  Claude Hooks ──→ claude-bridge.js ──┤               │
│                                       ↓               │
│                         bridge-core.js (共享模块)      │
│                         状态机 + 防抖 + 三层防御        │
│                                       ↓               │
│                          WebSocket ws://localhost:17654│
│                                       ↓               │
│                          widget/ (Electron 挂件)       │
│                                       ↓               │
│                          🟢🟡🔴 红绿灯动画              │
└──────────────────────────────────────────────────────┘
```

## 快速开始

### 方式一：下载即用（推荐）

从 [Releases](../../releases) 下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| Windows | `AgentTrafficLight-1.0.0-Setup.exe` 或 `AgentTrafficLight-1.0.0-portable.exe` |
| macOS | `AgentTrafficLight-1.0.0.dmg` |
| Linux | `AgentTrafficLight-1.0.0.AppImage` |

首次启动时，挂件会**自动检测并配置** Cursor / Claude Code 的 hooks。
重启你的编辑器或 Claude Code 终端，灯就会根据 AI 状态自动变化。

### 方式二：源码安装

```bash
# 1. 克隆仓库
git clone https://github.com/pubby502/agent-light-desktop.git
cd agent-light-desktop

# 2. 一键安装（自动配置 hooks）
# Windows:
powershell -ExecutionPolicy Bypass -File install.ps1

# Mac / Linux:
chmod +x install.sh && ./install.sh

# 3. 启动挂件
npm run widget
```

### 测试灯效

```bash
# 循环展示所有 6 种灯效
npm run test:client

# 单独测试某个状态
node scripts/test-client.js thinking
node scripts/test-client.js alarm
```

### 切换 Agent

右键系统托盘图标 → 选择 Agent（Cursor / Claude），灯效的 Agent 标签和日志会同步切换。

## Agent 支持详情

### Cursor（默认）

| Cursor Hook | 事件 | → 状态 |
| --- | --- | --- |
| `beforeSubmitPrompt` (UserPromptSubmit) | 用户发送 Prompt | `thinking` |
| `preToolUse` (AskQuestion) | Agent 提问等待用户 | `alarm` |
| `preToolUse` (所有工具) | 工具调用开始 | `busy` |
| `postToolUse` (CreatePlan) | Plan 创建完成 | `alarm` |
| `afterAgentResponse` | Agent 回复文本 | Plan 检测 → `alarm` |
| `afterFileEdit` | 文件编辑 | .plan.md 检测 → `alarm` |
| `postToolUseFailure` | 工具调用失败 | `thinking` / `error` |
| `stop` (Stop) | Agent 停止 | `success` / `error` / `alarm` |
| `sessionEnd` | 会话结束 | `idle` |

### Claude

需要将 `claude-hooks.json` 的内容合并到 `~/.claude/settings.json`。

| Claude Hook | 事件 | → 状态 |
| --- | --- | --- |
| `UserPromptSubmit` | 用户发送 Prompt | `thinking` |
| `PreToolUse` (AskUserQuestion) | 提问等待用户 | `alarm` |
| `PreToolUse` (所有工具) | 工具调用开始 | `busy` |
| `PostToolUse` (CreatePlan) | Plan 创建完成 | `alarm` |
| `PostToolUseFailure` | 工具调用失败 | `thinking` / `error` |
| `Stop` | Agent 停止 | `success` / `error` / `alarm` |
| `SessionEnd` | 会话结束 | `idle` |

## 目录结构 (v2)

```
.
├── hooks-bridge/                    Agent Hooks 桥接
│   ├── bridge-core.js              共享核心 (状态机 + 防抖 + 三层防御)
│   ├── cursor-bridge.js            Cursor Agent 桥接
│   ├── claude-bridge.js            Claude Agent 桥接
│   ├── hooks.json                  Cursor Hooks 配置
│   ├── claude-hooks.json           Claude Hooks 配置模板
│   ├── hook-*.js                   各事件入口脚本
│   └── state/                     各 Agent 独立状态目录
│       ├── cursor-state.json
│       └── claude-state.json
├── widget/                          Electron 桌面挂件
│   ├── main.js                     主进程 (含 Agent 选择器托盘菜单)
│   ├── preload.js                  预加载 (IPC 通道)
│   ├── server.js                   WebSocket 服务器
│   └── renderer/
│       ├── index.html              (含 Agent 标签)
│       ├── renderer.js             (Agent 切换逻辑)
│       └── style.css               灯效 CSS + Agent 配色
├── scripts/
│   └── test-client.js              WS 测试客户端
├── install.ps1                     Windows 一键安装 (v2 支持 Agent 选择)
└── README.md
```

## 故障排查

| 现象 | 检查 |
|------|------|
| 灯不亮 | 挂件是否启动？端口 17654 是否被占？ |
| Hook 不触发 | 重启 Cursor / Claude Code。检查 hooks 配置是否存在 |
| 灯效乱跳 | 查看日志：`hooks-bridge/state/<agent>-hooks.log` |
| 连接指示灯灰色 | 挂件是否正常运行？防火墙是否拦截 127.0.0.1:17654？ |
| 一直显示 alarm | Agent 可能在 Plan 模式等待 Build，或触发三层防御等待检测 |
| Agent 切换不生效 | 右键托盘 → 选择 Agent 切换 |
| Claude 不工作 | 确认 `~/.claude/settings.json` 中已配置 hooks（首次启动自动配置） |
| 日志位置 | Windows: `%APPDATA%/agent-traffic-light/hooks-bridge/state/` |
| | Mac: `~/Library/Application Support/agent-traffic-light/hooks-bridge/state/` |
| | Linux: `~/.config/agent-traffic-light/hooks-bridge/state/` |

## License

MIT

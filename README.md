# Cursor Light Desktop 🚦

桌面红绿灯挂件，通过 **Cursor Hooks** 实时感知 Cursor Agent 的工作状态，用红绿灯动画直观展示 AI 编程全流程。

## 安装包
前往[releases](https://github.com/pubby502/cursor-light-desktop/releases)下载使用

## 状态映射

| 状态 | 灯效 | 含义 | Cursor Agent 事件 |
| --- | --- | --- | --- |
| `idle` | 三灯全灭 | 空闲 | sessionEnd |
| `thinking` | 🟢🟡🔴 连贯跑马灯 | Agent 分析/规划中 | beforeSubmitPrompt |
| `busy` | 🟡 黄灯慢闪 | 执行工具/构建中 | preToolUse |
| `success` | 🟢 绿灯常亮 | 任务成功 | stop (completed) |
| `error` | 🔴 红灯快闪 | 任务失败/报错 | stop (error/aborted) |
| `alarm` | 🔴🟡 红黄交替警灯 | Plan 等待 Build / 等待用户操作 | AskQuestion / plan mode |

❌ 由于hook未包含等待用户操作状态，红黄交替暂无提示用户操作的功能

## 架构

```
Cursor Agent 事件
    ↓ (Cursor Hooks 原生机制)
hooks-bridge/agent-light.js (状态机 + 防抖去重)
    ↓ (WebSocket ws://localhost:17654)
widget/ (Electron 桌面挂件)
    ↓
🟢🟡🔴 红绿灯动画
```

## 快速开始

### Windows

```powershell
# 一键安装
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 手动安装

```bash
# 1. 安装依赖
npm run install:all
cd hooks-bridge && npm install && cd ..

# 2. 启动桌面挂件
npm run widget

# 3. 安装 Cursor Hooks
# 将 hooks-bridge/ 复制到 %USERPROFILE%\.cursor\hooks\traffic-light\
# 将 hooks-bridge/hooks.json 合并到 %USERPROFILE%\.cursor\hooks.json
```

### 测试

```bash
# 循环展示所有 6 种灯效
npm run test:client

# 单独测试某个状态
node scripts/test-client.js thinking
node scripts/test-client.js busy
node scripts/test-client.js alarm
```

## 工作原理

### Cursor Hooks 事件覆盖

| Cursor Hook | 事件 | → 状态 |
| --- | --- | --- |
| `beforeSubmitPrompt` (UserPromptSubmit) | 用户发送 Prompt | `thinking` |
| `preToolUse` (AskQuestion) | Agent 提问等待用户 | `alarm` |
| `preToolUse` (所有工具) | 工具调用开始 | `busy` |
| `postToolUse` (CreatePlan) | Plan 创建完成 | `alarm` (等 Build) |
| `afterAgentResponse` (AgentResponse) | Agent 回复文本 | 检测 Plan 模式关键词 |
| `afterFileEdit` | 文件编辑 | 检测 .plan.md 文件 |
| `postToolUseFailure` | 工具调用失败 | `thinking` / `error` |
| `stop` (Stop) | Agent 停止 | `success` / `error` / `alarm` |
| `sessionEnd` | 会话结束 | `idle` |

### Plan 模式智能检测

当 Cursor Agent 进入 Plan 模式时，`agent-light.js` 会通过以下方式检测：
1. **文本关键词匹配**：检测 Agent 回复中是否包含 "执行计划"、"Build 即可"、"Review Plan" 等
2. **文件路径检测**：检测是否写入了 `.plan.md` 文件
3. **CreatePlan 工具检测**：检测 `CreatePlan` 工具调用

检测到 Plan 模式后，灯转为 `alarm`（红黄交替警灯），提示用户需要点击 Build。

### 防抖去重

`agent-light.js` 内置了与 CursorLight 的 `ble_gate.py` 相同的防抖逻辑：
- 同一模式在短时间内重复触发会被过滤
- `busy` 阶段会阻止 `thinking` 覆盖
- 通过 `state.json` + 文件锁实现原子操作

## 目录结构

```
.
├── hooks-bridge/              Cursor Hooks 桥接 (Node.js)
│   ├── agent-light.js         核心逻辑 (状态机 + 防抖 + Plan 检测)
│   ├── hooks.json             Cursor Hooks 事件绑定配置
│   ├── hook-*.js              各事件入口脚本
│   └── package.json
├── widget/                    Electron 桌面挂件
│   ├── main.js                主进程
│   ├── preload.js             预加载
│   ├── server.js              WebSocket 服务器
│   └── renderer/
│       ├── index.html
│       ├── renderer.js
│       └── style.css          灯效 CSS 动画
├── scripts/
│   └── test-client.js         WS 测试客户端
├── install.ps1                Windows 一键安装脚本
└── README.md
```

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 灯不亮 | 挂件是否启动 (`npm run widget`), 端口 17654 是否被占 |
| Hook 不触发 | 重启 Cursor, 检查 `~/.cursor/hooks.json` 是否存在 |
| 灯效乱跳 | 查看 `%USERPROFILE%\.cursor\hooks\traffic-light\hooks.log` |
| 连接指示灯灰色 | WS 端口是否一致, 防火墙是否拦截 |
| 一直显示 alarm | Agent 可能在 Plan 模式等待 Build |

## License

MIT

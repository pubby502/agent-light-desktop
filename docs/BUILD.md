# Agent Traffic Light — 打包与分发

## 项目结构

```
agent-light-desktop/
├── widget/              ← Electron 桌面挂件（红绿灯）
│   ├── main.js          ← Electron 主进程
│   ├── server.js        ← WebSocket 服务端（端口 17654）
│   ├── preload.js       ← 主进程 ↔ 渲染进程安全桥接
│   ├── renderer/        ← 挂件 UI（HTML/CSS/JS）
│   ├── package.json     ← 打包配置（electron-builder）
│   └── dist/            ← [构建产物] 安装包输出目录
├── hooks-bridge/        ← Agent Hooks 桥接脚本
│   ├── bridge-core.js   ← 共享状态机 + WS 发送
│   ├── cursor-bridge.js ← Cursor Agent 桥接
│   ├── claude-bridge.js ← Claude Code Agent
│   └── state/           ← [运行时] 各 Agent 独立状态目录
├── scripts/             ← 测试工具
├── docs/                ← 文档
│   ├── BUILD.md         ← 本文件
│   └── LEARN.md         ← 学习文档
├── install.ps1          ← Windows 安装脚本
└── install.sh           ← Mac / Linux 安装脚本
```

## 快速构建

### 前置条件

- Node.js 18+（[下载](https://nodejs.org/)）
- Windows: PowerShell 5+（Windows 10+ 自带）
- Mac: Xcode Command Line Tools（`xcode-select --install`）
- Linux: `dpkg-dev` + `fakeroot`（`sudo apt install dpkg-dev fakeroot`）

### 一键构建

```bash
# 1. 安装依赖
npm run install:all

# 2. 确保 hooks-bridge 的 ws 依赖已安装（打包时会随 extraResources 打入）
cd hooks-bridge && npm install && cd ..

# 3. 构建当前平台安装包
cd widget
npm run prebuild    # 确保 hooks-bridge/node_modules/ws 存在
npm run build       # electron-builder（按当前操作系统构建）
```

生成文件在 `widget/dist/`：

| 文件 | 平台 | 说明 |
|------|------|------|
| `AgentTrafficLight-1.0.0-Setup.exe` | Windows | NSIS 安装包（可选路径、桌面快捷方式） |
| `AgentTrafficLight-1.0.0-portable.exe` | Windows | 便携版（单文件，免安装，双击即用） |
| `AgentTrafficLight-1.0.0.dmg` | macOS | DMG 安装镜像 |
| `AgentTrafficLight-1.0.0.AppImage` | Linux | AppImage 便携包 |
| `AgentTrafficLight-1.0.0.deb` | Linux | Debian/Ubuntu 安装包 |

> **说明：** `npm run build` 只会产出当前平台对应的安装包；跨平台产物通常通过 CI matrix（Windows/macOS/Linux 各自构建）汇总。

### 单平台构建

```bash
npm run build:win      # 仅 Windows
npm run build:mac      # 仅 macOS（需在 Mac 上运行）
npm run build:linux    # 仅 Linux
npm run build:portable # 仅 Windows 便携版
npm run build:all      # 显式请求全平台（建议仅在 CI matrix 中使用）
```

> **注意：** macOS 构建必须在 macOS 上运行；Linux 构建可在任何平台运行，但生成的 `.deb` 的依赖关系可能需要在目标系统上验证。

## 打包内容

`extraResources` 配置会将 `hooks-bridge/` 整个目录打入安装包的 `resources/` 目录：

```
安装目录/
├── AgentTrafficLight.exe    ← Electron 可执行文件
├── resources/
│   └── hooks-bridge/          ← ★ 桥接脚本（含 ws 依赖）
│       ├── bridge-core.js
│       ├── cursor-bridge.js
│       ├── claude-bridge.js
│       ├── locate-bridge.js
│       └── node_modules/ws/   ← 已安装的 ws 依赖
└── ...
```

**首次启动时**，挂件会自动将 `resources/hooks-bridge/` 复制到系统配置目录，并配置各 Agent 的 hooks。`ws` 依赖随包自带，用户无需安装 Node.js 或运行 `npm install`。

## 更新版本号

1. 编辑 `widget/package.json`，修改 `"version"` 字段：
   ```json
   "version": "0.2.0"
   ```

2. 更新 `package.json`（根目录）的版本号保持一致。

3. 重新构建：
   ```bash
   cd widget && npm run build
   ```

4. 新版本文件自动生成在 `widget/dist/`。

## 自定义图标

### Windows（`.ico`）

1. 准备 `256×256` 的 `.ico` 文件，放到 `widget/` 目录
2. `widget/package.json` 中 `build.win.icon` 已指向 `icon.ico`
3. 替换文件即可

### macOS（`.icns`）

1. 准备 `512×512` 的 PNG，用 `iconutil` 或在线工具转成 `.icns`
2. 放到 `widget/` 目录，命名为 `icon.icns`

### Linux（`.png`）

1. 准备 `512×512` 的 PNG
2. 放到 `widget/` 目录，命名为 `icon.png`

## 首次启动自动配置

挂件首次启动时自动执行以下操作（用户无需任何手动步骤）：

1. 检测 `resources/hooks-bridge/` 源码位置（开发模式用项目目录，打包模式用安装目录）
2. 复制 `hooks-bridge/` 到系统配置目录：
   - Windows: `%APPDATA%/agent-traffic-light/hooks-bridge/`
   - macOS: `~/Library/Application Support/agent-traffic-light/hooks-bridge/`
   - Linux: `~/.config/agent-traffic-light/hooks-bridge/`
3. 自动配置 Cursor hooks（创建或合并 `~/.cursor/hooks.json`）
4. 自动配置 Claude Code hooks（创建或合并 `~/.claude/settings.json`，保留用户已有的 env/permissions/theme 等设置）
5. 写入安装标记，后续启动跳过

## CI/CD 示例（GitHub Actions）

```yaml
name: Build & Release

on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: npm run install:all
      - run: cd hooks-bridge && npm install && cd ..
      - run: cd widget && npm run prebuild && npx electron-builder --publish=never
      - uses: actions/upload-artifact@v4
        with:
          name: dist-${{ matrix.os }}
          path: widget/dist/*
```

## 注意事项

- 首次构建需要下载 Electron 二进制（~100MB），确保网络畅通
- Windows: 如遇到 `7za` 符号链接错误，开启 Windows 开发者模式或使用管理员终端
- macOS: 构建前需对 Electron 二进制签名，否则 macOS Gatekeeper 会阻止运行。正式分发建议注册 Apple Developer Program
- Linux: AppImage 在所有主流发行版通用；deb 包在 Debian/Ubuntu 上原生安装
- `hooks-bridge/state/` 和 `*.log` 文件不会被打入安装包（`extraResources.filter` 已排除）

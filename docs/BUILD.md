# Cursor Traffic Light — 打包与分发

## 项目结构

```
traffic-light/
├── widget/          ← Electron 桌面挂件（红绿灯）
│   ├── dist/        ← 打包输出目录
│   └── package.json ← 打包配置（electron-builder）
├── hooks-bridge/    ← Cursor Hooks 桥接脚本
└── scripts/         ← 测试工具
```

## 构建打包

```powershell
cd F:\traffic-light\widget
npx electron-builder --win --x64
```

生成文件在 `widget\dist\`：

| 文件 | 说明 |
|---|---|
| `Cursor Traffic Light Setup 0.1.0.exe` | NSIS 安装包（可选路径、自动建桌面快捷方式） |
| `CursorTrafficLight-0.1.0-portable.exe` | 便携版（单文件，无需安装，双击即用） |

## 更新版本号

1. 编辑 `widget\package.json`，修改 `"version"` 字段，例如：
   ```json
   "version": "0.2.0"
   ```

2. 重新构建：
   ```powershell
   cd F:\traffic-light\widget
   npx electron-builder --win --x64
   ```

3. 新版本文件会自动生成在 `widget\dist\`，可发给用户替换旧版本。

## 自定义图标

1. 准备一个 `256×256` 的 `.ico` 文件，放到 `widget\` 目录
2. 在 `widget\package.json` 的 `build.win` 中添加 `"icon"` 字段：
   ```json
   "win": {
     "icon": "icon.ico",
     "target": [
       { "target": "nsis", "arch": ["x64"] },
       { "target": "portable", "arch": ["x64"] }
     ]
   }
   ```
3. 重新构建即可

## 分发

- **便携版**：直接把 `.exe` 发给对方，双击运行
- **安装版**：运行 Setup.exe，按向导安装

对方无需安装 Node.js 或任何依赖。

## 注意事项

- 首次构建需要下载 Electron 二进制和工具链，确保网络畅通（已配置 npmmirror 镜像）
- 如果遇到 `7za` 符号链接错误，需开启 Windows 开发者模式或使用管理员终端

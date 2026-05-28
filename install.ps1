# Cursor Traffic Light — Windows 安装脚本
# 用法: 右键 → "使用 PowerShell 运行", 或在终端:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Cursor Traffic Light 安装脚本 ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. 检查 Node.js ───────────────────────────────────
Write-Host "[1/5] 检查 Node.js ..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>$null
    Write-Host "  已安装 Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  错误: 未找到 Node.js。请先安装 https://nodejs.org/" -ForegroundColor Red
    pause
    exit 1
}

# ── 2. 安装项目依赖 ──────────────────────────────────
Write-Host "[2/5] 安装项目依赖 ..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot"
npm install 2>&1 | Out-Null
Write-Host "  根目录依赖安装完成" -ForegroundColor Green

Set-Location "$PSScriptRoot\widget"
npm install 2>&1 | Out-Null
Write-Host "  挂件依赖安装完成" -ForegroundColor Green

Set-Location "$PSScriptRoot"

# 确保 hooks-bridge 的 ws 依赖
Set-Location "$PSScriptRoot\hooks-bridge"
npm init -y 2>&1 | Out-Null
npm install ws 2>&1 | Out-Null
Write-Host "  桥接依赖安装完成" -ForegroundColor Green

Set-Location "$PSScriptRoot"

# ── 3. 安装 Cursor Hooks ─────────────────────────────
Write-Host "[3/5] 安装 Cursor Hooks ..." -ForegroundColor Yellow

$cursorDir = "$env:USERPROFILE\.cursor"
$hooksDir = "$cursorDir\hooks\traffic-light"

# 创建目录
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

# 复制 hooks-bridge 文件
Copy-Item "$PSScriptRoot\hooks-bridge\*" -Destination $hooksDir -Recurse -Force

Write-Host "  已复制到 $hooksDir" -ForegroundColor Green

# 安装 hooks.json (已存在则备份)
$hooksJsonPath = "$cursorDir\hooks.json"
if (Test-Path $hooksJsonPath) {
    $backup = "$hooksJsonPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $hooksJsonPath $backup
    Write-Host "  已备份原有 hooks.json → $backup" -ForegroundColor Yellow
    Write-Host "  注意: 需要手动合并 hooks.json! 参考 $hooksDir\hooks.json" -ForegroundColor Yellow
} else {
    # 替换路径中的 %USERPROFILE% 占位符
    $hooksContent = Get-Content "$hooksDir\hooks.json" -Raw
    $hooksContent = $hooksContent -replace '%USERPROFILE%', $env:USERPROFILE
    $hooksContent | Set-Content -Path $hooksJsonPath -Encoding UTF8
    Write-Host "  已创建 $hooksJsonPath" -ForegroundColor Green
}

# ── 4. 创建测试脚本 ──────────────────────────────────
Write-Host "[4/5] 更新测试客户端 ..." -ForegroundColor Yellow

$testScript = @'
#!/usr/bin/env node
/**
 * 手动 WS 测试客户端
 *
 * 用法:
 *   node scripts/test-client.js                    # 循环所有 6 个状态
 *   node scripts/test-client.js thinking            # 发送单个状态
 */
const WebSocket = require("ws");

const URL = process.env.WIDGET_URL || "ws://localhost:17654";
const VALID = ["idle", "thinking", "busy", "success", "error", "alarm"];

const arg = process.argv[2];
const ws = new WebSocket(URL);

ws.on("open", async () => {
  console.log(`Connected to ${URL}`);
  if (arg) {
    if (!VALID.includes(arg)) {
      console.error(`Invalid status "${arg}". Expected: ${VALID.join(", ")}`);
      process.exit(1);
    }
    send(arg);
    setTimeout(() => ws.close(), 200);
  } else {
    for (const v of VALID) {
      send(v);
      await sleep(2500);
    }
    ws.close();
  }
});

ws.on("error", (e) => {
  console.error("WS error:", e.message);
  process.exit(1);
});

function send(value) {
  const msg = JSON.stringify({ type: "status", value });
  ws.send(msg);
  console.log("→", msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
'@
$testScript | Set-Content -Path "$PSScriptRoot\scripts\test-client.js" -Encoding UTF8

Write-Host "  测试客户端已更新" -ForegroundColor Green

# ── 5. 完成 ───────────────────────────────────────────
Write-Host "[5/5] 安装完成!" -ForegroundColor Green
Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  后续步骤:" -ForegroundColor White
Write-Host "  1. 启动桌面挂件:  npm run widget" -ForegroundColor Yellow
Write-Host "  2. 测试灯效:      npm run test:client" -ForegroundColor Yellow
Write-Host "  3. 重启 Cursor 使 Hooks 生效" -ForegroundColor Yellow
Write-Host "  4. 查看日志:      type %USERPROFILE%\.cursor\hooks\traffic-light\hooks.log" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "如果已有 ~/.cursor/hooks.json, 请手动将 hooks-bridge/hooks.json 的条目合并进去。" -ForegroundColor Magenta
Write-Host ""

pause

# Agent Traffic Light — Windows 安装脚本 (v2 多 Agent 支持)
# 用法: 右键 → "使用 PowerShell 运行", 或在终端:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Agent Traffic Light v2 安装脚本    ║" -ForegroundColor Cyan
Write-Host "║  支持 Cursor / Claude 等多种 Agent  ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Agent 选择 ─────────────────────────────────────────
Write-Host "请选择要监控的 Agent:" -ForegroundColor Yellow
Write-Host "  [1] Cursor  (默认)" -ForegroundColor White
Write-Host "  [2] Claude" -ForegroundColor White
Write-Host "  [3] 全部安装" -ForegroundColor White
$choice = Read-Host "请输入数字 (1-3, 默认 1)"
if (-not $choice) { $choice = "1" }

$agent = switch ($choice) {
    "2" { "claude" }
    "3" { "all" }
    default { "cursor" }
}
Write-Host "  已选择: $agent" -ForegroundColor Green
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
if (-not (Test-Path "package.json")) {
    npm init -y 2>&1 | Out-Null
}
npm install ws 2>&1 | Out-Null
Write-Host "  桥接依赖安装完成" -ForegroundColor Green

Set-Location "$PSScriptRoot"

# ── 3. 安装核心文件到系统目录 ──────────────────────────
Write-Host "[3/5] 安装核心文件 ..." -ForegroundColor Yellow

$configDir = "$env:APPDATA\agent-traffic-light"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# 复制 hooks-bridge 到固定系统位置（供所有脚本查找）
$sysBridgeDir = "$configDir\hooks-bridge"
New-Item -ItemType Directory -Force -Path $sysBridgeDir | Out-Null
Get-ChildItem "$PSScriptRoot\hooks-bridge" -Exclude node_modules | Copy-Item -Destination $sysBridgeDir -Recurse -Force
# 安装 ws 依赖到系统位置
Set-Location $sysBridgeDir
if (-not (Test-Path "node_modules\ws")) {
    if (-not (Test-Path "package.json")) { npm init -y 2>&1 | Out-Null }
    npm install ws 2>&1 | Out-Null
}
Set-Location "$PSScriptRoot"
Write-Host "  已安装 hooks-bridge 到 $sysBridgeDir" -ForegroundColor Green

# Agent 选择配置
if ($agent -eq "all") {
    $agentConfig = '{"agent": "cursor"}'
} else {
    $agentConfig = "{`"agent`": `"$agent`"}"
}
$agentConfig | Set-Content -Path "$configDir\agent-config.json" -Encoding UTF8
Write-Host "  已保存 Agent 选择: $agent" -ForegroundColor Green

# ── 4. 安装 Cursor Hooks ──────────────────────────────
Write-Host "[4/5] 安装 Cursor Hooks ..." -ForegroundColor Yellow

$cursorDir = "$env:USERPROFILE\.cursor"
$hooksDir = "$cursorDir\hooks\traffic-light"

New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

# 复制 hooks-bridge 文件 (排除 node_modules 避免重复)
Get-ChildItem "$PSScriptRoot\hooks-bridge" -Exclude node_modules | Copy-Item -Destination $hooksDir -Recurse -Force

Write-Host "  已复制到 $hooksDir" -ForegroundColor Green

# 安装 hooks.json
$hooksJsonPath = "$cursorDir\hooks.json"
if (Test-Path $hooksJsonPath) {
    $backup = "$hooksJsonPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $hooksJsonPath $backup
    Write-Host "  已备份原有 hooks.json → $backup" -ForegroundColor Yellow
    Write-Host "  注意: 需要手动合并 hooks.json! 参考 $hooksDir\hooks.json" -ForegroundColor Yellow
} else {
    $hooksContent = Get-Content "$hooksDir\hooks.json" -Raw
    $hooksContent = $hooksContent -replace '%USERPROFILE%', $env:USERPROFILE
    $hooksContent | Set-Content -Path $hooksJsonPath -Encoding UTF8
    Write-Host "  已创建 $hooksJsonPath" -ForegroundColor Green
}

# ── 5. Claude 额外配置 ─────────────────────────────────
Write-Host "[5/5] Agent 特定配置 ..." -ForegroundColor Yellow

if ($agent -eq "claude" -or $agent -eq "all") {
    # ── 5a. 配置 Claude Code 全局 hooks ──
    $claudeSettingsDir = "$env:USERPROFILE\.claude"
    $claudeSettingsPath = "$claudeSettingsDir\settings.json"
    $claudeHooksTemplate = "$sysBridgeDir\claude-hooks.json"

    if (Test-Path $claudeHooksTemplate) {
        $templateContent = Get-Content $claudeHooksTemplate -Raw -Encoding UTF8
        # 替换 __BRIDGE_DIR__ 为实际系统安装路径（双反斜杠用于 JSON 转义）
        $escapedBridgeDir = $sysBridgeDir -replace '\\', '\\\\'
        $templateContent = $templateContent -replace '__BRIDGE_DIR__', $escapedBridgeDir
        $newHooks = (ConvertFrom-Json $templateContent).hooks

        $mergedSettings = @{}
        $existingHooks = $null

        if (Test-Path $claudeSettingsPath) {
            # 备份现有设置
            $backupPath = "$claudeSettingsPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item $claudeSettingsPath $backupPath
            Write-Host "  [Claude] 已备份 settings.json → $backupPath" -ForegroundColor Yellow

            try {
                $existing = Get-Content $claudeSettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
                foreach ($prop in $existing.PSObject.Properties) {
                    $mergedSettings[$prop.Name] = $prop.Value
                }
                $existingHooks = $existing.hooks
            } catch {
                Write-Host "  [Claude] 警告: 无法解析现有 settings.json，将创建新文件" -ForegroundColor Yellow
            }
        } else {
            New-Item -ItemType Directory -Force -Path $claudeSettingsDir | Out-Null
        }

        # 深度合并 hooks：保留用户现有 hooks，仅添加/覆盖 traffic-light 的 hook 事件
        if ($existingHooks) {
            $mergedHooks = @{}
            # 先复制现有 hooks
            foreach ($hookProp in $existingHooks.PSObject.Properties) {
                $mergedHooks[$hookProp.Name] = $hookProp.Value
            }
            # 再合并 traffic-light hooks（覆盖同名事件）
            foreach ($hookProp in $newHooks.PSObject.Properties) {
                $mergedHooks[$hookProp.Name] = $hookProp.Value
            }
            $mergedSettings['hooks'] = $mergedHooks
        } else {
            $mergedSettings['hooks'] = $newHooks
        }

        # 写出
        $mergedJson = $mergedSettings | ConvertTo-Json -Depth 10
        $mergedJson | Set-Content -Path $claudeSettingsPath -Encoding UTF8
        Write-Host "  [Claude] hooks 已合并到 $claudeSettingsPath" -ForegroundColor Green
    } else {
        Write-Host "  [Claude] 未找到 claude-hooks.json 模板，跳过" -ForegroundColor Yellow
    }

    # ── 5b. 创建项目级 .claude/settings.json ──
    $projClaudeDir = "$PSScriptRoot\.claude"
    $projClaudePath = "$projClaudeDir\settings.json"
    New-Item -ItemType Directory -Force -Path $projClaudeDir | Out-Null

    # 项目级使用 $CLAUDE_PROJECT_DIR 相对路径
    $projHooksContent = @"
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" turn-start", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" await-user", "timeout": 10 }] },
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" busy", "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "CreatePlan", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" plan-created", "timeout": 10 }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" denied", "timeout": 10 }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" stop", "timeout": 10 }] }
    ],
    "SessionEnd": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"`$CLAUDE_PROJECT_DIR/hooks-bridge/claude-bridge.js\" idle", "timeout": 10 }] }
    ]
  }
}
"@
    $projHooksContent | Set-Content -Path $projClaudePath -Encoding UTF8
    Write-Host "  [Claude] 项目级 hooks 已创建: $projClaudePath" -ForegroundColor Green
}

# ── 完成 ───────────────────────────────────────────────
Write-Host "安装完成!" -ForegroundColor Green
Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  后续步骤:" -ForegroundColor White
Write-Host "  1. 启动桌面挂件:  npm run widget" -ForegroundColor Yellow
Write-Host "  2. 测试灯效:      npm run test:client" -ForegroundColor Yellow
Write-Host "  3. 重启 Cursor 使 Hooks 生效" -ForegroundColor Yellow
Write-Host "  4. 右键托盘图标可切换 Agent" -ForegroundColor Yellow
Write-Host "  5. 查看日志:      type $hooksDir\state\cursor-hooks.log" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "如果已有 ~/.cursor/hooks.json, 请手动将 hooks-bridge/hooks.json 的条目合并进去。" -ForegroundColor Magenta
Write-Host ""

pause

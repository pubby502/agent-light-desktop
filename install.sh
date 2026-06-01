#!/usr/bin/env bash
# Agent Traffic Light — Mac/Linux 安装脚本
# 用法: chmod +x install.sh && ./install.sh
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}══════════════════════════════════════${NC}"
echo -e "${CYAN}  Agent Traffic Light v2 安装脚本    ${NC}"
echo -e "${CYAN}  支持 Cursor / Claude 等多种 Agent  ${NC}"
echo -e "${CYAN}══════════════════════════════════════${NC}"
echo ""

# ── Agent 选择 ─────────────────────────────────────────
echo -e "${YELLOW}请选择要监控的 Agent:${NC}"
echo "  [1] Cursor (默认)"
echo "  [2] Claude"
echo "  [3] 全部安装"
read -p "请输入数字 (1-3, 默认 1): " choice
choice=${choice:-1}

case "$choice" in
  2) agent="claude" ;;
  3) agent="all" ;;
  *) agent="cursor" ;;
esac
echo -e "  已选择: ${GREEN}${agent}${NC}"
echo ""

# ── 确定平台配置目录 ──────────────────────────────────
case "$(uname -s)" in
  Darwin)  CONFIG_DIR="$HOME/Library/Application Support/agent-traffic-light" ;;
  Linux)   CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-traffic-light" ;;
  *)       echo -e "${RED}不支持的操作系统${NC}"; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 1. 检查 Node.js ───────────────────────────────────
echo -e "${YELLOW}[1/5] 检查 Node.js ...${NC}"
if ! command -v node &>/dev/null; then
  echo -e "${RED}错误: 未找到 Node.js。请先安装 https://nodejs.org/${NC}"
  exit 1
fi
echo -e "  ${GREEN}已安装 Node.js $(node --version)${NC}"

# ── 2. 安装依赖 ──────────────────────────────────────
echo -e "${YELLOW}[2/5] 安装项目依赖 ...${NC}"
cd "$SCRIPT_DIR"
npm install --production 2>&1 | tail -1
echo -e "  ${GREEN}根目录依赖安装完成${NC}"

cd "$SCRIPT_DIR/widget"
npm install --production 2>&1 | tail -1
echo -e "  ${GREEN}挂件依赖安装完成${NC}"

cd "$SCRIPT_DIR/hooks-bridge"
if [ ! -f "package.json" ]; then
  npm init -y 2>&1 | tail -1
fi
npm install ws 2>&1 | tail -1
echo -e "  ${GREEN}桥接依赖安装完成${NC}"

cd "$SCRIPT_DIR"

# ── 3. 安装 hooks-bridge 到系统目录 ───────────────────
echo -e "${YELLOW}[3/5] 安装 hooks-bridge 到系统目录 ...${NC}"

SYS_BRIDGE_DIR="$CONFIG_DIR/hooks-bridge"
mkdir -p "$SYS_BRIDGE_DIR"

# 复制 hooks-bridge（排除 node_modules 和 state）
rsync -a --exclude='node_modules' --exclude='state' "$SCRIPT_DIR/hooks-bridge/" "$SYS_BRIDGE_DIR/" 2>/dev/null ||
  cp -r "$SCRIPT_DIR/hooks-bridge/"* "$SYS_BRIDGE_DIR/" 2>/dev/null

# 安装 ws 到系统位置
cd "$SYS_BRIDGE_DIR"
if [ ! -d "node_modules/ws" ]; then
  if [ ! -f "package.json" ]; then npm init -y 2>&1 | tail -1; fi
  npm install ws 2>&1 | tail -1
fi
cd "$SCRIPT_DIR"

echo -e "  ${GREEN}已安装到 ${SYS_BRIDGE_DIR}${NC}"

# Agent 配置
echo "{\"agent\": \"$agent\"}" > "$CONFIG_DIR/agent-config.json"

# ── 4. 配置 Agent Hooks ──────────────────────────────
echo -e "${YELLOW}[4/5] 配置 Agent Hooks ...${NC}"

# Cursor hooks
if [ "$agent" = "cursor" ] || [ "$agent" = "all" ]; then
  CURSOR_DIR="$HOME/.cursor"
  HOOKS_JSON="$CURSOR_DIR/hooks.json"
  BRIDGE_SCRIPT="$SYS_BRIDGE_DIR/cursor-bridge.js"

  mkdir -p "$CURSOR_DIR"

  CURSOR_HOOKS=$(cat <<HOOKS
{
  "version": 2,
  "hooks": {
    "beforeSubmitPrompt": [
      {"command": "node \"${BRIDGE_SCRIPT}\" turn-start", "matcher": "UserPromptSubmit"}
    ],
    "preToolUse": [
      {"command": "node \"${BRIDGE_SCRIPT}\" await-user", "matcher": "AskQuestion"},
      {"command": "node \"${BRIDGE_SCRIPT}\" busy"}
    ],
    "postToolUse": [
      {"command": "node \"${BRIDGE_SCRIPT}\" plan-created", "matcher": "CreatePlan"}
    ],
    "postToolUseFailure": [
      {"command": "node \"${BRIDGE_SCRIPT}\" denied"}
    ],
    "afterAgentResponse": [
      {"command": "node \"${BRIDGE_SCRIPT}\" plan-detect", "matcher": "AgentResponse"}
    ],
    "afterFileEdit": [
      {"command": "node \"${BRIDGE_SCRIPT}\" plan-file"}
    ],
    "stop": [
      {"command": "node \"${BRIDGE_SCRIPT}\" stop", "matcher": "Stop"}
    ],
    "sessionEnd": [
      {"command": "node \"${BRIDGE_SCRIPT}\" idle"}
    ]
  }
}
HOOKS
)

  if [ -f "$HOOKS_JSON" ]; then
    cp "$HOOKS_JSON" "$HOOKS_JSON.backup-$(date +%Y%m%d-%H%M%S)"
    echo -e "  ${YELLOW}已备份原有 hooks.json${NC}"
  fi
  echo "$CURSOR_HOOKS" > "$HOOKS_JSON"
  echo -e "  ${GREEN}Cursor hooks 已配置${NC}"
fi

# Claude Code hooks
if [ "$agent" = "claude" ] || [ "$agent" = "all" ]; then
  CLAUDE_DIR="$HOME/.claude"
  CLAUDE_SETTINGS="$CLAUDE_DIR/settings.json"
  BRIDGE_SCRIPT="$SYS_BRIDGE_DIR/claude-bridge.js"

  mkdir -p "$CLAUDE_DIR"

  CLAUDE_HOOKS=$(cat <<HOOKS
{
  "UserPromptSubmit": [
    {"matcher": "", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" turn-start", "timeout": 10}]}
  ],
  "PreToolUse": [
    {"matcher": "AskUserQuestion", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" await-user", "timeout": 10}]},
    {"matcher": "", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" busy", "timeout": 10}]}
  ],
  "PostToolUse": [
    {"matcher": "CreatePlan", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" plan-created", "timeout": 10}]}
  ],
  "PostToolUseFailure": [
    {"matcher": "", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" denied", "timeout": 10}]}
  ],
  "Stop": [
    {"matcher": "", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" stop", "timeout": 10}]}
  ],
  "SessionEnd": [
    {"matcher": "", "hooks": [{"type": "command", "command": "node \"${BRIDGE_SCRIPT}\" idle", "timeout": 10}]}
  ]
}
HOOKS
)

  if [ -f "$CLAUDE_SETTINGS" ]; then
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.backup-$(date +%Y%m%d-%H%M%S)"
    echo -e "  ${YELLOW}已备份原有 settings.json${NC}"
    # 用 node 做深度合并
    node -e "
      const fs = require('fs');
      const existing = JSON.parse(fs.readFileSync('${CLAUDE_SETTINGS}'.replace(/\\ /g, ' '), 'utf-8'));
      const hooks = JSON.parse(process.argv[1]);
      existing.hooks = Object.assign({}, existing.hooks || {}, hooks);
      fs.writeFileSync('${CLAUDE_SETTINGS}'.replace(/\\ /g, ' '), JSON.stringify(existing, null, 2));
    " "$CLAUDE_HOOKS" 2>/dev/null || {
      # 降级：直接写 hooks
      echo "{\"hooks\": $CLAUDE_HOOKS}" > "$CLAUDE_SETTINGS"
    }
  else
    echo "{\"hooks\": $CLAUDE_HOOKS}" > "$CLAUDE_SETTINGS"
  fi
  echo -e "  ${GREEN}Claude Code hooks 已配置${NC}"
fi

# ── 5. 完成 ───────────────────────────────────────────
echo -e "${YELLOW}[5/5] 安装完成!${NC}"
echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo "  后续步骤:"
echo "  1. 启动桌面挂件:  npm run widget"
echo "     (或直接运行打包后的可执行文件)"
echo "  2. 测试灯效:      npm run test:client"
echo "  3. 重启 Cursor / Claude Code 使 Hooks 生效"
echo "  4. 右键托盘图标可切换 Agent"
echo "  5. 查看日志:      cat ${SYS_BRIDGE_DIR}/state/*-hooks.log"
echo -e "${CYAN}═══════════════════════════════════════${NC}"

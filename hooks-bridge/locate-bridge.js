#!/usr/bin/env node
/**
 * locate-bridge.js — 查找 hooks-bridge 目录（跨平台）
 *
 * 读取 install-path.json，输出 hooks-bridge 的绝对路径。
 * 兼容 Windows / macOS / Linux。
 *
 * 用法:
 *   node locate-bridge.js              → 输出 hooks-bridge 路径
 *   node locate-bridge.js cursor       → 输出 cursor-bridge.js 完整路径
 *   node locate-bridge.js claude       → 输出 claude-bridge.js 完整路径
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getConfigDir() {
  const platform = os.platform();

  if (platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'agent-traffic-light');
  }

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agent-traffic-light');
  }

  // Linux / others: XDG_CONFIG_HOME 或 ~/.config
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  return path.join(xdgConfig || path.join(os.homedir(), '.config'), 'agent-traffic-light');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'install-path.json');
}

function getFallbackPath() {
  return path.join(getConfigDir(), 'hooks-bridge');
}

function locate() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const cfg = JSON.parse(raw);
    if (cfg.hooksBridge && fs.existsSync(cfg.hooksBridge)) {
      return cfg.hooksBridge;
    }
  } catch {}

  // 回退：检查标准安装位置
  const fallback = getFallbackPath();
  if (fs.existsSync(fallback)) {
    return fallback;
  }

  // 最后回退：当前脚本所在目录
  return __dirname;
}

const target = process.argv[2];
const bridgeDir = locate();

if (target === 'cursor') {
  console.log(path.join(bridgeDir, 'cursor-bridge.js'));
} else if (target === 'claude') {
  console.log(path.join(bridgeDir, 'claude-bridge.js'));
} else {
  console.log(bridgeDir);
}

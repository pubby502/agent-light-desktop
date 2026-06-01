#!/usr/bin/env node
/**
 * agent-light.js → 已迁移到 cursor-bridge.js
 *
 * LEGACY: 保留作为向后兼容重定向。当前 hooks.json 直接调用 cursor-bridge.js。
 * 直接调用 cursor-bridge.js 获得相同功能。
 */

const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'cursor-bridge.js');
const action = process.argv[2] || '';

try {
  execSync(`node "${script}" ${action}`, { stdio: 'inherit', timeout: 5000 });
} catch {
  // 静默处理 — cursor-bridge.js 内部已有日志
}

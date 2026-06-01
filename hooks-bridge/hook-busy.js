#!/usr/bin/env node
// LEGACY: 当前 hooks.json 直接调用 cursor-bridge.js，不使用此包装脚本。
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'cursor-bridge.js');
try { execSync(`node "${script}" busy`, { stdio: 'inherit', timeout: 5000 }); } catch {}

#!/usr/bin/env node
/**
 * Hook: busy — 工具调用时触发
 * preToolUse (所有工具)
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" busy`, { stdio: 'inherit', timeout: 5000 }); } catch {}

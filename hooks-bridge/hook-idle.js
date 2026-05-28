#!/usr/bin/env node
/**
 * Hook: idle — 会话结束时触发
 * sessionEnd
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" idle`, { stdio: 'inherit', timeout: 5000 }); } catch {}

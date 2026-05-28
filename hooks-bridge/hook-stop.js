#!/usr/bin/env node
/**
 * Hook: stop — Agent 停止时触发
 * stop matcher: Stop
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" stop`, { stdio: 'inherit', timeout: 5000 }); } catch {}

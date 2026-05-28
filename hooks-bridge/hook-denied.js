#!/usr/bin/env node
/**
 * Hook: denied — 工具调用失败时触发
 * postToolUseFailure
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" denied`, { stdio: 'inherit', timeout: 5000 }); } catch {}

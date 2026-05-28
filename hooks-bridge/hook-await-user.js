#!/usr/bin/env node
/**
 * Hook: await-user — Agent 提问等待用户时触发
 * preToolUse matcher: AskQuestion
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" await-user`, { stdio: 'inherit', timeout: 5000 }); } catch {}

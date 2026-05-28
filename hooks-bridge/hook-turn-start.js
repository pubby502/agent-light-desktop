#!/usr/bin/env node
/**
 * Hook: turn-start — 用户提交 Prompt 时触发
 * beforeSubmitPrompt matcher: UserPromptSubmit
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" turn-start`, { stdio: 'inherit', timeout: 5000 }); } catch {}

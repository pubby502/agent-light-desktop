#!/usr/bin/env node
/**
 * Hook: thinking — Agent 思考/分析时触发 (beforeSubmitPrompt 的通用入口)
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" thinking`, { stdio: 'inherit', timeout: 5000 }); } catch {}

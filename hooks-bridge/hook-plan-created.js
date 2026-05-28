#!/usr/bin/env node
/**
 * Hook: plan-created — CreatePlan 工具调用完成后触发
 * postToolUse matcher: CreatePlan
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" plan-created`, { stdio: 'inherit', timeout: 5000 }); } catch {}

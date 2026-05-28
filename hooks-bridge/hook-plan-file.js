#!/usr/bin/env node
/**
 * Hook: plan-file — 文件编辑后检测是否 Plan 文件
 * afterFileEdit
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" plan-file`, { stdio: 'inherit', timeout: 5000 }); } catch {}

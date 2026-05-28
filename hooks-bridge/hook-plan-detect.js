#!/usr/bin/env node
/**
 * Hook: plan-detect — Agent 回复后检测 Plan 模式
 * afterAgentResponse matcher: AgentResponse
 */
const { execSync } = require('child_process');
const path = require('path');
const script = path.join(__dirname, 'agent-light.js');
try { execSync(`node "${script}" plan-detect`, { stdio: 'inherit', timeout: 5000 }); } catch {}

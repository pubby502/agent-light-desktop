#!/usr/bin/env node
/**
 * Cursor Agent 状态 → 红绿灯挂件 桥接核心逻辑
 *
 * 从 CursorLight 的 agent-light.sh + ble_gate.py 移植为 Node.js。
 * 由 Cursor Hooks 调用, 解析 HOOK_INPUT 环境变量, 通过 WebSocket 发状态给桌面挂件。
 *
 * 用法:
 *   node agent-light.js <action>
 *
 * action 来自 hooks.json 绑定的 Cursor Hook 事件:
 *   turn-start, thinking, busy, stop, idle, plan-detect, plan-file, plan-created, denied, alarm-shell
 */

const fs = require('fs');
const path = require('path');

// ws 从脚本所在目录的 node_modules 加载 (Cursor Hook 的 CWD 是项目目录, 不是脚本目录)
const wsModulePath = path.join(__dirname, 'node_modules', 'ws');
const { WebSocket } = require(wsModulePath);

// ── 配置 ──────────────────────────────────────────────
const WIDGET_URL = process.env.TRAFFIC_LIGHT_URL || 'ws://127.0.0.1:17654';
const BRIDGE_DIR = __dirname;
const STATE_PATH = path.join(BRIDGE_DIR, 'state.json');
const LOCK_PATH = path.join(BRIDGE_DIR, 'state.lock');
const LOG_PATH = path.join(BRIDGE_DIR, 'hooks.log');

// ── 防抖配置 (ms) ─────────────────────────────────────
const DEBOUNCE_MS = {
  thinking: 5000,
  busy: 8000,
  alarm: 500,
  success: 3000,
  error: 3000,
  green: 3000,
};

// ── 有效状态 ──────────────────────────────────────────
const VALID_STATUSES = new Set([
  'idle', 'thinking', 'busy', 'success', 'error', 'alarm',
]);

// ── 工具函数 ──────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(data) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2)); } catch {}
}

function nowMs() {
  return Date.now();
}

// ── 原子去重 & 状态机 (移植自 ble_gate.py) ─────────────

function gateCheck(action, mode) {
  // 简易文件锁
  let lockFd;
  try {
    lockFd = fs.openSync(LOCK_PATH, 'w');
  } catch {
    return { send: true, mode };
  }

  const data = loadState();
  const lastMode = data.lastMode || '';
  const lastTs = data.lastTs || 0;
  const phase = data.turnPhase || '';
  const now = nowMs();

  let send = true;
  let reason = '';

  switch (action) {
    case 'turn-start':
      // 新 Prompt：开始新一轮，允许从 busy 回到 thinking
      data.turnPhase = 'thinking';
      data.awaitingBuild = false;
      data.buildStarted = false;
      data.planTouched = false;
      data.turnStartedMs = now;
      if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.thinking) {
        send = false; reason = 'turn-start debounce';
      }
      break;

    case 'thinking':
      if (phase === 'busy') {
        send = false; reason = 'thinking blocked by busy phase';
      } else if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.thinking) {
        send = false; reason = 'thinking debounce';
      } else {
        data.turnPhase = 'thinking';
      }
      break;

    case 'busy':
      data.turnPhase = 'busy';
      if (phase === 'busy' && lastMode === 'busy') {
        send = false; reason = 'sticky busy';
      } else if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.busy) {
        send = false; reason = 'busy debounce';
      }
      break;

    case 'await-user':
      data.turnPhase = 'awaiting_user';
      mode = 'alarm';
      if (lastMode === 'alarm' && (now - lastTs) < DEBOUNCE_MS.alarm) {
        send = false; reason = 'await-user debounce';
      }
      break;

    case 'idle':
      if (data.awaitingBuild) {
        mode = 'alarm';
        if (lastMode === 'alarm' && (now - lastTs) < DEBOUNCE_MS.alarm) {
          send = false; reason = 'idle-alarm debounce';
        }
        data.turnPhase = '';
      } else {
        data.turnPhase = '';
        if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.green) {
          send = false; reason = 'idle debounce';
        }
      }
      break;

    case 'stop-success':
      if (data.awaitingBuild) {
        mode = 'alarm';
        if (lastMode === 'alarm' && (now - lastTs) < DEBOUNCE_MS.alarm) {
          send = false; reason = 'stop-alarm debounce';
        }
      } else {
        if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.success) {
          send = false; reason = 'stop-success debounce';
        }
      }
      data.turnPhase = '';
      data.awaitingBuild = false;
      break;

    case 'stop-error':
      data.turnPhase = '';
      if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.error) {
        send = false; reason = 'stop-error debounce';
      }
      break;

    case 'denied-thinking':
      if (phase === 'busy') {
        mode = 'busy';
        if (lastMode === 'busy') { send = false; reason = 'denied sticky busy'; }
      } else {
        data.turnPhase = 'thinking';
        mode = 'thinking';
      }
      break;

    case 'denied-error':
      if (phase === 'busy') {
        send = false; reason = 'denied-error during busy';
      } else {
        data.turnPhase = '';
        if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.error) {
          send = false; reason = 'denied-error debounce';
        }
      }
      break;

    default:
      // plan-detect 类 action 不走 gate, 直接返回不发送
      send = false; reason = 'passthrough';
  }

  if (send) {
    data.lastMode = mode;
    data.lastTs = now;
    saveState(data);
  } else {
    saveState(data);
  }

  try { fs.closeSync(lockFd); } catch {}
  return { send, mode, reason };
}

// ── Plan 模式检测 (移植自 agent-light.sh looks_like_plan_awaiting) ──

function looksLikePlanAwaiting(text) {
  if (!text || !text.trim()) return false;

  // 排除「已全部完成」
  if (/已全部|全部完成|实施完成|落地完成|搞定了吗|completed all|todos.*completed|Do not create them again/i.test(text)) {
    return false;
  }

  const hasArtifact = /[\w./-]+\.plan\.md|\.cursor\/plans\//i.test(text);
  const hasPlanBoilerplate = /Do NOT edit the plan file|attached for your reference|Do NOT edit the plan|计划文件本身/i.test(text);
  const hasWaitCTA = /回复[「\s*]*执行计划|若认可.*(?:方案|计划).{0,40}(?:回复|执行)|说[「\s]*执行计划[」\s]*即可|方可开始.*(?:实施|落地)|unambiguously.*execute the plan/i.test(text);
  const hasImplAttach = /Implement the plan as specified/i.test(text) && hasPlanBoilerplate;

  if (hasImplAttach && (hasArtifact || hasPlanBoilerplate)) return true;
  if ((hasArtifact || hasPlanBoilerplate) && hasWaitCTA) return true;
  if (hasArtifact && /执行计划/.test(text) && /回复|若认可|点\s*Build|Build\s*即可/i.test(text)) return true;

  // Plan 模式 Review Plan / CreatePlan
  if (/Review\s*Plan|CreatePlan/i.test(text)) return true;
  if (/点\s*Build|点击\s*Build|Build\s*即可|等你.*Build/i.test(text)) return true;

  // 中文行程/攻略类 plan
  if (/(?:一日游|行程|路线|攻略).{0,80}(?:计划|方案)/i.test(text)) return true;

  return false;
}

function isPlanFilePath(p) {
  if (!p) return false;
  return /\.plan\.md$/i.test(p) || p.includes('.cursor/plans/') || p.includes('.cursor\\plans\\');
}

// ── 近期 plan 文件检测 (移植自 has_recent_plan_awaiting) ──

function hasRecentPlanAwaiting() {
  const data = loadState();
  const now = nowMs();
  const turnMs = data.turnStartedMs || 0;
  const windowMs = 8 * 60 * 1000; // 8 分钟窗口

  const plansDir = path.join(process.env.USERPROFILE || process.env.HOME, '.cursor', 'plans');
  if (!fs.existsSync(plansDir)) return null;

  let bestMs = 0;
  let bestName = '';

  try {
    const files = fs.readdirSync(plansDir);
    for (const f of files) {
      if (!f.endsWith('.plan.md')) continue;
      try {
        const stat = fs.statSync(path.join(plansDir, f));
        const mtimeMs = stat.mtimeMs;
        if (now - mtimeMs > windowMs) continue;
        if (turnMs && mtimeMs < turnMs - 3000) continue;
        if (mtimeMs > bestMs) {
          bestMs = mtimeMs;
          bestName = f;
        }
      } catch {}
    }
  } catch {}

  return bestMs ? bestName : null;
}

// ── 工具类型判断 (移植自 is_exec_tool / tool_is_plan_write / tool_target_path) ──

const EXEC_TOOLS = new Set([
  'Shell', 'Delete', 'ApplyPatch', 'EditNotebook', 'NotebookEdit',
  'run_terminal_cmd', 'Task',
]);

function getToolTargetPath(input) {
  try {
    const ti = input.tool_input || {};
    return ti.path || ti.file_path || ti.filePath || ti.target_file || '';
  } catch {
    return '';
  }
}

function isExecTool(toolName, input) {
  if (EXEC_TOOLS.has(toolName)) return true;
  if (toolName === 'Write' || toolName === 'StrReplace') {
    const p = getToolTargetPath(input);
    return p && !isPlanFilePath(p);
  }
  return false;
}

function toolIsPlanWrite(toolName, input) {
  if (toolName !== 'Write' && toolName !== 'StrReplace') return false;
  const p = getToolTargetPath(input);
  return isPlanFilePath(p);
}

// ── WebSocket 发送 ────────────────────────────────────

let ws = null;

function sendToWidget(status) {
  return new Promise((resolve) => {
    try {
      ws = new WebSocket(WIDGET_URL);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'status', value: status }));
        log(`WS send: ${status}`);
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        log(`WS error: ${err.message}`);
        resolve();
      });

      // timeout
      setTimeout(() => {
        try { ws.close(); } catch {}
        resolve();
      }, 3000);
    } catch (e) {
      log(`WS connect failed: ${e.message}`);
      resolve();
    }
  });
}

// ── Plan 状态管理 (移植自 agent-light.sh 的 state 函数) ──

function setStateFlag(key, value) {
  const data = loadState();
  data[key] = value;
  saveState(data);
}

function getStateFlag(key) {
  return !!loadState()[key];
}

// ── 主逻辑 ────────────────────────────────────────────

async function main() {
  const action = process.argv[2];
  if (!action) {
    console.error('Usage: node agent-light.js <action>');
    process.exit(1);
  }

  // 读取输入: 优先 HOOK_INPUT, 再尝试 stdin (两者合并)
  let input = {};

  // 辅助: 去掉 BOM 和空白后解析 JSON
  function tryParse(raw) {
    if (!raw) return null;
    // 去掉 BOM (U+FEFF) 和首尾空白
    const clean = raw.replace(/^\uFEFF/, '').trim();
    if (!clean.startsWith('{')) return null;
    try { return JSON.parse(clean); } catch { return null; }
  }

  // 1. 尝试 HOOK_INPUT 环境变量
  const rawEnv = process.env.HOOK_INPUT;
  if (rawEnv) {
    const parsed = tryParse(rawEnv);
    if (parsed) input = parsed;
  }

  // 2. 尝试 stdin (Cursor 某些事件可能只走 stdin)
  const stdinData = await readStdin();
  if (stdinData) {
    const parsed = tryParse(stdinData);
    if (parsed) input = { ...input, ...parsed };
  }

  const toolName = input.tool_name || '';
  const status = input.status || '';
  const text = (input.text || input.content || '').toString();
  const filePath = input.file_path || '';
  const failureType = input.failure_type || '';
  const toolInput = input.tool_input || {};

  // 调试: 记录原始输入 (帮助排查 Cursor 数据传递问题)
  if (!status && action === 'stop') {
    log(`DEBUG stop raw: env=${rawEnv ? rawEnv.substring(0, 200) : '(none)'} stdin=${stdinData ? stdinData.substring(0, 200) : '(none)'}`);
  }

  log(`action=${action} tool=${toolName || '-'} status=${status || '-'}`);

  switch (action) {
    // ── 用户提交 Prompt / Agent 开始思考 ──
    case 'turn-start': {
      const g = gateCheck('turn-start', 'thinking');
      if (g.send) await sendToWidget(g.mode);
      break;
    }

    // ── Agent 思考中 ──
    case 'thinking': {
      const g = gateCheck('thinking', 'thinking');
      if (g.send) await sendToWidget(g.mode);
      break;
    }

    // ── 等待用户 (AskQuestion) ──
    case 'await-user': {
      const g = gateCheck('await-user', 'alarm');
      if (g.send) {
        await sendToWidget(g.mode);
        log('await-user -> alarm (AskQuestion / Questions UI)');
      }
      break;
    }

    // ── 工具调用 (busy) ──
    case 'busy': {
      // 检测提问类工具 (兜底 AskQuestion 匹配不到的情况)
      const isAskTool = /Ask(Question|User|Followup)|question|confirm|clarify/i.test(toolName);
      if (isAskTool) {
        const g = gateCheck('await-user', 'alarm');
        if (g.send) {
          await sendToWidget(g.mode);
          log(`busy: tool=${toolName} looks like ask → alarm`);
        }
        break;
      }

      // Plan 写入检测
      if (toolIsPlanWrite(toolName, input)) {
        setStateFlag('planTouched', true);
        setStateFlag('awaitingBuild', true);
        log(`busy: plan write -> awaiting Build (tool=${toolName})`);
      }
      // 用户已点 Build 开始执行
      else if (getStateFlag('awaitingBuild') && toolName !== 'CreatePlan') {
        setStateFlag('awaitingBuild', false);
        setStateFlag('buildStarted', true);
        log(`busy: cleared awaiting_build, build_started (tool=${toolName || 'unknown'})`);
      }
      // 执行类工具
      else if (isExecTool(toolName, input)) {
        setStateFlag('buildStarted', true);
        log(`busy: build_started (exec tool=${toolName})`);
      }

      const g = gateCheck('busy', 'busy');
      if (g.send) await sendToWidget(g.mode);
      break;
    }

    // ── Plan 创建后 (CreatePlan) ──
    case 'plan-created': {
      setStateFlag('planTouched', true);
      setStateFlag('awaitingBuild', true);
      const g = gateCheck('await-user', 'alarm');
      if (g.send) {
        await sendToWidget(g.mode);
        log('plan-created (CreatePlan) awaiting_build=true -> alarm');
      }
      break;
    }

    // ── Agent 回复后检测 plan 模式 ──
    case 'plan-detect': {
      if (getStateFlag('buildStarted')) {
        log('plan-detect skip (build already started)');
        break;
      }
      if (looksLikePlanAwaiting(text)) {
        setStateFlag('planTouched', true);
        setStateFlag('awaitingBuild', true);
        const g = gateCheck('await-user', 'alarm');
        if (g.send) {
          await sendToWidget(g.mode);
          log('plan-detect awaiting_build=true -> alarm');
        }
      }
      break;
    }

    // ── 文件编辑检测 plan ──
    case 'plan-file': {
      if (getStateFlag('buildStarted')) {
        log('plan-file skip (build already started)');
        break;
      }
      if (isPlanFilePath(filePath)) {
        setStateFlag('planTouched', true);
        setStateFlag('awaitingBuild', true);
        const g = gateCheck('await-user', 'alarm');
        if (g.send) {
          await sendToWidget(g.mode);
          log(`plan-file awaiting_build=true path=${path.basename(filePath)} -> alarm`);
        }
      }
      break;
    }

    // ── Agent 停止 ──
    case 'stop': {
      // 兜底: 如果 status 为空, 检查 buildStarted 状态推断结果
      const effectiveStatus = status || (getStateFlag('buildStarted') ? 'completed' : 'completed');
      log(`stop status=${status || '(empty)'} → effective=${effectiveStatus}`);

      switch (effectiveStatus) {
        case 'completed': {
          if (getStateFlag('buildStarted')) {
            const g = gateCheck('stop-success', 'success');
            if (g.send) {
              await sendToWidget(g.mode);
              log('stop -> success (build started)');
            }
          } else if (getStateFlag('awaitingBuild')) {
            const g = gateCheck('stop-success', 'alarm');
            if (g.send) {
              await sendToWidget(g.mode);
              log('stop -> alarm (awaiting Build)');
            }
          } else if (getStateFlag('planTouched') || hasRecentPlanAwaiting()) {
            const recentPlan = hasRecentPlanAwaiting();
            setStateFlag('awaitingBuild', true);
            const g = gateCheck('stop-success', 'alarm');
            if (g.send) {
              await sendToWidget(g.mode);
              log(`stop -> alarm (plan ready, await Build${recentPlan ? ', file=' + recentPlan : ''})`);
            }
          } else {
            const g = gateCheck('stop-success', 'success');
            if (g.send) {
              await sendToWidget(g.mode);
              log('stop -> success');
            }
          }
          break;
        }

        case 'error':
        case 'aborted': {
          const g = gateCheck('stop-error', 'error');
          if (g.send) {
            await sendToWidget(g.mode);
            log('stop -> error');
          }
          break;
        }

        default:
          log('stop no mode change');
      }
      break;
    }

    // ── 工具调用失败 ──
    case 'denied': {
      if (failureType === 'permission_denied') {
        const g = gateCheck('denied-thinking', 'thinking');
        if (g.send) await sendToWidget(g.mode);
      } else {
        const g = gateCheck('denied-error', 'error');
        if (g.send) await sendToWidget(g.mode);
      }
      break;
    }

    // ── 会话结束 → 空闲 ──
    case 'idle': {
      if (getStateFlag('awaitingBuild')) {
        const g = gateCheck('idle', 'alarm');
        if (g.send) {
          await sendToWidget(g.mode);
          log('idle -> alarm (still awaiting Build)');
        }
      } else {
        const g = gateCheck('idle', 'idle');
        if (g.send) await sendToWidget(g.mode);
      }
      break;
    }

    default:
      log(`unknown action=${action}`);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    // 如果 stdin 已经是 TTY (没有管道输入), 直接返回空
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // 最多等 2 秒, stdin 通常立即可用
    setTimeout(() => resolve(data), 2000);
  });
}

main().catch((e) => {
  log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * bridge-core.js — 多 Agent 共享的状态机 + 防抖 + WebSocket 发送核心
 *
 * 用法：
 *   const bridge = require('./bridge-core');
 *   bridge.init({ agent: 'cursor', widgetUrl: 'ws://127.0.0.1:17654' });
 *   const g = bridge.gateCheck('busy', 'busy');
 *   if (g.send) await bridge.sendToWidget(g.mode);
 *
 * Agent 类型：'cursor' | 'claude'
 * 每种 Agent 拥有独立的 state.json、lock 文件和日志。
 */

const fs = require('fs');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────

// 需要用户授权/确认的高风险工具（触发 alarm 而非 busy）
const AUTH_REQUIRED_TOOLS = new Set([
  'Shell', 'Bash', 'Run', 'Terminal', 'execute_command',
  'Delete', 'Write', 'StrReplace', 'ApplyPatch',
  'Edit', 'NotebookEdit', 'EditFile',
]);

// 提问类工具（触发 alarm）
const ASK_TOOLS = new Set([
  'AskQuestion', 'AskUserQuestion', 'AskUser', 'AskFollowup',
  'question', 'confirm', 'clarify', 'prompt_user',
  'request_user_input', 'get_user_input',
]);

// 执行类工具（标记 buildStarted）
const EXEC_TOOLS = new Set([
  'Shell', 'Delete', 'ApplyPatch', 'EditNotebook', 'NotebookEdit',
  'run_terminal_cmd', 'Task',
]);

// 有效状态
const VALID_STATUSES = new Set([
  'idle', 'thinking', 'busy', 'success', 'error', 'alarm',
]);

// 防抖配置 (ms)
const DEFAULT_DEBOUNCE_MS = {
  thinking: 5000,
  busy: 8000,
  alarm: 500,
  success: 3000,
  error: 3000,
  green: 3000,
};

// ── 模块状态 ──────────────────────────────────────────

let AGENT = '';
let WIDGET_URL = 'ws://127.0.0.1:17654';
let BRIDGE_DIR = __dirname;
let baseDir = BRIDGE_DIR;

// 心跳检测窗口：超过此时间无活动视为等待用户
const IDLE_HEARTBEAT_MS = 45 * 1000; // 45 秒无 Hook → 可能等待用户
// 静默窗口：stop 后等待此时间再判断
const STOP_SILENCE_MS = 4000; // 4 秒

// ── 初始化 ────────────────────────────────────────────

function init(opts = {}) {
  AGENT = opts.agent || 'cursor';
  WIDGET_URL = opts.widgetUrl || process.env.TRAFFIC_LIGHT_URL || 'ws://127.0.0.1:17654';
  if (opts.bridgeDir) BRIDGE_DIR = opts.bridgeDir;
  baseDir = path.join(BRIDGE_DIR, 'state');
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}

  initDebounce(opts.debounceMs);
}

function initDebounce(overrides) {
  Object.assign(DEBOUNCE_MS, overrides || {});
}
let DEBOUNCE_MS = { ...DEFAULT_DEBOUNCE_MS };

// ── 路径 ──────────────────────────────────────────────

function statePath() { return path.join(baseDir, `${AGENT}-state.json`); }
function lockPath()  { return path.join(baseDir, `${AGENT}-state.lock`); }
function logPath()   { return path.join(baseDir, `${AGENT}-hooks.log`); }

// ── 日志 ──────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [${AGENT}] ${msg}\n`;
  try { fs.appendFileSync(logPath(), line); } catch {}
}

// ── 状态读写 ──────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(data) {
  try { fs.writeFileSync(statePath(), JSON.stringify(data, null, 2)); } catch {}
}

function nowMs() { return Date.now(); }

// ── 状态位标记 ────────────────────────────────────────

function setStateFlag(key, value) {
  const data = loadState();
  data[key] = value;
  saveState(data);
}

function getStateFlag(key) {
  return !!loadState()[key];
}

// ── 心跳检测（静默窗口 → alarm） ─────────────────────

let heartbeatTimer = null;

function updateHeartbeat() {
  const data = loadState();
  data.lastHookTs = nowMs();
  saveState(data);
}

/**
 * 检测是否需要转入 alarm：距离上次 Hook 超过阈值
 * 由调用方在合适时机调用（stop/idle 后、定期检查等）
 */
function checkSilenceAlarm() {
  const data = loadState();
  const lastHook = data.lastHookTs || 0;
  const now = nowMs();
  const silenceMs = now - lastHook;

  // 如果静默时间超过心跳阈值，检查是否有未处理等待
  if (silenceMs > IDLE_HEARTBEAT_MS && data.turnPhase && data.turnPhase !== '') {
    log(`heartbeat: silence ${Math.round(silenceMs / 1000)}s, phase=${data.turnPhase} → possible waiting`);
    return true;
  }
  return false;
}

// ── 门控逻辑 (状态机 + 防抖) ─────────────────────────

function gateCheck(action, mode) {
  // 获取排他文件锁（'wx' = 原子排他创建，跨平台有效）
  let lockFd;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      lockFd = fs.openSync(lockPath(), 'wx');
      break;
    } catch {
      // 检查锁文件是否过期 (> 5s)
      try {
        const st = fs.statSync(lockPath());
        if (nowMs() - st.mtimeMs > 5000) {
          try { fs.unlinkSync(lockPath()); } catch {}
        }
      } catch {}
      if (attempt < 9) {
        // 自旋等待 2ms 后重试
        const waitUntil = nowMs() + 2;
        while (nowMs() < waitUntil) { /* spin */ }
      }
    }
  }
  if (!lockFd) {
    return { send: true, mode, reason: 'lock failed' };
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
      data.turnPhase = 'thinking';
      data.awaitingBuild = false;
      data.buildStarted = false;
      data.planTouched = false;
      data.awaitingUser = false;
      data.authPending = false;
      data.turnStartedMs = now;
      data.lastHookTs = now;
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
        data.awaitingUser = false;
        data.lastHookTs = now;
      }
      break;

    case 'busy':
      data.turnPhase = 'busy';
      data.awaitingUser = false;
      data.lastHookTs = now;
      if (phase === 'busy' && lastMode === 'busy') {
        send = false; reason = 'sticky busy';
      } else if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.busy) {
        send = false; reason = 'busy debounce';
      }
      break;

    case 'await-user':
      data.turnPhase = 'awaiting_user';
      data.awaitingUser = true;
      data.lastHookTs = now;
      mode = 'alarm';
      if (lastMode === 'alarm' && (now - lastTs) < DEBOUNCE_MS.alarm) {
        send = false; reason = 'await-user debounce';
      }
      break;

    case 'idle':
      data.lastHookTs = now;
      if (data.awaitingBuild || data.awaitingUser || data.authPending) {
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
      data.lastHookTs = now;
      if (data.awaitingBuild || data.awaitingUser || data.authPending) {
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
      data.lastHookTs = now;
      data.turnPhase = '';
      data.awaitingUser = false;
      data.authPending = false;
      if (mode === lastMode && (now - lastTs) < DEBOUNCE_MS.error) {
        send = false; reason = 'stop-error debounce';
      }
      break;

    case 'denied-thinking':
      data.lastHookTs = now;
      data.awaitingUser = false;
      data.authPending = false;
      if (phase === 'busy') {
        mode = 'busy';
        if (lastMode === 'busy') { send = false; reason = 'denied sticky busy'; }
      } else {
        data.turnPhase = 'thinking';
        mode = 'thinking';
      }
      break;

    case 'denied-error':
      data.lastHookTs = now;
      data.awaitingUser = false;
      data.authPending = false;
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
  try { fs.unlinkSync(lockPath()); } catch {}
  return { send, mode, reason };
}

// ── WebSocket 发送 ────────────────────────────────────

function resolveWsModule() {
  try { return require('ws'); } catch {}

  try { return require(path.join(BRIDGE_DIR, 'node_modules', 'ws')); } catch {}

  const appData = process.env.APPDATA;
  if (appData) {
    try {
      return require(path.join(appData, 'agent-traffic-light', 'hooks-bridge', 'node_modules', 'ws'));
    } catch {}
  }

  let dir = BRIDGE_DIR;
  for (let i = 0; i < 5; i++) {
    try { return require(path.join(dir, 'node_modules', 'ws')); } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `bridge-core: Cannot find 'ws' module. Run "npm install ws" in: ${BRIDGE_DIR}`
  );
}

let ws = null;

function sendToWidget(status) {
  return new Promise((resolve) => {
    try {
      const WebSocket = resolveWsModule();
      ws = new WebSocket(WIDGET_URL);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'status', value: status, agent: AGENT }), (err) => {
          if (err) log(`WS send error: ${err.message}`);
          else log(`WS send: ${status}`);
          ws.close();
          resolve();
        });
      });

      ws.on('error', (err) => {
        log(`WS error: ${err.message}`);
        resolve();
      });

      setTimeout(() => {
        try { ws.close(); } catch {}
        resolve();
      }, 8000);
    } catch (e) {
      log(`WS connect failed: ${e.message}`);
      resolve();
    }
  });
}

// ── Plan 模式检测 ─────────────────────────────────────

function looksLikePlanAwaiting(text) {
  if (!text || !text.trim()) return false;

  if (/已全部|全部完成|实施完成|落地完成|搞定了吗|completed all|todos.*completed|Do not create them again/i.test(text)) {
    return false;
  }

  const hasArtifact = /[\w./-]+\.plan\.md|\.cursor\/plans\//i.test(text);
  const hasPlanBoilerplate = /Do NOT edit the plan file|attached for your reference|Do NOT edit the plan|计划文件本身/i.test(text);
  const hasWaitCTA = /回复[「\s]*执行计划|若认可.*(?:方案|计划).{0,40}(?:回复|执行)|说[「\s]*执行计划[」\s]*即可|方可开始.*(?:实施|落地)|unambiguously.*execute the plan/i.test(text);
  const hasImplAttach = /Implement the plan as specified/i.test(text) && hasPlanBoilerplate;

  if (hasImplAttach && (hasArtifact || hasPlanBoilerplate)) return true;
  if ((hasArtifact || hasPlanBoilerplate) && hasWaitCTA) return true;
  if (hasArtifact && /执行计划/.test(text) && /回复|若认可|点\s*Build|Build\s*即可/i.test(text)) return true;
  if (/Review\s*Plan|CreatePlan/i.test(text)) return true;
  if (/点\s*Build|点击\s*Build|Build\s*即可|等你.*Build/i.test(text)) return true;
  if (/(?:一日游|行程|路线|攻略).{0,80}(?:计划|方案)/i.test(text)) return true;

  return false;
}

/**
 * 检测普通文本回复里是否在等待用户确认/回答
 * 目标：覆盖未使用 AskQuestion 工具、仅通过自然语言发问的场景
 */
function looksLikeUserAwaiting(text) {
  if (!text || !text.trim()) return false;
  const t = text.trim();

  // 明确“无需回复/仅告知”类文案应跳过
  if (/(无需回复|仅供参考|仅通知|仅说明|不需要你回复|no need to reply|for your information)/i.test(t)) {
    return false;
  }

  // 明确等待用户动作的关键词
  if (/(请确认|请回复|请告知|请选择|是否继续|是否需要|要不要继续|can you confirm|please confirm|please reply|which option)/i.test(t)) {
    return true;
  }

  // 问句 + 第二人称语义，作为弱信号
  const hasQuestionMark = /[?？]/.test(t);
  const hasSecondPerson = /(你|你们|是否|要不要|可以吗|行吗|would you|can you|do you)/i.test(t);
  if (hasQuestionMark && hasSecondPerson) return true;

  return false;
}

function isPlanFilePath(p) {
  if (!p) return false;
  return /\.plan\.md$/i.test(p) || p.includes('.cursor/plans/') || p.includes('.cursor\\plans\\');
}

function hasRecentPlanAwaiting() {
  const data = loadState();
  const now = nowMs();
  const turnMs = data.turnStartedMs || 0;
  const windowMs = 8 * 60 * 1000;

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

// ── 工具判断 ──────────────────────────────────────────

function getToolTargetPath(input) {
  try {
    const ti = input.tool_input || input.tool_arguments || input.arguments || {};
    return ti.path || ti.file_path || ti.filePath || ti.target_file || ti.file || '';
  } catch {
    return '';
  }
}

/**
 * 判断工具是否需要用户授权执行（高风险操作）
 * @param {string} toolName
 * @param {object} input — HOOK_INPUT 解析后的对象
 * @returns {boolean}
 */
function isAuthRequiredTool(toolName, input) {
  // 直接匹配高风险工具名
  if (AUTH_REQUIRED_TOOLS.has(toolName)) return true;

  // Write/StrReplace 操作非 plan 文件也需要授权
  if (toolName === 'Write' || toolName === 'StrReplace') {
    const p = getToolTargetPath(input);
    return p && !isPlanFilePath(p);
  }

  return false;
}

/**
 * 判断工具是否为提问类（Agent 在等待用户回复）
 */
function isAskTool(toolName) {
  return ASK_TOOLS.has(toolName) || /Ask(Question|User|Followup)|question|confirm|clarify/i.test(toolName || '');
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

// ── Stdin 读取 ────────────────────────────────────────

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

// ── HOOK_INPUT 解析（兼容 Cursor / Claude 不同字段名） ─

function tryParse(raw) {
  if (!raw) return null;
  const clean = raw.replace(/^\uFEFF/, '').trim();
  if (!clean.startsWith('{')) return null;
  try { return JSON.parse(clean); } catch { return null; }
}

async function readHookInput() {
  let input = {};

  const rawEnv = process.env.HOOK_INPUT;
  if (rawEnv) {
    const parsed = tryParse(rawEnv);
    if (parsed) input = parsed;
  }

  const stdinData = await readStdin();
  if (stdinData) {
    const parsed = tryParse(stdinData);
    if (parsed) input = { ...input, ...parsed };
  }

  return normalizeInput(input);
}

/**
 * 统一字段名：兼容 Cursor 和 Claude 不同的命名
 * Cursor: tool_name, tool_input, file_path, text, status, failure_type
 * Claude:  toolName,  input,      filePath,  text, status, failureType
 */
function normalizeInput(input) {
  if (!input) return {};

  return {
    toolName: input.tool_name || input.toolName || input.tool || '',
    toolInput: input.tool_input || input.tool_arguments || input.arguments || input.input || {},
    filePath: input.file_path || input.filePath || input.file || '',
    text: (input.text || input.content || input.message || '').toString(),
    status: input.status || '',
    failureType: input.failure_type || input.failureType || '',
  };
}

// ── 导出 ──────────────────────────────────────────────

module.exports = {
  init,
  gateCheck,
  sendToWidget,
  log,
  loadState,
  saveState,
  setStateFlag,
  getStateFlag,
  nowMs,
  updateHeartbeat,
  checkSilenceAlarm,
  looksLikePlanAwaiting,
  looksLikeUserAwaiting,
  isPlanFilePath,
  hasRecentPlanAwaiting,
  isAuthRequiredTool,
  isAskTool,
  isExecTool,
  toolIsPlanWrite,
  readStdin,
  readHookInput,
  normalizeInput,
  getToolTargetPath,
  VALID_STATUSES,
  DEBOUNCE_MS,
  IDLE_HEARTBEAT_MS,
  STOP_SILENCE_MS,
};

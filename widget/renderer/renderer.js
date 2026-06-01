const box = document.getElementById('lightBox');
const connDot = document.getElementById('connDot');
const label = document.getElementById('label');
const agentLabel = document.getElementById('agentLabel');

const LABELS = {
  idle: 'IDLE',
  thinking: 'THINK',
  busy: 'BUSY',
  success: 'DONE',
  error: 'ERROR',
  alarm: 'ALARM',
};

const AGENT_NAMES = {
  cursor: 'CURSOR',
  claude: 'CLAUDE',
};

// ── 超时配置 ──────────────────────────────────────────
const TIMEOUTS = {
  thinking: 5 * 60 * 1000,
  busy:     5 * 60 * 1000,
  success:  30 * 1000,
  error:    30 * 1000,
  alarm:    10 * 60 * 1000,
  idle:     0,
};
let timeoutId = null;
let currentStatus = 'idle';

// ── 心跳指示 ──────────────────────────────────────────
const HEARTBEAT_MS = 30 * 1000;
let lastActivity = 0;
let heartbeatId = null;

function updateHeartbeat() {
  const alive = (Date.now() - lastActivity) < HEARTBEAT_MS;
  connDot.classList.toggle('connected', alive);
  connDot.title = alive ? '运行中' : '未运行';
}

function applyStatus(value) {
  if (!LABELS[value]) return;

  clearTimeout(timeoutId);
  timeoutId = null;

  currentStatus = value;
  box.dataset.status = value;
  label.textContent = LABELS[value];

  lastActivity = Date.now();
  updateHeartbeat();

  const ms = TIMEOUTS[value];
  if (ms > 0) {
    timeoutId = setTimeout(() => {
      if (currentStatus === value && value !== 'idle') {
        applyStatus('idle');
      }
    }, ms);
  }
}

function applyConnection(connected) {
  if (connected) {
    lastActivity = Date.now();
    updateHeartbeat();
  }
}

function applyAgent(agent) {
  if (agentLabel) {
    agentLabel.textContent = AGENT_NAMES[agent] || agent.toUpperCase();
  }
  if (box) box.dataset.agent = agent;
}

heartbeatId = setInterval(updateHeartbeat, 1000);

window.electronAPI.onStatus(applyStatus);
window.electronAPI.onConnectionChanged(applyConnection);
window.electronAPI.onAgentChanged(applyAgent);

(async () => {
  const init = await window.electronAPI.getInitial();
  applyConnection(init.connected);
  if (init.agent) applyAgent(init.agent);
})();

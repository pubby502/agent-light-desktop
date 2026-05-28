const vscode = require('vscode');
const WebSocket = require('ws');

const RECONNECT_MS = 5000;
const BURST_WINDOW_MS = 200;
const DONE_TO_IDLE_MS = 5000;

let ws = null;
let reconnectTimer = null;
let statusBar = null;
let currentStatus = 'idle';
let idleTimer = null;
let doneTimer = null;
let burstChars = 0;
let burstResetTimer = null;
let context = null;

function getConfig() {
  const c = vscode.workspace.getConfiguration('trafficLight');
  return {
    widgetUrl: c.get('widgetUrl', 'ws://localhost:17654'),
    autoDetect: c.get('autoDetect', true),
    idleAfterMs: c.get('idleAfterMs', 2000),
    burstCharThreshold: c.get('burstCharThreshold', 50),
  };
}

function setStatus(value, { broadcast = true } = {}) {
  if (currentStatus === value) return;
  currentStatus = value;
  updateStatusBar();
  if (broadcast) sendStatus(value);

  clearTimeout(doneTimer);
  if (value === 'done') {
    doneTimer = setTimeout(() => setStatus('idle'), DONE_TO_IDLE_MS);
  }
}

function sendStatus(value) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'status', value }));
    } catch (e) {
      console.error('[traffic-light] send failed:', e.message);
    }
  }
}

function connect() {
  const { widgetUrl } = getConfig();
  clearTimeout(reconnectTimer);

  try {
    ws = new WebSocket(widgetUrl);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    console.log('[traffic-light] connected to widget');
    updateStatusBar();
    // Resync current status to the widget
    sendStatus(currentStatus);
  });

  ws.on('close', () => {
    console.log('[traffic-light] widget connection closed');
    updateStatusBar();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    // Don't spam — error precedes close
    console.log('[traffic-light] ws error:', err.message);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_MS);
}

function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function updateStatusBar() {
  if (!statusBar) return;
  const icons = {
    idle: '$(circle-outline)',
    developing: '$(circle-large-filled)',
    needConfirm: '$(warning)',
    done: '$(check)',
  };
  const labels = {
    idle: 'Idle',
    developing: 'Developing',
    needConfirm: 'Confirm?',
    done: 'Done',
  };
  const connMark = isConnected() ? '' : ' (offline)';
  statusBar.text = `${icons[currentStatus] || ''} TL: ${labels[currentStatus]}${connMark}`;
  statusBar.tooltip = `Traffic Light status: ${currentStatus}${connMark}`;
  statusBar.show();
}

// ---------- Auto detection ----------

function onTextChange(e) {
  const cfg = getConfig();
  if (!cfg.autoDetect) return;
  // Ignore output/log channels, settings, etc.
  if (e.document.uri.scheme !== 'file' && e.document.uri.scheme !== 'untitled') return;

  let inserted = 0;
  for (const change of e.contentChanges) {
    inserted += change.text.length;
  }
  if (inserted <= 0) return;

  burstChars += inserted;
  clearTimeout(burstResetTimer);
  burstResetTimer = setTimeout(() => {
    burstChars = 0;
  }, BURST_WINDOW_MS);

  if (burstChars >= cfg.burstCharThreshold) {
    setStatus('developing');
  }

  // Reset the idle countdown — any edit defers the "done" trigger
  clearTimeout(idleTimer);
  if (currentStatus === 'developing') {
    idleTimer = setTimeout(() => {
      if (currentStatus === 'developing') setStatus('done');
    }, cfg.idleAfterMs);
  }
}

function onTabsChanged(e) {
  const cfg = getConfig();
  if (!cfg.autoDetect) return;
  // Cursor diff views often appear as new tabs with non-file schemes
  for (const tab of e.opened || []) {
    const input = tab.input;
    if (!input) continue;
    // TabInputTextDiff has original/modified URIs
    if (input.original && input.modified) {
      setStatus('needConfirm');
      return;
    }
    const uri = input.uri || input.modified;
    if (uri && /cursor|diff|inline-chat|composer/i.test(uri.scheme || '')) {
      setStatus('needConfirm');
      return;
    }
  }
}

// ---------- Activation ----------

function activate(ctx) {
  context = ctx;

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'trafficLight.reconnect';
  ctx.subscriptions.push(statusBar);
  updateStatusBar();

  // Manual commands
  const reg = (cmd, value, msg) =>
    vscode.commands.registerCommand(cmd, () => {
      setStatus(value);
      if (msg) vscode.window.setStatusBarMessage(msg, 1500);
    });

  ctx.subscriptions.push(
    reg('trafficLight.developing', 'developing', '🟡 Traffic Light: 开发中'),
    reg('trafficLight.needConfirm', 'needConfirm', '🔴🟡 Traffic Light: 需要确认'),
    reg('trafficLight.done', 'done', '🟢 Traffic Light: 完成'),
    reg('trafficLight.idle', 'idle', '⚫ Traffic Light: 空闲'),
    vscode.commands.registerCommand('trafficLight.reconnect', () => {
      try { ws && ws.close(); } catch {}
      connect();
      vscode.window.setStatusBarMessage('Traffic Light: 重新连接挂件…', 1500);
    })
  );

  // Auto detection
  ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(onTextChange));
  if (vscode.window.tabGroups && vscode.window.tabGroups.onDidChangeTabs) {
    ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(onTabsChanged));
  }

  // Re-read config + reconnect when settings change
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((evt) => {
      if (evt.affectsConfiguration('trafficLight.widgetUrl')) {
        try { ws && ws.close(); } catch {}
        connect();
      }
    })
  );

  connect();
}

function deactivate() {
  clearTimeout(reconnectTimer);
  clearTimeout(idleTimer);
  clearTimeout(doneTimer);
  clearTimeout(burstResetTimer);
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}

module.exports = { activate, deactivate };

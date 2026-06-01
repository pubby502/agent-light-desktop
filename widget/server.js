const { WebSocketServer } = require('ws');

const PORT = 17654;
const VALID_STATUSES = new Set([
  'idle', 'thinking', 'busy', 'success', 'error', 'alarm',
]);

function startServer({ onStatus, onConnectionChange }) {
  const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });
  const clients = new Set();

  wss.on('listening', () => {
    console.log(`[traffic-light] WS server listening on ws://127.0.0.1:${PORT}`);
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    onConnectionChange && onConnectionChange(true);
    console.log('[traffic-light] client connected. total =', clients.size);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg && msg.type === 'status' && VALID_STATUSES.has(msg.value)) {
        // 透传 agent 字段（如果 bridge 发送了）
        onStatus && onStatus(msg.value, msg.agent || null);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[traffic-light] client closed. total =', clients.size);
      onConnectionChange && onConnectionChange(clients.size > 0);
    });

    ws.on('error', () => {
      clients.delete(ws);
      onConnectionChange && onConnectionChange(clients.size > 0);
    });
  });

  wss.on('error', (err) => {
    console.error('[traffic-light] WS server error:', err.message);
  });

  return {
    clientCount: () => clients.size,
    close: () => {
      for (const c of clients) {
        try { c.terminate(); } catch {}
      }
      wss.close();
    },
  };
}

module.exports = { startServer, PORT };

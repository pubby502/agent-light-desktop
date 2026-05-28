#!/usr/bin/env node
/**
 * 手动 WS 测试客户端
 *
 * 用法:
 *   node scripts/test-client.js                    # 循环所有 6 个状态
 *   node scripts/test-client.js thinking            # 发送单个状态
 */
const WebSocket = require("ws");

const URL = process.env.WIDGET_URL || "ws://127.0.0.1:17654";
const VALID = ["idle", "thinking", "busy", "success", "error", "alarm"];

const arg = process.argv[2];
const ws = new WebSocket(URL);

ws.on("open", async () => {
  console.log(`Connected to ${URL}`);
  if (arg) {
    if (!VALID.includes(arg)) {
      console.error(`Invalid status "${arg}". Expected: ${VALID.join(", ")}`);
      process.exit(1);
    }
    send(arg);
    setTimeout(() => ws.close(), 200);
  } else {
    for (const v of VALID) {
      send(v);
      await sleep(2500);
    }
    ws.close();
  }
});

ws.on("error", (e) => {
  console.error("WS error:", e.message);
  process.exit(1);
});

function send(value) {
  const msg = JSON.stringify({ type: "status", value });
  ws.send(msg);
  console.log("→", msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

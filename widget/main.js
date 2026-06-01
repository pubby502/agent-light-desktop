const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const WIN_WIDTH = 110;
const WIN_HEIGHT = 280; // 稍高一点给 agent 标签留空间

let mainWindow = null;
let tray = null;
let wsServer = null;
let alwaysOnTop = true;
let currentAgent = 'cursor'; // 当前选中的 Agent

// ── Agent 配置 ────────────────────────────────────────

const AGENTS = {
  cursor: { label: 'Cursor', desc: 'Cursor AI Agent' },
  claude: { label: 'Claude', desc: 'Claude Code Agent' },
};

function getConfigDir() {
  const dir = path.join(app.getPath('userData'), '..', 'agent-traffic-light');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function getConfigPath() {
  return path.join(getConfigDir(), 'agent-config.json');
}

function loadAgentConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const cfg = JSON.parse(raw);
    if (cfg.agent && AGENTS[cfg.agent]) {
      currentAgent = cfg.agent;
    }
  } catch {}
  return currentAgent;
}

function saveAgentConfig(agent) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify({ agent }, null, 2));
  } catch (e) {
    console.error('Failed to save agent config:', e.message);
  }
}

// ── 窗口状态持久化 ────────────────────────────────────

function getStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    const s = JSON.parse(raw);
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) return s;
  } catch {}
  return null;
}

function saveWindowState() {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify({ x, y }));
  } catch (e) {
    console.error('Failed to save window state:', e.message);
  }
}

function defaultPosition() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  return { x: width - WIN_WIDTH - 30, y: height - WIN_HEIGHT - 60 };
}

// ── 窗口 ──────────────────────────────────────────────

function createWindow() {
  const saved = loadWindowState() || defaultPosition();

  mainWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x: saved.x,
    y: saved.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 发送当前 Agent 选择给 renderer
    broadcastAgent(currentAgent);
  });
  mainWindow.on('moved', saveWindowState);
  mainWindow.on('close', saveWindowState);
}

// ── 托盘 ──────────────────────────────────────────────

function buildTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r2 = (size / 2 - 0.5) ** 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= r2) {
        buffer[i] = 0x00;
        buffer[i + 1] = 0xcc;
        buffer[i + 2] = 0xff;
        buffer[i + 3] = 0xff;
      }
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = buildTrayIcon();
  }
  tray = new Tray(icon);
  tray.setToolTip('Agent Traffic Light');

  buildTrayMenu();

  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function buildTrayMenu() {
  // 动态构建 Agent 选择子菜单
  const agentSubmenu = Object.entries(AGENTS).map(([key, info]) => ({
    label: info.label,
    type: 'radio',
    checked: currentAgent === key,
    click: () => switchAgent(key),
  }));

  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏',
      click: () => {
        if (!mainWindow) return;
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      },
    },
    {
      label: '置顶',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked;
        if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
      },
    },
    { type: 'separator' },
    {
      label: '选择 Agent',
      submenu: agentSubmenu,
    },
    { type: 'separator' },
    {
      label: '重置位置',
      click: () => {
        if (!mainWindow) return;
        const { x, y } = defaultPosition();
        mainWindow.setPosition(x, y);
        saveWindowState();
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function switchAgent(agent) {
  if (!AGENTS[agent]) return;
  currentAgent = agent;
  saveAgentConfig(agent);
  broadcastAgent(agent);
  // 重建托盘菜单以更新 radio 选中状态
  if (tray) buildTrayMenu();
  console.log(`[traffic-light] switched to agent: ${agent}`);
}

// ── IPC / 广播 ────────────────────────────────────────

function broadcastStatus(value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', value);
  }
}

function broadcastConnection(connected) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connection-changed', connected);
  }
}

function broadcastAgent(agent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent-changed', agent);
  }
}

// ── 首次启动自动安装 ──────────────────────────────────

function getHooksBridgeSource() {
  // 打包后：extraResources 在 process.resourcesPath 下
  const packaged = path.join(process.resourcesPath, 'hooks-bridge');
  if (fs.existsSync(packaged)) return packaged;

  // 开发模式：项目根目录下
  const dev = path.join(__dirname, '..', 'hooks-bridge');
  if (fs.existsSync(dev)) return dev;

  return null;
}

function copyDirRecursive(src, dest) {
  try { fs.mkdirSync(dest, { recursive: true }); } catch {}
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'state') continue; // 跳过运行时状态目录
      copyDirRecursive(srcPath, destPath);
    } else {
      try { fs.copyFileSync(srcPath, destPath); } catch {}
    }
  }
}

function deepMergeHooks(existing, incoming) {
  const result = {};
  // 保留现有 hooks
  for (const key of Object.keys(existing || {})) {
    result[key] = Array.isArray(existing[key]) ? [...existing[key]] : existing[key];
  }
  // 合并新 hooks（同名事件覆盖）
  for (const key of Object.keys(incoming || {})) {
    result[key] = incoming[key];
  }
  return result;
}

function configureCursorHooks(bridgeDir) {
  const cursorDir = path.join(require('os').homedir(), '.cursor');
  const hooksJsonPath = path.join(cursorDir, 'hooks.json');

  const bridgeScript = path.join(bridgeDir, 'cursor-bridge.js');

  const newHooks = {
    beforeSubmitPrompt: [
      { command: `node "${bridgeScript}" turn-start`, matcher: 'UserPromptSubmit' },
    ],
    preToolUse: [
      { command: `node "${bridgeScript}" await-user`, matcher: 'AskQuestion' },
      { command: `node "${bridgeScript}" busy` },
    ],
    postToolUse: [
      { command: `node "${bridgeScript}" plan-created`, matcher: 'CreatePlan' },
    ],
    postToolUseFailure: [
      { command: `node "${bridgeScript}" denied` },
    ],
    afterAgentResponse: [
      { command: `node "${bridgeScript}" plan-detect`, matcher: 'AgentResponse' },
    ],
    afterFileEdit: [
      { command: `node "${bridgeScript}" plan-file` },
    ],
    stop: [
      { command: `node "${bridgeScript}" stop`, matcher: 'Stop' },
    ],
    sessionEnd: [
      { command: `node "${bridgeScript}" idle` },
    ],
  };

  try { fs.mkdirSync(cursorDir, { recursive: true }); } catch {}

  let finalHooks = {};
  if (fs.existsSync(hooksJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));
      const existingHooks = existing.hooks || {};
      // 检查是否已有 traffic-light hooks
      const hasExisting = JSON.stringify(existingHooks).includes('cursor-bridge.js');
      if (hasExisting) {
        console.log('[traffic-light] Cursor hooks already configured, skipping');
        return;
      }
      // 备份 + 合并
      const backup = hooksJsonPath + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
      try { fs.copyFileSync(hooksJsonPath, backup); } catch {}
      finalHooks = deepMergeHooks(existingHooks, newHooks);
    } catch {
      finalHooks = newHooks;
    }
  } else {
    finalHooks = newHooks;
  }

  const config = { version: 2, hooks: finalHooks };
  try {
    fs.writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2));
    console.log('[traffic-light] Cursor hooks configured:', hooksJsonPath);
  } catch (e) {
    console.error('[traffic-light] Failed to configure Cursor hooks:', e.message);
  }
}

function configureClaudeHooks(bridgeDir) {
  const claudeDir = path.join(require('os').homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const bridgeScript = path.join(bridgeDir, 'claude-bridge.js');

  const newHooks = {
    UserPromptSubmit: [
      { matcher: '', hooks: [{ type: 'command', command: `node "${bridgeScript}" turn-start`, timeout: 10 }] },
    ],
    PreToolUse: [
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: `node "${bridgeScript}" await-user`, timeout: 10 }] },
      { matcher: '', hooks: [{ type: 'command', command: `node "${bridgeScript}" busy`, timeout: 10 }] },
    ],
    PostToolUse: [
      { matcher: 'CreatePlan', hooks: [{ type: 'command', command: `node "${bridgeScript}" plan-created`, timeout: 10 }] },
    ],
    PostToolUseFailure: [
      { matcher: '', hooks: [{ type: 'command', command: `node "${bridgeScript}" denied`, timeout: 10 }] },
    ],
    Stop: [
      { matcher: '', hooks: [{ type: 'command', command: `node "${bridgeScript}" stop`, timeout: 10 }] },
    ],
    SessionEnd: [
      { matcher: '', hooks: [{ type: 'command', command: `node "${bridgeScript}" idle`, timeout: 10 }] },
    ],
  };

  try { fs.mkdirSync(claudeDir, { recursive: true }); } catch {}

  let mergedSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      // 保留其他设置（env, permissions, theme 等）
      for (const key of Object.keys(existing)) {
        if (key !== 'hooks') mergedSettings[key] = existing[key];
      }
      const existingHooks = existing.hooks || {};
      const hasExisting = JSON.stringify(existingHooks).includes('claude-bridge.js');
      if (hasExisting) {
        console.log('[traffic-light] Claude hooks already configured, skipping');
        return;
      }
      const backup = settingsPath + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
      try { fs.copyFileSync(settingsPath, backup); } catch {}
      mergedSettings.hooks = deepMergeHooks(existingHooks, newHooks);
    } catch {
      mergedSettings.hooks = newHooks;
    }
  } else {
    mergedSettings.hooks = newHooks;
  }

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    console.log('[traffic-light] Claude hooks configured:', settingsPath);
  } catch (e) {
    console.error('[traffic-light] Failed to configure Claude hooks:', e.message);
  }
}

function autoSetup() {
  const configDir = getConfigDir();
  const markerPath = path.join(configDir, '.installed');

  if (fs.existsSync(markerPath)) {
    console.log('[traffic-light] already installed, skipping auto-setup');
    return;
  }

  console.log('[traffic-light] first run — auto-installing hooks-bridge...');

  const source = getHooksBridgeSource();
  if (!source) {
    console.log('[traffic-light] hooks-bridge source not found, skipping auto-setup');
    return;
  }

  const targetDir = path.join(configDir, 'hooks-bridge');
  copyDirRecursive(source, targetDir);
  console.log('[traffic-light] hooks-bridge copied to:', targetDir);

  // ws 依赖已随 extraResources 打包，无需 npm install

  // 配置各 Agent hooks
  configureCursorHooks(targetDir);
  configureClaudeHooks(targetDir);

  // 写入安装标记
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      installedAt: new Date().toISOString(),
      version: '2.0',
      bridgeDir: targetDir,
    }));
    console.log('[traffic-light] auto-setup complete');
  } catch (e) {
    console.error('[traffic-light] failed to write install marker:', e.message);
  }
}

// ── 安装路径持久化（供外部脚本查找 hooks-bridge） ──

function writeInstallPathConfig() {
  const configDir = getConfigDir();

  // hooks-bridge 路径：优先检查 configDir 下是否有
  const packagedBridgePath = path.join(configDir, 'hooks-bridge');
  const devBridgePath = path.join(__dirname, '..', 'hooks-bridge');

  let bridgePath;
  if (fs.existsSync(packagedBridgePath)) {
    bridgePath = packagedBridgePath;
  } else if (fs.existsSync(devBridgePath)) {
    bridgePath = devBridgePath;
  } else {
    bridgePath = packagedBridgePath; // 记录期望路径
  }

  const installConfig = {
    hooksBridge: bridgePath,
    version: '2.0',
    installedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(
      path.join(configDir, 'install-path.json'),
      JSON.stringify(installConfig, null, 2)
    );
    console.log('[traffic-light] install-path written:', bridgePath);
  } catch (e) {
    console.error('[traffic-light] failed to write install-path:', e.message);
  }
}

// ── 启动 ──────────────────────────────────────────────

app.whenReady().then(() => {
  loadAgentConfig();
  autoSetup();                // 首次启动自动安装 hooks
  writeInstallPathConfig();   // 写入安装路径
  createWindow();
  createTray();

  const { startServer } = require('./server');
  wsServer = startServer({
    onStatus: (value, agent) => {
      // 可选：过滤非当前 Agent 的状态
      // if (agent && agent !== currentAgent) return;
      broadcastStatus(value);
    },
    onConnectionChange: broadcastConnection,
  });

  ipcMain.handle('get-initial', () => ({
    connected: wsServer && wsServer.clientCount() > 0,
    agent: currentAgent,
  }));

  ipcMain.handle('get-agent', () => currentAgent);
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  saveWindowState();
  if (wsServer) wsServer.close();
});

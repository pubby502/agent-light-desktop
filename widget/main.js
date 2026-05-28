const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');

const WIN_WIDTH = 110;
const WIN_HEIGHT = 260;

let mainWindow = null;
let tray = null;
let wsServer = null;
let alwaysOnTop = true;

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

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('moved', saveWindowState);
  mainWindow.on('close', saveWindowState);
}

function buildTrayIcon() {
  // 16x16 yellow circle on transparent background, generated as BGRA bitmap.
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
        buffer[i] = 0x00;     // B
        buffer[i + 1] = 0xcc; // G
        buffer[i + 2] = 0xff; // R
        buffer[i + 3] = 0xff; // A
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
  tray.setToolTip('Cursor Traffic Light');

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
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

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

app.whenReady().then(() => {
  createWindow();
  createTray();

  wsServer = startServer({
    onStatus: broadcastStatus,
    onConnectionChange: broadcastConnection,
  });

  // Renderer asks for current state on load
  ipcMain.handle('get-initial', () => ({
    connected: wsServer && wsServer.clientCount() > 0,
  }));
});

app.on('window-all-closed', () => {
  // Keep app alive in tray
});

app.on('before-quit', () => {
  saveWindowState();
  if (wsServer) wsServer.close();
});

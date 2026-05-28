const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, value) => cb(value)),
  onConnectionChanged: (cb) => ipcRenderer.on('connection-changed', (_e, value) => cb(value)),
  getInitial: () => ipcRenderer.invoke('get-initial'),
});

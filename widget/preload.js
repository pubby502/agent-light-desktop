const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, value) => cb(value)),
  onConnectionChanged: (cb) => ipcRenderer.on('connection-changed', (_e, value) => cb(value)),
  onAgentChanged: (cb) => ipcRenderer.on('agent-changed', (_e, agent) => cb(agent)),
  getInitial: () => ipcRenderer.invoke('get-initial'),
  getAgent: () => ipcRenderer.invoke('get-agent'),
});

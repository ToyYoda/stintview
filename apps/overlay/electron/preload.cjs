const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stintview', {
  // Overlay widgets
  getConfig: () => ipcRenderer.invoke('get-config'),
  onEditMode: (cb) => ipcRenderer.on('edit-mode', (_e, on, hotkey) => cb(on, hotkey)),
  setEditMode: (on) => ipcRenderer.invoke('app:edit', on),
  // Setup window
  getState: () => ipcRenderer.invoke('app:state'),
  onState: (cb) => ipcRenderer.on('app-state', (_e, state) => cb(state)),
  join: (data) => ipcRenderer.invoke('app:join', data),
  create: (data) => ipcRenderer.invoke('app:create', data),
  updateSettings: (patch) => ipcRenderer.invoke('app:settings', patch),
  leave: () => ipcRenderer.invoke('app:leave'),
});

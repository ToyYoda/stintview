const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stintview', {
  // Overlay widgets
  getConfig: () => ipcRenderer.invoke('get-config'),
  onEditMode: (cb) => ipcRenderer.on('edit-mode', (_e, on, hotkey) => cb(on, hotkey)),
  setEditMode: (on) => ipcRenderer.invoke('app:edit', on),
  // Clickable buttons in the otherwise click-through overlay
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', on),
  onPanels: (cb) => ipcRenderer.on('panels', (_e, ids) => cb(ids)),
  // Spectator camera
  setTeamCar: (team) => ipcRenderer.send('app:team-car', team),
  camera: (action) => ipcRenderer.invoke('app:camera', action),
  getCameraInfo: () => ipcRenderer.invoke('app:camera-info'),
  onCamera: (cb) => ipcRenderer.on('camera', (_e, m) => cb(m)),
  // Setup window
  getState: () => ipcRenderer.invoke('app:state'),
  onState: (cb) => ipcRenderer.on('app-state', (_e, state) => cb(state)),
  join: (data) => ipcRenderer.invoke('app:join', data),
  create: (data) => ipcRenderer.invoke('app:create', data),
  updateSettings: (patch) => ipcRenderer.invoke('app:settings', patch),
  leave: () => ipcRenderer.invoke('app:leave'),
});

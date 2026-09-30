const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stintview', {
  // Overlay widgets
  getConfig: () => ipcRenderer.invoke('get-config'),
  onEditMode: (cb) => ipcRenderer.on('edit-mode', (_e, on, hotkey) => cb(on, hotkey)),
  setEditMode: (on) => ipcRenderer.invoke('app:edit', on),
  // Clickable buttons in the otherwise click-through overlay
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', on),
  onPanels: (cb) => ipcRenderer.on('panels', (_e, ids) => cb(ids)),
  // Panel background opacity 0–1 (monitor overlay and VR panels have their own value)
  onOpacity: (cb) => ipcRenderer.on('opacity', (_e, v) => cb(v)),
  // Spectator camera
  setTeamCar: (team) => ipcRenderer.send('app:team-car', team),
  setHazard: (carIdx) => ipcRenderer.send('app:hazard', carIdx),
  camera: (action, targetCarIdx) => ipcRenderer.invoke('app:camera', action, targetCarIdx),
  getCameraInfo: () => ipcRenderer.invoke('app:camera-info'),
  onCamera: (cb) => ipcRenderer.on('camera', (_e, m) => cb(m)),
  // Setup window
  getState: () => ipcRenderer.invoke('app:state'),
  onState: (cb) => ipcRenderer.on('app-state', (_e, state) => cb(state)),
  join: (data) => ipcRenderer.invoke('app:join', data),
  create: (data) => ipcRenderer.invoke('app:create', data),
  updateSettings: (patch) => ipcRenderer.invoke('app:settings', patch),
  leave: () => ipcRenderer.invoke('app:leave'),
  checkUpdate: () => ipcRenderer.invoke('app:update-check'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  pitImport: (choose) => ipcRenderer.invoke('app:pit-import', choose),
});

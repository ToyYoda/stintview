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
  // Size factor and options per panel
  onPanelConfig: (cb) => ipcRenderer.on('panel-config', (_e, cfg) => cb(cfg)),
  // UI language ('de' | 'en')
  onLanguage: (cb) => ipcRenderer.on('language', (_e, l) => cb(l)),
  // This PC's own telemetry (displays without a team server): live messages, latest per type
  onLocal: (cb) => ipcRenderer.on('local', (_e, m) => cb(m)),
  getLocalSnapshot: () => ipcRenderer.invoke('local:snapshot'),
  // Spectator camera
  setTeamCar: (team) => ipcRenderer.send('app:team-car', team),
  setHazard: (carIdx) => ipcRenderer.send('app:hazard', carIdx),
  camera: (action, targetCarIdx) => ipcRenderer.invoke('app:camera', action, targetCarIdx),
  getCameraInfo: () => ipcRenderer.invoke('app:camera-info'),
  onCamera: (cb) => ipcRenderer.on('camera', (_e, m) => cb(m)),
  // Team messages: send one (id from the list, or { text, color }), list + hotkeys + whether you drive
  sendMessage: (what) => ipcRenderer.invoke('app:send-message', what),
  getRadio: () => ipcRenderer.invoke('app:radio'),
  onRadio: (cb) => ipcRenderer.on('radio', (_e, state) => cb(state)),
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

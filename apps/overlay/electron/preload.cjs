const { contextBridge, ipcRenderer } = require('electron');

// Settings the app sends a page once when it has loaded (edit mode, opacity, panel config,
// language, profile, â€¦): React registers its callbacks only after rendering, which can be after
// that â€“ the value was lost and the panel kept the default (e.g. opacity) until the next change.
// So the latest value per channel is kept here and handed to a callback registered later.
const latest = new Map();
const callbacks = new Map();
for (const channel of ['edit-mode', 'panels', 'overlay-area', 'opacity', 'panel-config', 'profile', 'language']) {
  callbacks.set(channel, []);
  ipcRenderer.on(channel, (_e, ...args) => {
    latest.set(channel, args);
    for (const cb of callbacks.get(channel)) cb(...args);
  });
}
function onSetting(channel, cb) {
  callbacks.get(channel).push(cb);
  if (latest.has(channel)) cb(...latest.get(channel));
}

contextBridge.exposeInMainWorld('stintview', {
  // Overlay widgets
  getConfig: () => ipcRenderer.invoke('get-config'),
  onEditMode: (cb) => onSetting('edit-mode', (on, hotkey) => cb(on, hotkey)),
  setEditMode: (on, profile) => ipcRenderer.invoke('app:edit', on, profile),
  // Clickable buttons in the otherwise click-through overlay
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', on),
  // Monitor overlay: one window per panel (since 0.24) â€“ the page reports its size; positions kept
  // in the page up to 0.23 are handed to the app once
  reportSize: (w, h) => ipcRenderer.send('overlay:size', w, h),
  sendLegacyPositions: (saved) => ipcRenderer.send('overlay:legacy-positions', saved),
  onPanels: (cb) => onSetting('panels', (ids) => cb(ids)),
  // Where the main monitor lies in the overlay window, which covers all monitors
  onOverlayArea: (cb) => onSetting('overlay-area', (main) => cb(main)),
  // Panel background opacity 0â€“1 (monitor overlay and VR panels have their own value)
  onOpacity: (cb) => onSetting('opacity', (v) => cb(v)),
  // Size factor and options per panel
  onPanelConfig: (cb) => onSetting('panel-config', (cfg) => cb(cfg)),
  // Profile shown on the monitor overlay ('driving' | 'watching'): positions are kept per profile
  onProfile: (cb) => onSetting('profile', (p) => cb(p)),
  // Panel size in percent, from the corner handle in edit mode (same setting as in the window)
  setPanelSize: (id, size) => ipcRenderer.invoke('app:panel-size', id, size),
  // UI language ('de' | 'en')
  onLanguage: (cb) => onSetting('language', (l) => cb(l)),
  // Display data (since 0.25 one connection in the app): subscribe with the telemetry types the
  // panel shows (null = all) â€“ resolves with everything so far; then the team relay's messages
  // and this PC's own recorder's (displays without a team server), only those types
  subscribeFeed: (types) => ipcRenderer.invoke('feed:subscribe', types),
  onFeed: (cb) => ipcRenderer.on('feed', (_e, m) => cb(m)),
  onLocal: (cb) => ipcRenderer.on('local', (_e, m) => cb(m)),
  // true while the team streams another iRacing session: show this PC's own data
  onLocalPrefer: (cb) => ipcRenderer.on('local-prefer', (_e, on) => cb(on)),
  // Team messages through this PC's recorder (arrive before the page's own connection)
  onTeamMessage: (cb) => ipcRenderer.on('team-message', (_e, m) => cb(m)),
  // Spectator camera
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
  // VR recenter coupled to iRacing: learn the key/button (resolves after the press, Esc or 20 s)
  recenterLearn: () => ipcRenderer.invoke('app:recenter-learn'),
  recenterCancel: () => ipcRenderer.invoke('app:recenter-cancel'),
  leave: () => ipcRenderer.invoke('app:leave'),
  checkUpdate: () => ipcRenderer.invoke('app:update-check'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  pitImport: (choose) => ipcRenderer.invoke('app:pit-import', choose),
  // Stint planner: lap times from the .ibt archive; open the page (resolves { error })
  lapImport: (choose) => ipcRenderer.invoke('app:lap-import', choose),
  openPlanner: () => ipcRenderer.invoke('app:planner-open'),
});

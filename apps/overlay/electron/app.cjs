// StintView desktop app: tray icon, setup window, and the background pieces –
// recorder (always), desktop overlay / VR panels (per setting) and optionally the team relay.
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, utilityProcess } = require('electron');
const { createWriteStream, mkdirSync } = require('node:fs');
const path = require('node:path');
const {
  cleanOpacity, cleanPanels, cleanPitStop, clearConfig, configPath, dataDir, loadConfig, loadSettings, logDir, normalizeUrl, panelsFor, register, saveSettings,
} = require('./config.cjs');
const {
  editHotkey, editing, onOverlayChange, overlayRunning, editHotkeyInfo, setEditMode, setOverlayOpacity, setOverlayPanels, startOverlay, stopOverlay, toggleEdit,
} = require('./overlay-window.cjs');
const { PRELOAD, loadRoute } = require('./renderer.cjs');
const { cameraCommand, cameraHotkeyInfo, cameraInfo, onRecorderMessage, setHazardCar, setTeamCar, startCamera, stopCamera } = require('./camera.cjs');
const { recenterVr, setVrOpacity, startVr, stopVr, vrHotkeyInfo, vrStatus } = require('./vr.cjs');
const { hotkeyGroups } = require('./hotkeys.cjs');
const { checkNow, installNow, setupUpdates, updateInfo, updateLabel } = require('./updates.cjs');

const BUNDLES = path.join(__dirname, '..', 'dist-bundles');
const ICON = path.join(__dirname, 'icons', 'tray.png');
const RESTART_MS = 5000;

// A separate profile (tests, second profile) also needs its own Chromium data and instance lock.
if (process.env.STINTVIEW_HOME) app.setPath('userData', path.join(dataDir, 'electron'));

if (!app.requestSingleInstanceLock()) {
  // Already running: the first instance opens its window (see 'second-instance').
  app.quit();
  return; // CommonJS module scope
}
app.setAppUserModelId('com.outcastendurance.stintview');
// All rendering is simple 2D; keep the GPU for the sim (also what the VR panels were tested with).
app.disableHardwareAcceleration();

let settings = loadSettings();
let tray = null;
let setupWin = null;
let quitting = false;

/** What the tray and the setup window show. */
const status = {
  iracing: false,
  server: 'offline', // 'offline' | 'connected' | 'standby' | 'error'
  serverText: '',
  inCar: false,
  relay: 'off', // 'off' | 'running' | 'error'
};

// ---------------------------------------------------------------------------
// Background processes (recorder, relay)
// ---------------------------------------------------------------------------

/** A utility process that is restarted when it exits unexpectedly; output goes to a log file. */
function supervise(name, file, args, env, onMessage) {
  const state = { proc: null, timer: null, stopped: false };
  mkdirSync(logDir, { recursive: true });
  const logFile = createWriteStream(path.join(logDir, `${name}.log`), { flags: 'a' });

  const start = () => {
    if (state.stopped || quitting) return;
    const proc = utilityProcess.fork(path.join(BUNDLES, file), args, {
      serviceName: `StintView ${name}`,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
    state.proc = proc;
    const stamp = () => new Date().toISOString();
    proc.stdout?.on('data', (d) => logFile.write(`${stamp()} ${d}`));
    proc.stderr?.on('data', (d) => logFile.write(`${stamp()} [err] ${d}`));
    proc.on('message', onMessage);
    proc.on('exit', (code) => {
      state.proc = null;
      logFile.write(`${stamp()} exited with code ${code}\n`);
      onMessage({ t: 'exit', code });
      if (!state.stopped && !quitting) state.timer = setTimeout(start, RESTART_MS);
    });
  };
  start();
  return {
    /** Sends a message to the running process; false if it isn't running. */
    post(msg) {
      if (!state.proc) return false;
      state.proc.postMessage(msg);
      return true;
    },
    stop() {
      state.stopped = true;
      clearTimeout(state.timer);
      state.proc?.kill();
      logFile.end();
    },
  };
}

let recorder = null;
let relay = null;
let runningVrPanels = '';

function startRecorder() {
  recorder?.stop();
  if (!loadConfig()) return;
  let needsPitSettings = true;
  recorder = supervise('recorder', 'recorder.cjs', ['run'], { STINTVIEW_CONFIG: configPath() }, (m) => {
    // (Re)started process: hand it the manual pit stop values with its first message.
    if (m.t === 'exit') needsPitSettings = true;
    else if (needsPitSettings && recorder?.post({ t: 'pit-settings', pit: settings.pitStop })) needsPitSettings = false;
    if (m.t === 'iracing') status.iracing = m.connected;
    if (m.t === 'car') status.inCar = m.inCar;
    if (m.t === 'server') {
      status.serverText = m.text;
      status.server = m.text.startsWith('standby') ? 'standby'
        : m.connected ? 'connected'
          : m.text.startsWith('server error') ? 'error' : 'offline';
    }
    if (m.t === 'exit') Object.assign(status, { iracing: false, inCar: false, server: 'offline' });
    if (m.t === 'camera-state' || m.t === 'camera-result') return onRecorderMessage(m);
    refresh();
  });
}

function startRelay() {
  if (relay) return;
  const env = { PORT: String(settings.serverPort), STINTVIEW_DATA: path.join(dataDir, 'server', 'teams.json') };
  relay = supervise('server', 'server.cjs', [], env, (m) => {
    status.relay = m.t === 'exit' ? 'error' : status.relay;
    refresh();
  });
  status.relay = 'running';
}

function stopRelay() {
  relay?.stop();
  relay = null;
  status.relay = 'off';
}

async function waitForRelay() {
  const url = `http://localhost:${settings.serverPort}/health`;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Der Team-Server auf diesem PC startet nicht (Port belegt?)');
}

// ---------------------------------------------------------------------------
// Settings -> running pieces
// ---------------------------------------------------------------------------

function applySettings() {
  const configured = Boolean(loadConfig());
  if (settings.server) startRelay(); else stopRelay();
  setOverlayPanels(panelsFor(settings, 'monitor'));
  setOverlayOpacity(settings.opacity.monitor / 100);
  setVrOpacity(settings.opacity.vr / 100);
  recorder?.post({ t: 'pit-settings', pit: settings.pitStop });
  if (configured && settings.overlay) startOverlay(); else stopOverlay();
  // VR panels are separate windows: restart the VR host when the selection changes.
  const vrPanels = panelsFor(settings, 'vr');
  if (configured && settings.vr) {
    if (vrStatus() !== 'off' && vrPanels.join() !== runningVrPanels) stopVr();
    runningVrPanels = vrPanels.join();
    startVr(refresh, vrPanels).catch((e) => console.error('[vr]', e));
  } else {
    stopVr();
  }
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ['--hidden'] });
  refresh();
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  applySettings();
}

// ---------------------------------------------------------------------------
// Tray and setup window
// ---------------------------------------------------------------------------

function statusLine() {
  const config = loadConfig();
  if (!config) return 'Nicht eingerichtet';
  if (status.server === 'error') return `Server: ${status.serverText.replace(/^server error: /, '')}`;
  if (status.server === 'offline') return 'Keine Verbindung zum Team-Server';
  if (!status.iracing) return `${config.teamName} · iRacing nicht aktiv`;
  if (status.inCar) return status.server === 'standby' ? `${config.teamName} · im Auto, Standby` : `${config.teamName} · du fährst – sendet`;
  return `${config.teamName} · bereit`;
}

function refresh() {
  if (tray) {
    tray.setToolTip(`StintView – ${statusLine()}`);
    tray.setContextMenu(buildMenu());
  }
  if (setupWin && !setupWin.isDestroyed()) setupWin.webContents.send('app-state', appState());
}

function buildMenu() {
  const configured = Boolean(loadConfig());
  const vr = vrStatus();
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    updateMenuItem(),
    { type: 'separator' },
    { label: 'Overlay am Monitor', type: 'checkbox', checked: settings.overlay, enabled: configured, click: (i) => updateSettings({ overlay: i.checked }) },
    {
      label: `Anzeigen verschieben${editHotkey() ? ` (${editHotkey()})` : ''}`,
      type: 'checkbox', checked: editing(), enabled: overlayRunning(), click: toggleEdit,
    },
    {
      label: `VR-Overlay (SteamVR)${vr === 'waiting' ? ' – wartet auf SteamVR' : ''}`,
      type: 'checkbox', checked: settings.vr, enabled: configured, click: (i) => updateSettings({ vr: i.checked }),
    },
    { label: 'VR-Ausrichtung zurücksetzen (Strg+Umschalt+R)', enabled: vr === 'connected', click: recenterVr },
    { type: 'separator' },
    { label: 'Einstellungen …', click: () => openSetup() },
    { label: 'Tastaturkürzel …', click: () => openSetup('/setup/keys') },
    { label: 'Mit Windows starten', type: 'checkbox', checked: settings.autostart, enabled: app.isPackaged, click: (i) => updateSettings({ autostart: i.checked }) },
    { label: `Team-Server auf diesem PC (Port ${settings.serverPort})`, type: 'checkbox', checked: settings.server, click: (i) => updateSettings({ server: i.checked }) },
    { label: 'Protokolle öffnen', click: () => shell.openPath(logDir) },
    { type: 'separator' },
    { label: 'StintView beenden', click: () => app.quit() },
  ]);
}

function updateMenuItem() {
  const u = updateInfo();
  if (u.phase === 'ready') return { label: updateLabel(), click: installNow };
  return { label: updateLabel(), enabled: u.phase !== 'unavailable' && u.phase !== 'checking' && u.phase !== 'downloading', click: checkNow };
}

/** `route` '/setup/keys' opens the window scrolled to the hotkey overview. */
function openSetup(route = '/setup') {
  if (setupWin && !setupWin.isDestroyed()) {
    if (route !== '/setup') loadRoute(setupWin, route);
    setupWin.show();
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    title: 'StintView',
    icon: ICON,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  setupWin.on('closed', () => { setupWin = null; });
  loadRoute(setupWin, route);
}

function appState() {
  const config = loadConfig();
  return {
    version: app.getVersion(),
    configured: Boolean(config),
    team: config ? { teamName: config.teamName, memberName: config.memberName, serverUrl: config.serverUrl, inviteCode: config.inviteCode } : null,
    settings,
    status: { ...status, line: statusLine(), vr: vrStatus(), overlay: overlayRunning(), editing: editing(), editHotkey: editHotkey() },
    autostartAvailable: app.isPackaged,
    cameraHotkeys: cameraInfo().hotkeys,
    hotkeys: (() => {
      const cam = cameraHotkeyInfo();
      return hotkeyGroups(editHotkeyInfo(), cam.keys, cam.candidates, vrHotkeyInfo(), { overlay: overlayRunning() });
    })(),
    update: { ...updateInfo(), label: updateLabel() },
  };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('get-config', () => {
  const c = loadConfig();
  return c ? { serverUrl: c.serverUrl, token: c.token, teamName: c.teamName, memberName: c.memberName } : null;
});

ipcMain.handle('app:state', () => appState());

ipcMain.handle('app:join', async (_e, { serverUrl, inviteCode, memberName }) => {
  await register(serverUrl, 'join', { inviteCode: String(inviteCode ?? '').trim(), memberName: String(memberName ?? '').trim() });
  startRecorder();
  applySettings();
  return appState();
});

ipcMain.handle('app:create', async (_e, { serverUrl, teamName, memberName, hostHere }) => {
  if (hostHere) {
    updateSettings({ server: true });
    await waitForRelay();
  }
  const url = hostHere ? `http://localhost:${settings.serverPort}` : normalizeUrl(serverUrl);
  await register(url, 'create', { teamName: String(teamName ?? '').trim(), memberName: String(memberName ?? '').trim() });
  startRecorder();
  applySettings();
  return appState();
});

ipcMain.handle('app:settings', (_e, patch) => {
  const allowed = ['overlay', 'vr', 'autostart', 'server', 'panels', 'opacity', 'pitStop'];
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)));
  if (clean.panels) clean.panels = cleanPanels(clean.panels);
  if (clean.opacity) clean.opacity = cleanOpacity({ ...settings.opacity, ...clean.opacity });
  if (clean.pitStop) clean.pitStop = cleanPitStop({ ...settings.pitStop, ...clean.pitStop });
  updateSettings(clean);
  return appState();
});

/** Edit mode of the desktop overlay (drag widgets); on = undefined toggles. */
ipcMain.handle('app:edit', (_e, on) => {
  if (on === undefined) toggleEdit(); else setEditMode(on);
  return appState();
});

// Spectator camera: renderers report the team car and trigger jumps (same as the hotkeys).
ipcMain.on('app:team-car', (_e, team) => setTeamCar(team));
ipcMain.on('app:hazard', (_e, carIdx) => setHazardCar(Number.isInteger(carIdx) ? carIdx : null));
ipcMain.handle('app:camera', (_e, action, target) =>
  cameraCommand(action === 'back' ? 'back' : 'incident', Number.isInteger(target) ? target : undefined));
ipcMain.handle('app:camera-info', () => cameraInfo());

ipcMain.handle('app:leave', async () => {
  const { response } = await dialog.showMessageBox(setupWin ?? undefined, {
    type: 'question',
    buttons: ['Abbrechen', 'Team verlassen'],
    defaultId: 0,
    cancelId: 0,
    message: 'Team auf diesem PC verlassen?',
    detail: 'StintView sendet dann keine Daten mehr an dein Team. Zum erneuten Beitreten brauchst du einen Einladungscode.',
  });
  if (response !== 1) return appState();
  recorder?.stop();
  recorder = null;
  clearConfig();
  Object.assign(status, { iracing: false, inCar: false, server: 'offline', serverText: '' });
  applySettings();
  return appState();
});

// Updates: button in tray and window instead of "restart twice".
ipcMain.handle('app:update-check', () => { checkNow(); return appState(); });
ipcMain.handle('app:update-install', () => installNow());

let announced = '';
function onUpdateChange(u) {
  // Tell the user once per version, even if the window is closed.
  if (u.phase === 'ready' && announced !== u.version && tray) {
    announced = u.version;
    tray.displayBalloon({
      title: `StintView ${u.version} ist bereit`,
      content: 'Rechtsklick auf das StintView-Symbol → „Update installieren und neu starten“.',
      iconType: 'info',
    });
  }
  refresh();
}

// ---------------------------------------------------------------------------

app.on('second-instance', openSetup);

app.whenReady().then(() => {
  onOverlayChange(() => refresh());
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.on('click', openSetup);
  startRecorder();
  startCamera((msg) => recorder?.post(msg) ?? false);
  applySettings();
  setupUpdates(onUpdateChange);
  // First run (or started manually): show the window. Autostart passes --hidden.
  if (!loadConfig() || !process.argv.includes('--hidden')) openSetup();
});

// A tray app keeps running without windows.
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  quitting = true;
  recorder?.stop();
  stopCamera();
  stopRelay();
  stopVr();
  stopOverlay();
});

// StintView desktop app: tray icon, setup window, and the background pieces –
// recorder (always), desktop overlay / VR panels (per setting) and optionally the team relay.
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, utilityProcess } = require('electron');
const { createWriteStream, mkdirSync, readdirSync } = require('node:fs');
const path = require('node:path');
const {
  cleanLanguage, cleanOpacity, cleanOutput, cleanPanels, cleanPitStop, clearConfig, configPath, dataDir, loadConfig, loadSettings, logDir, normalizeUrl, panelConfig, panelsFor, register, saveSettings,
} = require('./config.cjs');
const {
  editHotkey, editing, onOverlayChange, overlayRunning, editHotkeyInfo, setEditMode, setOverlayLanguage, setOverlayOpacity, setOverlayPanelConfig, setOverlayPanels, startOverlay, stopOverlay, toggleEdit,
} = require('./overlay-window.cjs');
const { PRELOAD, loadRoute } = require('./renderer.cjs');
const { cameraCommand, cameraHotkeyInfo, cameraInfo, onRecorderMessage, setHazardCar, setTeamCar, startCamera, stopCamera } = require('./camera.cjs');
const { recenterVr, setVrLanguage, setVrOpacity, setVrPanelConfig, startVr, stopVr, vrHotkeyInfo, vrStatus } = require('./vr.cjs');
const { hotkeyGroups } = require('./hotkeys.cjs');
const { checkNow, installNow, setupUpdates, updateInfo, updateLabel } = require('./updates.cjs');
const { setLanguage, t } = require('./i18n.cjs');

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
setLanguage(settings.language);
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

// ---------------------------------------------------------------------------
// "Boxengassen-Zeiten einlesen": pit lane losses from the local .ibt archive
// ---------------------------------------------------------------------------

let pitImport = { running: false, finished: false, done: 0, total: 0, passes: 0, tracks: 0, folder: null, error: null };

const hasIbt = (dir) => {
  try {
    return readdirSync(dir).some((n) => n.toLowerCase().endsWith('.ibt'));
  } catch {
    return false;
  }
};

/** Runs `recorder.cjs import-pitlane <dir>` as a separate process; `choose` asks for the folder. */
async function startPitImport(choose) {
  if (pitImport.running) return;
  let dir = settings.telemetryDir ?? path.join(app.getPath('documents'), 'iRacing', 'telemetry');
  if (choose || !hasIbt(dir)) {
    const r = await dialog.showOpenDialog(setupWin ?? undefined, {
      title: t('import.chooseFolder'), defaultPath: dir, properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return;
    dir = r.filePaths[0];
    if (!hasIbt(dir)) {
      pitImport = { ...pitImport, finished: true, folder: dir, error: t('import.noIbt') };
      return refresh();
    }
    settings = { ...settings, telemetryDir: dir };
    saveSettings(settings);
  }
  pitImport = { running: true, finished: false, done: 0, total: 0, passes: 0, tracks: 0, folder: dir, error: null };
  const proc = utilityProcess.fork(path.join(BUNDLES, 'recorder.cjs'), ['import-pitlane', dir], {
    serviceName: 'StintView Boxengassen-Import', stdio: 'pipe', env: { ...process.env, STINTVIEW_CONFIG: configPath() },
  });
  proc.stdout?.on('data', (d) => console.log(`[pit-import] ${String(d).trim()}`));
  proc.stderr?.on('data', (d) => console.error(`[pit-import] ${String(d).trim()}`));
  proc.on('message', (m) => {
    if (m.t !== 'pit-import') return;
    pitImport = { ...pitImport, ...m, running: !m.finished };
    // The live recorder keeps the learned values in memory: tell it to read the file again.
    if (m.finished && !m.error) recorder?.post({ t: 'pit-model-reload' });
    refresh();
  });
  proc.on('exit', (code) => {
    if (!pitImport.running) return;
    pitImport = { ...pitImport, running: false, finished: true, error: t('import.aborted', { code }) };
    refresh();
  });
  refresh();
}
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
  throw new Error(t('relay.noStart'));
}

// ---------------------------------------------------------------------------
// Settings -> running pieces
// ---------------------------------------------------------------------------

function applySettings() {
  const configured = Boolean(loadConfig());
  if (settings.server) startRelay(); else stopRelay();
  setLanguage(settings.language);
  setOverlayLanguage(settings.language);
  setVrLanguage(settings.language);
  const shown = panelsFor(settings);
  setOverlayPanels(shown);
  setOverlayPanelConfig(panelConfig(settings));
  setOverlayOpacity(settings.opacity / 100);
  setVrPanelConfig(panelConfig(settings));
  setVrOpacity(settings.opacity / 100);
  recorder?.post({ t: 'pit-settings', pit: settings.pitStop });
  // One output at a time: the monitor overlay or the VR panels.
  if (configured && settings.overlay && settings.output === 'monitor') startOverlay(); else stopOverlay();
  // VR panels are separate windows: restart the VR host when the selection changes.
  const vrPanels = shown;
  if (configured && settings.overlay && settings.output === 'vr') {
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
  if (!config) return t('status.notSetUp');
  if (status.server === 'error') return t('status.server', { text: status.serverText.replace(/^server error: /, '') });
  if (status.server === 'offline') return t('status.offline');
  const team = config.teamName;
  if (!status.iracing) return t('status.noIracing', { team });
  if (status.inCar) return status.server === 'standby' ? t('status.standby', { team }) : t('status.driving', { team });
  return t('status.ready', { team });
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
    { label: t('menu.show'), type: 'checkbox', checked: settings.overlay, enabled: configured, click: (i) => updateSettings({ overlay: i.checked }) },
    { label: t('menu.monitor'), type: 'radio', checked: settings.output === 'monitor', enabled: configured, click: () => updateSettings({ output: 'monitor' }) },
    {
      label: `${t('menu.vr')}${settings.output === 'vr' && vr === 'waiting' ? t('menu.vrWaiting') : ''}`,
      type: 'radio', checked: settings.output === 'vr', enabled: configured, click: () => updateSettings({ output: 'vr' }),
    },
    {
      label: `${t('menu.move')}${editHotkey() ? ` (${editHotkey()})` : ''}`,
      type: 'checkbox', checked: editing(), enabled: overlayRunning(), click: toggleEdit,
    },
    { label: t('menu.recenter'), enabled: vr === 'connected', click: recenterVr },
    { type: 'separator' },
    { label: t('menu.settings'), click: () => openSetup() },
    { label: t('menu.hotkeys'), click: () => openSetup('/setup/keys') },
    { label: t('menu.autostart'), type: 'checkbox', checked: settings.autostart, enabled: app.isPackaged, click: (i) => updateSettings({ autostart: i.checked }) },
    { label: t('menu.server', { port: settings.serverPort }), type: 'checkbox', checked: settings.server, click: (i) => updateSettings({ server: i.checked }) },
    { label: t('menu.logs'), click: () => shell.openPath(logDir) },
    { type: 'separator' },
    { label: t('menu.quit'), click: () => app.quit() },
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
    pitImport,
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
  const allowed = ['language', 'overlay', 'output', 'autostart', 'server', 'panels', 'opacity', 'pitStop'];
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)));
  if (clean.panels) clean.panels = cleanPanels({ ...settings.panels, ...clean.panels });
  if ('opacity' in clean) clean.opacity = cleanOpacity(clean.opacity);
  if ('output' in clean) clean.output = cleanOutput(clean.output);
  if ('language' in clean) clean.language = cleanLanguage(clean.language);
  if ('overlay' in clean) clean.overlay = Boolean(clean.overlay);
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
    buttons: [t('leave.cancel'), t('leave.confirm')],
    defaultId: 0,
    cancelId: 0,
    message: t('leave.question'),
    detail: t('leave.detail'),
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
ipcMain.handle('app:pit-import', async (_e, choose) => {
  await startPitImport(Boolean(choose));
  return appState();
});

let announced = '';
function onUpdateChange(u) {
  // Tell the user once per version, even if the window is closed.
  if (u.phase === 'ready' && announced !== u.version && tray) {
    announced = u.version;
    tray.displayBalloon({
      title: t('update.balloonTitle', { version: u.version }),
      content: t('update.balloonText', { version: u.version }),
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

// StintView desktop app: tray icon, setup window, and the background pieces –
// recorder (always), desktop overlay / VR panels (per setting) and optionally the team relay.
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, utilityProcess } = require('electron');
const { createWriteStream, mkdirSync, readdirSync } = require('node:fs');
const path = require('node:path');
const {
  cleanLanguage, cleanMessages, cleanOpacity, cleanOutput, cleanPanels, cleanPitStop, cleanVrRecenter, clearConfig, configPath, dataDir, loadConfig, loadSettings, logDir, normalizeUrl, panelConfig, panelsFor, register, saveSettings,
} = require('./config.cjs');
const {
  editHotkey, editing, onOverlayChange, overlayRunning, editHotkeyInfo, setEditMode, setOverlayLanguage, setOverlayOpacity, setOverlayPanelConfig, setOverlayPanels, startOverlay, stopOverlay, toggleEdit,
} = require('./overlay-window.cjs');
const { PRELOAD, loadRoute } = require('./renderer.cjs');
const { cameraCommand, cameraHotkeyInfo, cameraInfo, onRecorderMessage, setHazardCar, setTeamCar, startCamera, stopCamera } = require('./camera.cjs');
const { alignToHead, recenterVr, resetPanelAnchor, setVrLanguage, setVrOpacity, setVrPanelConfig, startVr, stopVr, vrHotkeyInfo, vrStatus } = require('./vr.cjs');
const { hotkeyGroups } = require('./hotkeys.cjs');
const { cancelLearnRecenter, learnRecenter, watchRecenter } = require('./rawinput.cjs');
const { messageHotkeyInfo, radioState, sendMessage, setDriving, setMessages, startMessages, stopMessages } = require('./messages.cjs');
const { checkNow, installNow, setupUpdates, updateInfo, updateLabel } = require('./updates.cjs');
const { setLanguage, t } = require('./i18n.cjs');
const { brand } = require('./brand.cjs');

const BUNDLES = path.join(__dirname, '..', 'dist-bundles');
const ICON = path.join(__dirname, 'icons', brand.icons, 'tray.png');
const RESTART_MS = 5000;
// "Only while iRacing runs": keep the displays this long after the sim stops ticking
// (session change, loading, recorder restart), so they don't flicker and VR isn't restarted.
const SIM_GONE_MS = 15000;

// A separate profile (tests, second profile) also needs its own Chromium data and instance lock.
if (process.env.STINTVIEW_HOME) app.setPath('userData', path.join(dataDir, 'electron'));
// The alternative app started from the sources: its own name, Chromium data and instance lock
// (installed, its package.json already carries the name).
else if (app.getName() !== brand.name) {
  app.setName(brand.name);
  app.setPath('userData', dataDir);
}

if (!app.requestSingleInstanceLock()) {
  // Already running: the first instance opens its window (see 'second-instance').
  app.quit();
  return; // CommonJS module scope
}
app.setAppUserModelId(brand.appId);
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
      serviceName: `${brand.name} ${name}`,
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
// .ibt archive imports: "Boxengassen-Zeiten einlesen" (pit lane losses) and
// "Rundenzeiten einlesen" (lap times for the stint planner)
// ---------------------------------------------------------------------------

let pitImport = { running: false, finished: false, done: 0, total: 0, passes: 0, tracks: 0, folder: null, error: null };
let lapImport = { running: false, finished: false, done: 0, total: 0, laps: 0, tracks: 0, folder: null, error: null };
/** Lap times on this PC (stint planner) and how many aren't on the team server yet; from the recorder. */
let lapCounts = null;

const hasIbt = (dir) => {
  try {
    return readdirSync(dir).some((n) => n.toLowerCase().endsWith('.ibt'));
  } catch {
    return false;
  }
};

/** The iRacing telemetry folder (remembered); `choose` or no .ibt files there asks. null = cancelled. */
async function telemetryFolder(choose) {
  let dir = settings.telemetryDir ?? path.join(app.getPath('documents'), 'iRacing', 'telemetry');
  if (!choose && hasIbt(dir)) return dir;
  const r = await dialog.showOpenDialog(setupWin ?? undefined, {
    title: t('import.chooseFolder'), defaultPath: dir, properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  dir = r.filePaths[0];
  if (!hasIbt(dir)) return { missing: dir };
  settings = { ...settings, telemetryDir: dir };
  saveSettings(settings);
  return dir;
}

/**
 * Runs `recorder.cjs <command> <dir>` as a separate process, progress as `event` messages.
 * `get`/`set` hold the state shown in the window, `done` runs after success.
 */
async function startImport({ command, event, service, get, set, done }, choose) {
  if (get().running) return;
  const dir = await telemetryFolder(choose);
  if (dir === null) return;
  if (typeof dir === 'object') {
    set({ ...get(), finished: true, folder: dir.missing, error: t('import.noIbt') });
    return refresh();
  }
  set({ ...get(), running: true, finished: false, done: 0, total: 0, tracks: 0, folder: dir, error: null });
  const proc = utilityProcess.fork(path.join(BUNDLES, 'recorder.cjs'), [command, dir], {
    serviceName: `${brand.name} ${service}`, stdio: 'pipe', env: { ...process.env, STINTVIEW_CONFIG: configPath() },
  });
  proc.stdout?.on('data', (d) => console.log(`[${event}] ${String(d).trim()}`));
  proc.stderr?.on('data', (d) => console.error(`[${event}] ${String(d).trim()}`));
  proc.on('message', (m) => {
    if (m.t !== event) return;
    const { t: _t, ...progress } = m;
    set({ ...get(), ...progress, running: !m.finished });
    if (m.finished && !m.error) done();
    refresh();
  });
  proc.on('exit', (code) => {
    if (!get().running) return;
    set({ ...get(), running: false, finished: true, error: t('import.aborted', { code }) });
    refresh();
  });
  refresh();
}

const startPitImport = (choose) => startImport({
  command: 'import-pitlane', event: 'pit-import', service: 'Boxengassen-Import',
  get: () => pitImport, set: (v) => { pitImport = { ...v, passes: v.passes ?? 0 }; },
  // The live recorder keeps the learned values in memory: tell it to read the file again.
  done: () => recorder?.post({ t: 'pit-model-reload' }),
}, choose);

const startLapImport = (choose) => startImport({
  command: 'import-laps', event: 'lap-import', service: 'Rundenzeiten-Import',
  get: () => lapImport, set: (v) => { lapImport = { ...v, laps: v.laps ?? 0 }; },
  // The import uploads by itself; the live recorder updates the counts and retries what's left.
  done: () => recorder?.post({ t: 'laps-sync' }),
}, choose);

// ---------------------------------------------------------------------------
// Stint planner: a page on the team server, opened in the browser with a one-time code
// ---------------------------------------------------------------------------

/** Opens the planner page in the browser; resolves { error } (null = opened). */
async function openPlanner() {
  const config = loadConfig();
  if (!config) return { error: t('planner.noTeam') };
  let res;
  try {
    res = await fetch(new URL('/api/planner/login', config.serverUrl), {
      method: 'POST', headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { error: t('planner.unreachable', { url: config.serverUrl }) };
  }
  if (res.status === 404) return { error: t('planner.oldServer') };
  if (!res.ok) return { error: t('planner.error', { status: res.status }) };
  const { code } = await res.json();
  const url = new URL('/planner/', config.serverUrl);
  // Brand as a query (the page reads it like the app's pages), the code only in the hash: not sent anywhere.
  if (brand.id !== 'stintview') url.search = `brand=${brand.id}`;
  url.hash = new URLSearchParams({ code, lang: settings.language }).toString();
  await shell.openExternal(url.toString());
  return { error: null };
}

async function openPlannerFromMenu() {
  const { error } = await openPlanner();
  if (error) dialog.showMessageBox({ type: 'warning', message: t('planner.title'), detail: error });
}

let runningVrPanels = '';

// ---------------------------------------------------------------------------
// Own telemetry for the displays on this PC (used there without a team server)
// ---------------------------------------------------------------------------

/** Latest message per type (not inputs), for display pages that open later. */
const localLatest = new Map();
/** The team streams another iRacing session: the displays show this PC's own data instead. */
let otherSession = false;

function setOtherSession(on) {
  if (on === otherSession) return;
  otherSession = on;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== setupWin && !win.isDestroyed()) win.webContents.send('local-prefer', on);
  }
}

function onLocalTelemetry(msg) {
  if (msg.t === 'session') {
    // Another session: the old laps, standings etc. don't belong to it.
    const prev = localLatest.get('session');
    if (prev && (prev.sessionId !== msg.sessionId || prev.sessionType !== msg.sessionType)) localLatest.clear();
  }
  if (msg.t !== 'inputs' && msg.t !== 'send-message') localLatest.set(msg.t, msg);
  // Monitor overlay and VR panel pages; not the StintView window.
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== setupWin && !win.isDestroyed()) win.webContents.send('local', msg);
  }
}

ipcMain.handle('local:snapshot', () => ({ messages: [...localLatest.values()], prefer: otherSession }));

/** Team joined or left: the display pages connect again with the new access (or none). */
function reloadDisplays() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== setupWin && !win.isDestroyed()) win.webContents.reload();
  }
}

function startRecorder() {
  recorder?.stop();
  localLatest.clear();
  // Also without a team: the displays then show this PC's own sessions.
  let needsPitSettings = true;
  // Tests without iRacing: STINTVIEW_REPLAY=<file.ibt>, STINTVIEW_REPLAY_OPTS="--speed 10 --start 60".
  const args = process.env.STINTVIEW_REPLAY
    ? ['replay', process.env.STINTVIEW_REPLAY, ...(process.env.STINTVIEW_REPLAY_OPTS ?? '').split(' ').filter(Boolean)]
    : ['run'];
  recorder = supervise('recorder', 'recorder.cjs', args, { STINTVIEW_CONFIG: configPath() }, (m) => {
    if (m.t === 'telemetry') return onLocalTelemetry(m.msg); // many per second: no refresh
    if (m.t === 'other-session') setOtherSession(m.on);
    // (Re)started process: hand it the manual pit stop values with its first message.
    if (m.t === 'exit') needsPitSettings = true;
    else if (needsPitSettings && recorder?.post({ t: 'pit-settings', pit: settings.pitStop })) needsPitSettings = false;
    if (m.t === 'iracing') {
      status.iracing = m.connected;
      setSimRunning(m.connected);
    }
    if (m.t === 'car') {
      status.inCar = m.inCar;
      setDriving(m.inCar); // Radio panel and message hotkeys are off while you drive
    }
    if (m.t === 'server') {
      status.serverText = m.text;
      status.server = m.text.startsWith('standby') ? 'standby'
        : m.connected ? 'connected'
          : m.text.startsWith('server error') ? 'error' : 'offline';
    }
    if (m.t === 'exit') {
      setOtherSession(false);
      // Displays fall back to the team's data (they show our own while we drive).
      if (localLatest.get('driving')?.driving) onLocalTelemetry({ t: 'driving', driving: false, driverName: '', session: '' });
      Object.assign(status, { iracing: false, inCar: false, server: 'offline' });
      setDriving(false);
      setSimRunning(false);
    }
    if (m.t === 'camera-state' || m.t === 'camera-result') return onRecorderMessage(m);
    // Team messages via the recorder's connection: on time even when a display page's own
    // connection lags behind the telemetry (driver's PC under load, race 09.10.2026).
    if (m.t === 'team-message') {
      for (const win of BrowserWindow.getAllWindows()) if (win !== setupWin && !win.isDestroyed()) win.webContents.send('team-message', m.msg);
      return;
    }
    if (m.t === 'laps') lapCounts = { total: m.total, unsent: m.unsent };
    refresh();
  });
}

function startRelay() {
  if (relay) return;
  const env = {
    PORT: String(settings.serverPort), STINTVIEW_DATA: path.join(dataDir, 'server', 'teams.json'),
    // The stint planner page is part of the built UI.
    STINTVIEW_PLANNER_DIR: path.join(__dirname, '..', 'dist'),
  };
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
  setMessages(cleanMessages(settings.messages, settings.language));
  applyOutputs();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ['--hidden'] });
  refresh();
}

// iRacing simulator running (the recorder sees live ticks); goes false only after SIM_GONE_MS.
let simRunning = false;
let simGoneTimer = null;

function setSimRunning(running) {
  if (running) {
    clearTimeout(simGoneTimer);
    simGoneTimer = null;
    if (!simRunning) {
      simRunning = true;
      applyOutputs();
    }
  } else if (simRunning && !simGoneTimer) {
    simGoneTimer = setTimeout(() => {
      simGoneTimer = null;
      simRunning = false;
      resetPanelAnchor(); // iRacing's own recenter is gone as well
      applyOutputs();
      refresh();
    }, SIM_GONE_MS);
  }
}

/** Displays wanted, but held back until iRacing runs ("only while iRacing runs"). */
const waitingForSim = () => settings.overlay && settings.onlyWithIracing && !simRunning;

/** The iRacing recenter key/button moves the VR panels along – read only while the VR panels run. */
function applyRecenter() {
  const on = settings.overlay && settings.output === 'vr' && settings.vrRecenter && (!settings.onlyWithIracing || simRunning);
  watchRecenter(on ? settings.vrRecenter : null, alignToHead);
}

/** Starts/stops the monitor overlay or the VR panels according to the settings and iRacing. */
function applyOutputs() {
  // Also without a team: the displays then show this PC's own sessions.
  const on = settings.overlay && (!settings.onlyWithIracing || simRunning);
  // One output at a time: the monitor overlay or the VR panels.
  if (on && settings.output === 'monitor') startOverlay(); else stopOverlay();
  // VR panels are separate windows: restart the VR host when the selection changes.
  const vrPanels = panelsFor(settings);
  if (on && settings.output === 'vr') {
    if (vrStatus() !== 'off' && vrPanels.join() !== runningVrPanels) stopVr();
    runningVrPanels = vrPanels.join();
    startVr(refresh, vrPanels).catch((e) => console.error('[vr]', e));
  } else {
    stopVr();
  }
  applyRecenter();
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
  if (!config) return !status.iracing ? t('status.noTeamNoIracing') : status.inCar ? t('status.noTeamDriving') : t('status.noTeam');
  if (status.server === 'error') return t('status.server', { text: status.serverText.replace(/^server error: /, '') });
  if (status.server === 'offline') return t('status.offline');
  const team = config.teamName;
  if (otherSession) return t('status.otherSession', { team });
  if (!status.iracing) return t('status.noIracing', { team });
  if (status.inCar) return status.server === 'standby' ? t('status.standby', { team }) : t('status.driving', { team });
  return t('status.ready', { team });
}

function refresh() {
  if (tray) {
    // Started from the sources: say so, so it can't be mixed up with the installed app.
    tray.setToolTip(`${brand.name}${app.isPackaged ? '' : ` (${t('app.testInstance')})`} – ${statusLine()}`);
    tray.setContextMenu(buildMenu());
  }
  if (setupWin && !setupWin.isDestroyed()) setupWin.webContents.send('app-state', appState());
}

function buildMenu() {
  const vr = vrStatus();
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    updateMenuItem(),
    { type: 'separator' },
    { label: t('menu.show'), type: 'checkbox', checked: settings.overlay, click: (i) => updateSettings({ overlay: i.checked }) },
    {
      label: `${t('menu.onlyWithIracing')}${waitingForSim() ? t('menu.waitingForIracing') : ''}`,
      type: 'checkbox', checked: settings.onlyWithIracing, enabled: settings.overlay, click: (i) => updateSettings({ onlyWithIracing: i.checked }),
    },
    { label: t('menu.monitor'), type: 'radio', checked: settings.output === 'monitor', click: () => updateSettings({ output: 'monitor' }) },
    {
      label: `${t('menu.vr')}${settings.output === 'vr' && vr === 'waiting' ? t('menu.vrWaiting') : ''}`,
      type: 'radio', checked: settings.output === 'vr', click: () => updateSettings({ output: 'vr' }),
    },
    {
      label: `${t('menu.move')}${editHotkey() ? ` (${editHotkey()})` : ''}`,
      type: 'checkbox', checked: editing(), enabled: overlayRunning(), click: toggleEdit,
    },
    { label: t('menu.recenter'), enabled: vr === 'connected', click: recenterVr },
    { type: 'separator' },
    { label: t('menu.settings'), click: () => openSetup() },
    { label: t('menu.planner'), enabled: Boolean(loadConfig()), click: openPlannerFromMenu },
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
  // Event handlers pass their event object: only a route string counts.
  if (typeof route !== 'string') route = '/setup';
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
    title: brand.name,
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
    // Started from the sources (npx electron .): the version is the placeholder from package.json.
    testInstance: !app.isPackaged,
    configured: Boolean(config),
    team: config ? { teamName: config.teamName, memberName: config.memberName, serverUrl: config.serverUrl, inviteCode: config.inviteCode } : null,
    settings,
    status: { ...status, otherSession, line: statusLine(), waitingForIracing: waitingForSim(), vr: vrStatus(), overlay: overlayRunning(), editing: editing(), editHotkey: editHotkey() },
    autostartAvailable: app.isPackaged,
    cameraHotkeys: cameraInfo().hotkeys,
    pitImport,
    lapImport,
    lapCounts,
    radio: radioState(),
    hotkeys: (() => {
      const cam = cameraHotkeyInfo();
      return hotkeyGroups(editHotkeyInfo(), cam.keys, cam.candidates, vrHotkeyInfo(), { overlay: overlayRunning() },
        { items: messageHotkeyInfo(), driving: radioState().driving });
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
  reloadDisplays();
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
  reloadDisplays();
  return appState();
});

ipcMain.handle('app:settings', (_e, patch) => {
  const allowed = ['language', 'overlay', 'onlyWithIracing', 'output', 'autostart', 'server', 'panels', 'opacity', 'pitStop', 'messages', 'vrRecenter'];
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)));
  if (clean.panels) clean.panels = cleanPanels({ ...settings.panels, ...clean.panels });
  if ('opacity' in clean) clean.opacity = cleanOpacity(clean.opacity);
  if ('output' in clean) clean.output = cleanOutput(clean.output);
  if ('language' in clean) clean.language = cleanLanguage(clean.language);
  if ('overlay' in clean) clean.overlay = Boolean(clean.overlay);
  if ('onlyWithIracing' in clean) clean.onlyWithIracing = Boolean(clean.onlyWithIracing);
  if (clean.pitStop) clean.pitStop = cleanPitStop({ ...settings.pitStop, ...clean.pitStop });
  // null ("restore defaults") stays null, so the defaults follow the UI language again.
  if ('vrRecenter' in clean) clean.vrRecenter = cleanVrRecenter(clean.vrRecenter);
  if ('messages' in clean) clean.messages = Array.isArray(clean.messages) ? cleanMessages(clean.messages) : null;
  updateSettings(clean);
  return appState();
});

/** Panel size from the corner handle on the monitor overlay: same setting as the slider. */
ipcMain.handle('app:panel-size', (_e, id, size) => {
  if (!settings.panels[id] || !Number.isFinite(size)) return;
  const clamped = Math.min(200, Math.max(50, Math.round(size / 5) * 5));
  updateSettings({ panels: cleanPanels({ ...settings.panels, [id]: { ...settings.panels[id], size: clamped } }) });
  refresh();
});

/** VR recenter coupled to iRacing: the next key/button pressed anywhere (null = cancelled/timeout). */
ipcMain.handle('app:recenter-learn', async () => {
  const b = cleanVrRecenter(await learnRecenter());
  if (b) updateSettings({ vrRecenter: b }); else applyRecenter();
  refresh();
  return appState();
});
ipcMain.handle('app:recenter-cancel', () => cancelLearnRecenter());

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

// Team messages: a message id from the list, or { text, color } (StintView window, Radio panel).
ipcMain.handle('app:send-message', (_e, what) => sendMessage(
  typeof what === 'string' ? what : { text: String(what?.text ?? ''), color: String(what?.color ?? 'white') }));
ipcMain.handle('app:radio', () => radioState());

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
  clearConfig();
  startRecorder(); // without a team now
  Object.assign(status, { iracing: false, inCar: false, server: 'offline', serverText: '' });
  applySettings();
  reloadDisplays();
  return appState();
});

// Updates: button in tray and window instead of "restart twice".
ipcMain.handle('app:update-check', () => { checkNow(); return appState(); });
ipcMain.handle('app:update-install', () => installNow());
ipcMain.handle('app:pit-import', async (_e, choose) => {
  await startPitImport(Boolean(choose));
  return appState();
});
ipcMain.handle('app:lap-import', async (_e, choose) => {
  await startLapImport(Boolean(choose));
  return appState();
});
ipcMain.handle('app:planner-open', () => openPlanner());

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

app.on('second-instance', () => openSetup());

app.whenReady().then(() => {
  onOverlayChange(() => refresh());
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.on('click', () => openSetup());
  startRecorder();
  startCamera((msg) => recorder?.post(msg) ?? false);
  startMessages((msg) => recorder?.post(msg) ?? false);
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
  stopMessages();
  stopRelay();
  stopVr();
  stopOverlay();
  watchRecenter(null);
});

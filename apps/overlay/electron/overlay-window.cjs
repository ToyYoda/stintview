// Desktop overlay: one small transparent, always-on-top, click-through window per panel (since
// 0.24), sized to the panel. Before, one window spanned all monitors – with triple screens a
// teammate got only 60 fps: Windows had to compose iRacing through a window covering the whole
// picture, and without GPU rendering every change re-uploaded the full area (11.10.2026).
// Edit mode: the panels can be dragged (the window itself moves) and resized at the corner handle.
const { BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { PRELOAD, loadRoute } = require('./renderer.cjs');
const { brand } = require('./brand.cjs');
const { dataDir } = require('./config.cjs');

// Tried in order; the first one no other program holds wins (e.g. AMD Radeon Software
// takes Ctrl+Shift+O for its metrics overlay).
const EDIT_HOTKEYS = ['Control+Shift+O', 'Control+Alt+O', 'Control+Shift+F9'];
/** Transparent margin around a panel in its window: room for the edit outline and the resize handle. */
const PAD = 8;
const positionsPath = path.join(dataDir, 'overlay.json');

/** Panel top-left relative to the main monitor; side by side on a 1920 px wide screen. */
const DEFAULT_POSITIONS = {
  header: { x: 40, y: 40 },
  inputs: { x: 40, y: 100 },
  fuel: { x: 500, y: 100 },
  tyres: { x: 840, y: 100 },
  standings: { x: 1420, y: 100 },
  radio: { x: 40, y: 480 },
  messages: { x: 660, y: 560 },
  weather: { x: 1060, y: 480 },
  pitstop: { x: 1420, y: 600 }, // below standings, which grows to ~450 px with lapping rows
  duel: { x: 700, y: 860 },
  // Off by default: where they show up when switched on (move them as needed).
  relative: { x: 40, y: 640 },
  classes: { x: 860, y: 40 },
};

let running = false;
let edit = false;
let hotkey = null;
let notify = () => {};
let panels = []; // widget ids to show
let opacity = 0.78; // panel background opacity 0–1
let panelConfig = null; // { [id]: { scale, options } }
let language = 'de';
let profile = 'watching'; // panel positions are kept per profile
/** id -> BrowserWindow */
const wins = new Map();
let banner = null;

/** Called whenever edit mode or the overlay changes (tray menu, setup window). */
const onOverlayChange = (fn) => { notify = fn; };

/** "Control+Shift+O" -> "Strg+Umschalt+O" (UI language). */
const { displayKey: displayHotkey } = require('./hotkeys.cjs');

// ---------------------------------------------------------------------------
// Positions: overlay.json { profiles: { driving: { [id]: {x, y} }, watching: … }, migrated }
// ---------------------------------------------------------------------------

function loadStore() {
  try {
    const s = JSON.parse(readFileSync(positionsPath, 'utf8'));
    return { profiles: s.profiles ?? {}, migrated: s.migrated === true };
  } catch {
    return { profiles: {}, migrated: false };
  }
}
let store = loadStore();

function saveStore() {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(positionsPath, JSON.stringify(store, null, 2));
}

const validPos = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Window position on screen for a panel: saved relative to the main monitor (monitors added or
 * removed don't move it); a panel left on a monitor that is gone is pulled onto the main one.
 */
function windowPosition(id) {
  const saved = store.profiles[profile]?.[id];
  const rel = validPos(saved) ? saved : DEFAULT_POSITIONS[id] ?? { x: 40, y: 40 };
  const main = screen.getPrimaryDisplay().bounds;
  let x = main.x + rel.x, y = main.y + rel.y;
  const visible = screen.getAllDisplays().some((d) => {
    const b = d.bounds;
    return x + 20 >= b.x && x + 20 < b.x + b.width && y + 20 >= b.y && y + 20 < b.y + b.height;
  });
  if (!visible) {
    x = main.x + Math.min(Math.max(0, rel.x), Math.max(0, main.width - 120));
    y = main.y + Math.min(Math.max(0, rel.y), Math.max(0, main.height - 60));
  }
  return { x: Math.round(x - PAD), y: Math.round(y - PAD) };
}

/** After dragging: remember where the panel is, relative to the main monitor. */
function savePosition(id, win) {
  const [wx, wy] = win.getPosition();
  const main = screen.getPrimaryDisplay().bounds;
  store.profiles[profile] = { ...store.profiles[profile], [id]: { x: wx + PAD - main.x, y: wy + PAD - main.y } };
  saveStore();
}

function placeAll() {
  for (const [id, win] of wins) {
    if (win.isDestroyed()) continue;
    const { x, y } = windowPosition(id);
    const [w, h] = win.getSize();
    win.setBounds({ x, y, width: w, height: h });
  }
  placeBanner();
}

// Up to 0.23 positions were in the overlay page's localStorage (one key, then one per profile):
// a panel page sends them once, the first time.
ipcMain.on('overlay:legacy-positions', (e, saved) => {
  if (store.migrated || !saved || typeof saved !== 'object') return;
  const parse = (k) => { try { return JSON.parse(saved[k] ?? 'null'); } catch { return null; } };
  const common = parse('stintview.positions');
  for (const p of ['driving', 'watching']) {
    const old = parse(`stintview.positions.${p}`) ?? common;
    if (!old || store.profiles[p]) continue;
    store.profiles[p] = Object.fromEntries(Object.entries(old).filter(([, v]) => validPos(v)));
  }
  store.migrated = true;
  saveStore();
  placeAll();
});

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function baseWindow(x, y) {
  const win = new BrowserWindow({
    x, y, width: 40, height: 40,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: `${brand.name} Overlay`,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  // 'screen-saver' level stays above borderless-windowed games.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  return win;
}

function createPanel(id) {
  const { x, y } = windowPosition(id);
  const win = baseWindow(x, y);
  win.setIgnoreMouseEvents(!edit, { forward: true });
  win.setFocusable(edit);
  // Dragged in edit mode (the page marks the panel as the window's drag area).
  win.on('moved', () => { if (edit) savePosition(id, win); });
  win.on('closed', () => { if (wins.get(id) === win) wins.delete(id); });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('edit-mode', edit, displayHotkey(hotkey));
    win.webContents.send('opacity', opacity);
    if (panelConfig) win.webContents.send('panel-config', panelConfig);
    win.webContents.send('language', language);
    win.webContents.send('profile', profile);
  });
  loadRoute(win, `/panel/${id}`);
  wins.set(id, win);
}

/** Banner "drag the panels … Done" at the top of the main monitor while editing. */
function placeBanner() {
  if (!banner || banner.isDestroyed()) return;
  const main = screen.getPrimaryDisplay().bounds;
  const [w, h] = banner.getSize();
  banner.setBounds({ x: Math.round(main.x + (main.width - w) / 2), y: main.y + 8, width: w, height: h });
}

function showBanner(on) {
  if (!on) {
    if (banner && !banner.isDestroyed()) banner.destroy();
    banner = null;
    return;
  }
  if (banner) return;
  banner = baseWindow(0, 0);
  banner.webContents.on('did-finish-load', () => {
    banner?.webContents.send('edit-mode', true, displayHotkey(hotkey));
    banner?.webContents.send('language', language);
  });
  banner.on('closed', () => { banner = null; });
  loadRoute(banner, '/banner');
}

/** The page reports its content size (CSS px = DIP); 0 = nothing to show (window hidden). */
ipcMain.on('overlay:size', (e, w, h) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed() || (win !== banner && ![...wins.values()].includes(win))) return;
  if (!(w > 0 && h > 0)) {
    if (win.isVisible()) win.hide();
    return;
  }
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: Math.ceil(w), height: Math.ceil(h) });
  if (win === banner) placeBanner();
  if (!win.isVisible()) win.showInactive();
});

// Buttons in a panel (camera jump, radio) must be clickable although the window is click-through:
// the page reports when the pointer is over one, and only then the window takes mouse input.
// The window stays non-focusable, so clicking does not take focus away from iRacing.
ipcMain.on('overlay:interactive', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || edit || ![...wins.values()].includes(win)) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
});

function setEdit(on) {
  if (!running) return;
  edit = on;
  for (const win of wins.values()) {
    if (win.isDestroyed()) continue;
    // Click-through unless editing; forward keeps hover events for the page.
    win.setIgnoreMouseEvents(!on, { forward: true });
    win.setFocusable(on);
    win.webContents.send('edit-mode', on, displayHotkey(hotkey));
  }
  showBanner(on);
  notify();
}

function registerHotkey() {
  hotkey = EDIT_HOTKEYS.find((h) => globalShortcut.register(h, () => setEdit(!edit))) ?? null;
  if (!hotkey) console.warn('[overlay] no edit hotkey available, all taken:', EDIT_HOTKEYS.join(', '));
  else if (hotkey !== EDIT_HOTKEYS[0]) console.warn(`[overlay] ${EDIT_HOTKEYS[0]} is taken, using ${hotkey}`);
}

/** Windows for the chosen panels: new ones opened, removed ones closed. */
function syncPanels() {
  if (!running) return;
  for (const [id, win] of wins) {
    if (!panels.includes(id)) {
      wins.delete(id);
      if (!win.isDestroyed()) win.destroy();
    }
  }
  for (const id of panels) if (!wins.has(id)) createPanel(id);
}

let watchingScreens = false;

function startOverlay() {
  if (running) return;
  running = true;
  if (!watchingScreens) {
    watchingScreens = true; // screen events only after app 'ready' – i.e. here, once
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, placeAll);
  }
  edit = false;
  store = loadStore();
  syncPanels();
  registerHotkey();
}

function stopOverlay() {
  if (!running) return;
  running = false;
  if (hotkey) globalShortcut.unregister(hotkey);
  hotkey = null;
  edit = false;
  showBanner(false);
  for (const win of wins.values()) if (!win.isDestroyed()) win.destroy();
  wins.clear();
}

const broadcast = (channel, value) => {
  for (const win of wins.values()) if (!win.isDestroyed()) win.webContents.send(channel, value);
};

/** Widgets to show on the monitor overlay. */
function setOverlayPanels(ids) {
  panels = ids ?? [];
  syncPanels();
}

/** Profile shown (driving / watching): its panel positions. */
function setOverlayProfile(p) {
  if (p === profile) return;
  profile = p;
  broadcast('profile', p);
  placeAll();
}

/** UI language of the overlay pages. */
function setOverlayLanguage(l) {
  language = l;
  broadcast('language', l);
  if (banner && !banner.isDestroyed()) banner.webContents.send('language', l);
}

/** Size and options per panel from the StintView window. */
function setOverlayPanelConfig(cfg) {
  panelConfig = cfg;
  broadcast('panel-config', cfg);
}

function setOverlayOpacity(value) {
  opacity = value;
  broadcast('opacity', value);
}

const toggleEdit = () => setEdit(!edit);
const setEditMode = (on) => setEdit(Boolean(on));
const overlayRunning = () => running;
const editHotkey = () => displayHotkey(hotkey);
const editing = () => edit;
/** For the hotkey overview: registered key (null if none/not running) and the candidates. */
const editHotkeyInfo = () => ({ key: hotkey, candidates: EDIT_HOTKEYS });

module.exports = {
  startOverlay, stopOverlay, toggleEdit, setEditMode, overlayRunning, editHotkey, editHotkeyInfo, editing, onOverlayChange, setOverlayPanels, setOverlayOpacity, setOverlayPanelConfig, setOverlayLanguage, setOverlayProfile,
  PAD,
};

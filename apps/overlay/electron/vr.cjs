// VR host: renders each widget offscreen and shows it as a SteamVR overlay panel.
// Works with any SteamVR game regardless of whether iRacing runs in OpenVR or OpenXR mode.
const { BrowserWindow, globalShortcut } = require('electron');
const { t } = require('./i18n.cjs');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./config.cjs');
const { D3D11 } = require('./d3d11.cjs');
const { OpenVR, panelTransform, TRANSIENT_ERRORS } = require('./openvr.cjs');
const { PRELOAD, loadRoute } = require('./renderer.cjs');

const FPS = Number(process.env.STINTVIEW_VR_FPS ?? 30);
const ZOOM = 2; // render at 2x for sharp text in the headset
const RETRY_MS = 5000;
const layoutPath = path.join(dataDir, 'vr.json');

// Metres, relative to the seated origin set by recentering in iRacing.
const DEFAULT_LAYOUT = {
  visible: true,
  panels: {
    header: { enabled: true, distance: 0.8, down: 0.14, right: 0.0, width: 0.22 },
    inputs: { enabled: true, distance: 0.8, down: 0.3, right: 0.0, width: 0.3 },
    fuel: { enabled: true, distance: 0.8, down: 0.3, right: -0.3, width: 0.2 },
    tyres: { enabled: true, distance: 0.8, down: 0.3, right: 0.3, width: 0.24 },
    weather: { enabled: true, distance: 0.8, down: 0.08, right: 0.3, width: 0.22 },
    standings: { enabled: true, distance: 0.8, down: 0.08, right: -0.3, width: 0.22 },
    pitstop: { enabled: true, distance: 0.8, down: 0.3, right: -0.3, width: 0.2 },
  },
};

function loadLayout() {
  try {
    const saved = JSON.parse(readFileSync(layoutPath, 'utf8'));
    const panels = {};
    for (const id of Object.keys(DEFAULT_LAYOUT.panels)) panels[id] = { ...DEFAULT_LAYOUT.panels[id], ...saved.panels?.[id] };
    return { ...DEFAULT_LAYOUT, ...saved, panels };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

let layout = null;
let ids = [];
/** id -> { win, handle, textures, texW, texH, flip, width, height, failures, fitTimer } */
const panels = new Map();
let vr = null;
let d3d = null;
let retryTimer = null;
let running = false;
let selected = 0;
let onChange = () => {};

function log(msg) {
  console.log(`[vr] ${msg}`);
}

function saveLayout() {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(layoutPath, JSON.stringify(layout, null, 2));
}

// ---------------------------------------------------------------------------
// Offscreen widget rendering
// ---------------------------------------------------------------------------

/** Panel background opacity 0–1; sent to every panel page (they are transparent textures). */
let vrOpacity = 1;
let vrLanguage = 'de';

/** UI language of the panel pages. */
function setVrLanguage(l) {
  vrLanguage = l;
  for (const panel of panels.values()) if (!panel.win.isDestroyed()) panel.win.webContents.send('language', l);
}
/** { [id]: { scale, options } } from the StintView window: size factor on top of the layout width. */
let vrPanelConfig = {};

/** Size and options per panel; applied live (no VR restart). */
function setVrPanelConfig(cfg) {
  vrPanelConfig = cfg ?? {};
  for (const [id, panel] of panels) {
    if (!panel.win.isDestroyed()) panel.win.webContents.send('panel-config', vrPanelConfig);
    if (vr && panel.handle) placePanel(id);
  }
}

function setVrOpacity(value) {
  vrOpacity = value;
  for (const panel of panels.values()) if (!panel.win.isDestroyed()) panel.win.webContents.send('opacity', value);
}

async function createPanelWindow(id) {
  const win = new BrowserWindow({
    show: false,
    // Large enough that no widget wraps before it is measured.
    width: 2000,
    height: 1200,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      zoomFactor: ZOOM,
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setFrameRate(FPS);
  const panel = { win, handle: null, width: 0, height: 0, fitTimer: null };
  panels.set(id, panel);

  win.webContents.on('paint', (_e, _dirty, image) => pushFrame(id, image));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('opacity', vrOpacity);
    win.webContents.send('panel-config', vrPanelConfig);
    win.webContents.send('language', vrLanguage);
  });
  await loadRoute(win, `/widget/${id}`);
  await new Promise((r) => setTimeout(r, 300));
  if (win.isDestroyed()) return;
  await fitToWidget(win);
  // Widgets change size (e.g. hint lines appear/disappear); keep the panel tight.
  panel.fitTimer = setInterval(() => fitToWidget(win).catch(() => {}), 2000);
}

/** Sizes the offscreen window to the widget's rendered box. */
async function fitToWidget(win) {
  if (win.isDestroyed()) return;
  const rect = await win.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.single')?.getBoundingClientRect();
    return r ? { w: Math.ceil(r.width), h: Math.ceil(r.height) } : null;
  })()`);
  if (!rect || win.isDestroyed()) return;
  const [w, h] = [Math.max(50, rect.w * ZOOM), Math.max(20, rect.h * ZOOM)];
  const [cw, ch] = win.getContentSize();
  if (w === cw && h === ch) return;
  win.setContentSize(w, h);
  win.webContents.invalidate();
}

/**
 * Chromium paints premultiplied BGRA, which a B8G8R8A8 texture takes as is.
 * Two textures per panel alternate so we never overwrite one SteamVR is still copying.
 */
function uploadTexture(panel, bitmap, width, height) {
  if (panel.texW !== width || panel.texH !== height) {
    releaseTextures(panel);
    panel.textures = [d3d.createTexture(width, height), d3d.createTexture(width, height)];
    panel.texW = width;
    panel.texH = height;
    panel.flip = 0;
  }
  const tex = panel.textures[panel.flip];
  panel.flip ^= 1;
  d3d.upload(tex, bitmap, width);
  return tex;
}

function releaseTextures(panel) {
  for (const t of panel.textures ?? []) d3d.release(t);
  panel.textures = null;
  panel.texW = panel.texH = 0;
}

/** Debug: STINTVIEW_VR_DUMP=<dir> saves each panel as PNG every few seconds (works without SteamVR). */
function dumpFrame(id, image) {
  const dir = process.env.STINTVIEW_VR_DUMP;
  const panel = panels.get(id);
  if (!dir || !panel || Date.now() - (panel.lastDump ?? 0) < 3000) return;
  panel.lastDump = Date.now();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.png`), image.toPNG());
}

function pushFrame(id, image) {
  dumpFrame(id, image);
  const panel = panels.get(id);
  if (!vr || !panel?.handle || !layout.visible) return;
  const { width, height } = image.getSize();
  if (!width || !height) return;
  try {
    vr.setTexture(panel.handle, uploadTexture(panel, image.toBitmap(), width, height));
    if (width !== panel.width || height !== panel.height) {
      panel.width = width;
      panel.height = height;
      const s = vr.inspect(panel.handle);
      log(`${id}: ${width}x${height} uploaded – compositor has ${s.width}x${s.height}, visible=${s.visible}`);
    }
    panel.failures = 0;
  } catch (e) {
    panel.failures = (panel.failures ?? 0) + 1;
    if (!TRANSIENT_ERRORS.has(e.code)) {
      log(`lost SteamVR (${id}: ${e.message}), waiting…`);
      return disconnectVr();
    }
    // Uploads pile up while the compositor isn't drawing until SteamVR rejects them for
    // good. The backlog is per process: only reconnecting clears it.
    if (panel.failures >= FPS * 2) {
      log(`${id}: uploads stuck (${e.message}), reconnecting`);
      disconnectVr();
    }
  }
}

// ---------------------------------------------------------------------------
// SteamVR connection
// ---------------------------------------------------------------------------

function placePanel(id) {
  const p = layout.panels[id];
  const panel = panels.get(id);
  if (!vr || !panel?.handle) return;
  vr.setWidth(panel.handle, p.width * (vrPanelConfig[id]?.scale ?? 1));
  vr.setSeatedTransform(panel.handle, panelTransform(p));
}

function connectVr() {
  if (vr || !running) return;
  try {
    const candidate = new OpenVR();
    candidate.init();
    vr = candidate;
  } catch (e) {
    if (!connectVr.warned) log(`${e.message} – retrying every ${RETRY_MS / 1000}s`);
    connectVr.warned = true;
    return;
  }
  connectVr.warned = false;
  for (const id of ids) openPanel(id);
  log(`connected to SteamVR, ${ids.length} panels`);
  onChange();
}

function openPanel(id) {
  const panel = panels.get(id);
  if (!panel) return;
  panel.handle = vr.createOverlay(`stintview.${id}`, `StintView ${id}`);
  panel.width = panel.height = 0; // re-log the first upload
  panel.failures = 0;
  placePanel(id);
  if (layout.visible) vr.show(panel.handle);
  panel.win.webContents.invalidate();
}

function disconnectVr() {
  if (!vr) return;
  for (const panel of panels.values()) {
    if (panel.handle) {
      try { vr.destroyOverlay(panel.handle); } catch { /* runtime gone */ }
      panel.handle = null;
    }
  }
  try { vr.shutdown(); } catch { /* runtime gone */ }
  vr = null;
  onChange();
}

// ---------------------------------------------------------------------------
// Placement hotkeys (usable while wearing the headset)
// ---------------------------------------------------------------------------

function highlight(id) {
  for (const [pid, panel] of panels) panel.win.webContents.send('edit-mode', pid === id);
  clearTimeout(highlight.timer);
  highlight.timer = setTimeout(() => {
    for (const panel of panels.values()) if (!panel.win.isDestroyed()) panel.win.webContents.send('edit-mode', false);
  }, 2500);
}

function adjust(fn) {
  const id = ids[selected];
  fn(layout.panels[id]);
  placePanel(id);
  highlight(id);
  saveLayout();
}

const STEP = 0.02;
/** Text keys (i18n.cjs) of the hotkey functions, for the overview. */
const HOTKEY_LABELS = {
  'Control+Shift+V': 'vr.select',
  'Control+Shift+Left': 'vr.left',
  'Control+Shift+Right': 'vr.right',
  'Control+Shift+Up': 'vr.up',
  'Control+Shift+Down': 'vr.down',
  'Control+Shift+PageUp': 'vr.farther',
  'Control+Shift+PageDown': 'vr.nearer',
  'Control+Shift+Plus': 'vr.bigger',
  'Control+Shift+-': 'vr.smaller',
  'Control+Shift+H': 'vr.hide',
  'Control+Shift+R': 'vr.recenter',
};
/** Keys another program already holds (registration failed). */
const failedHotkeys = new Set();

const HOTKEYS = {
  'Control+Shift+V': () => { selected = (selected + 1) % ids.length; highlight(ids[selected]); },
  'Control+Shift+Left': () => adjust((p) => { p.right -= STEP; }),
  'Control+Shift+Right': () => adjust((p) => { p.right += STEP; }),
  'Control+Shift+Up': () => adjust((p) => { p.down -= STEP; }),
  'Control+Shift+Down': () => adjust((p) => { p.down += STEP; }),
  'Control+Shift+PageUp': () => adjust((p) => { p.distance = Math.max(0.2, p.distance + STEP); }),
  'Control+Shift+PageDown': () => adjust((p) => { p.distance = Math.max(0.2, p.distance - STEP); }),
  'Control+Shift+Plus': () => adjust((p) => { p.width = Math.min(2, p.width * 1.08); }),
  'Control+Shift+-': () => adjust((p) => { p.width = Math.max(0.05, p.width / 1.08); }),
  'Control+Shift+H': () => {
    layout.visible = !layout.visible;
    saveLayout();
    for (const panel of panels.values()) {
      if (!vr || !panel.handle) continue;
      if (layout.visible) vr.show(panel.handle); else vr.hide(panel.handle);
    }
  },
  'Control+Shift+R': () => recenterVr(),
};

/** SteamVR "reset seated position": where you look now becomes straight ahead. */
function recenterVr() {
  if (!vr) return log('recenter: SteamVR not connected');
  try {
    vr.resetSeatedZeroPose();
    log('recenter: seated zero pose reset');
  } catch (e) {
    log(`recenter failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------

/** Starts rendering the panels and keeps (re)connecting to SteamVR while it runs. */
async function startVr(changed = () => {}, panelIds = null) {
  if (running) return;
  running = true;
  onChange = changed;
  layout = loadLayout();
  // Which panels: chosen in the StintView window; vr.json "enabled" can still switch one off.
  ids = Object.keys(layout.panels).filter((id) => layout.panels[id].enabled && (!panelIds || panelIds.includes(id)));
  selected = 0;
  d3d = new D3D11();
  for (const id of ids) {
    await createPanelWindow(id);
    if (!running) return; // stopped while starting
  }
  for (const [key, fn] of Object.entries(HOTKEYS)) {
    failedHotkeys.delete(key);
    if (!globalShortcut.register(key, fn)) {
      failedHotkeys.add(key);
      log(`hotkey ${key} unavailable`);
    }
  }
  connectVr();
  retryTimer = setInterval(connectVr, RETRY_MS);
  log(`started, layout: ${layoutPath}`);
}

function stopVr() {
  if (!running) return;
  running = false;
  clearInterval(retryTimer);
  retryTimer = null;
  for (const key of Object.keys(HOTKEYS)) globalShortcut.unregister(key);
  disconnectVr();
  for (const panel of panels.values()) {
    clearInterval(panel.fitTimer);
    if (!panel.win.isDestroyed()) panel.win.destroy();
    if (d3d) releaseTextures(panel);
  }
  panels.clear();
  d3d?.destroy();
  d3d = null;
  log('stopped');
  onChange();
}

const vrStatus = () => (!running ? 'off' : vr ? 'connected' : 'waiting');

/** For the hotkey overview. */
const vrHotkeyInfo = () => ({
  running,
  keys: Object.keys(HOTKEYS).map((key) => ({ key, label: HOTKEY_LABELS[key] ? t(HOTKEY_LABELS[key]) : key, ok: !failedHotkeys.has(key) })),
});

module.exports = { startVr, stopVr, vrStatus, vrHotkeyInfo, setVrOpacity, setVrPanelConfig, setVrLanguage, recenterVr };

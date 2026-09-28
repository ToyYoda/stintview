// VR host: renders each widget offscreen and shows it as a SteamVR overlay panel.
// Works with any SteamVR game regardless of whether iRacing runs in OpenVR or OpenXR mode.
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { D3D11 } = require('./d3d11.cjs');
const { OpenVR, panelTransform, TRANSIENT_ERRORS } = require('./openvr.cjs');

const FPS = Number(process.env.STINTVIEW_VR_FPS ?? 30);
const ZOOM = 2; // render at 2x for sharp text in the headset
const RETRY_MS = 5000;

const dataDir = path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'StintView');
const configPath = () => process.env.STINTVIEW_CONFIG ?? path.join(dataDir, 'config.json');
const layoutPath = path.join(dataDir, 'vr.json');

// Metres, relative to the seated origin set by recentering in iRacing.
const DEFAULT_LAYOUT = {
  visible: true,
  panels: {
    header: { enabled: true, distance: 0.8, down: 0.14, right: 0.0, width: 0.22 },
    inputs: { enabled: true, distance: 0.8, down: 0.3, right: 0.0, width: 0.3 },
    fuel: { enabled: true, distance: 0.8, down: 0.3, right: -0.3, width: 0.2 },
    tyres: { enabled: true, distance: 0.8, down: 0.3, right: 0.3, width: 0.24 },
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

function saveLayout() {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(layoutPath, JSON.stringify(layout, null, 2));
}

const layout = loadLayout();
const ids = Object.keys(layout.panels).filter((id) => layout.panels[id].enabled);
/** id -> { win, handle, width, height, lastFrame } */
const panels = new Map();
let vr = null;
let selected = 0;

function log(msg) {
  console.log(`[vr] ${msg}`);
}

// ---------------------------------------------------------------------------
// Offscreen widget rendering
// ---------------------------------------------------------------------------

function widgetUrl(id) {
  return process.env.VITE_DEV_URL
    ? `${process.env.VITE_DEV_URL}#/widget/${id}`
    : `file://${path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/')}#/widget/${id}`;
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setFrameRate(FPS);
  const panel = { win, handle: null, width: 0, height: 0 };
  panels.set(id, panel);

  win.webContents.on('paint', (_e, _dirty, image) => pushFrame(id, image));
  await win.loadURL(widgetUrl(id));
  await new Promise((r) => setTimeout(r, 300));
  await fitToWidget(win);
  // Widgets change size (e.g. hint lines appear/disappear); keep the panel tight.
  setInterval(() => fitToWidget(win).catch(() => {}), 2000);
}

/** Sizes the offscreen window to the widget's rendered box. */
async function fitToWidget(win) {
  const rect = await win.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.single')?.getBoundingClientRect();
    return r ? { w: Math.ceil(r.width), h: Math.ceil(r.height) } : null;
  })()`);
  if (!rect) return;
  const [w, h] = [Math.max(50, rect.w * ZOOM), Math.max(20, rect.h * ZOOM)];
  const [cw, ch] = win.getContentSize();
  if (w === cw && h === ch) return;
  win.setContentSize(w, h);
  win.webContents.invalidate();
}

let d3d = null;

/**
 * Chromium paints premultiplied BGRA, which a B8G8R8A8 texture takes as is.
 * Two textures per panel alternate so we never overwrite one SteamVR is still copying.
 */
function uploadTexture(panel, bitmap, width, height) {
  if (panel.texW !== width || panel.texH !== height) {
    for (const t of panel.textures ?? []) d3d.release(t);
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
    stats.ok++;
  } catch (e) {
    stats.dropped++;
    panel.failures = (panel.failures ?? 0) + 1;
    if (!TRANSIENT_ERRORS.has(e.code)) {
      log(`lost SteamVR (${id}: ${e.message}), waiting…`);
      return disconnectVr();
    }
    // Uploads pile up while the compositor isn't drawing (e.g. headset in standby) until
    // SteamVR rejects them for good. The backlog is per process: only reconnecting clears it.
    if (panel.failures >= FPS * 2) {
      log(`${id}: uploads stuck (${e.message}), reconnecting`);
      disconnectVr();
    }
  }
}

const stats = { ok: 0, dropped: 0 };
if (process.env.STINTVIEW_VR_STATS) {
  setInterval(() => {
    log(`uploads/s: ${stats.ok / 5} ok, ${stats.dropped / 5} dropped`);
    stats.ok = stats.dropped = 0;
  }, 5000);
}

// ---------------------------------------------------------------------------
// SteamVR connection
// ---------------------------------------------------------------------------

function placePanel(id) {
  const p = layout.panels[id];
  const panel = panels.get(id);
  if (!vr || !panel?.handle) return;
  vr.setWidth(panel.handle, p.width);
  vr.setSeatedTransform(panel.handle, panelTransform(p));
}

function connectVr() {
  if (vr) return;
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
}

function openPanel(id) {
  const panel = panels.get(id);
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
}

// ---------------------------------------------------------------------------
// Placement hotkeys (usable while wearing the headset)
// ---------------------------------------------------------------------------

function highlight(id) {
  for (const [pid, panel] of panels) panel.win.webContents.send('edit-mode', pid === id);
  clearTimeout(highlight.timer);
  highlight.timer = setTimeout(() => {
    for (const panel of panels.values()) panel.win.webContents.send('edit-mode', false);
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
const HOTKEYS = {
  'Control+Shift+V': () => { selected = (selected + 1) % ids.length; highlight(ids[selected]); log(`selected ${ids[selected]}`); },
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
};

// ---------------------------------------------------------------------------

ipcMain.handle('get-config', () => {
  try {
    const { serverUrl, token, teamName, memberName } = JSON.parse(readFileSync(configPath(), 'utf8'));
    return { serverUrl, token, teamName, memberName };
  } catch {
    return null;
  }
});

app.disableHardwareAcceleration(); // offscreen rendering is software anyway; keeps GPU free for the sim

app.whenReady().then(async () => {
  d3d = new D3D11();
  for (const id of ids) await createPanelWindow(id);
  for (const [key, fn] of Object.entries(HOTKEYS)) {
    if (!globalShortcut.register(key, fn)) log(`hotkey ${key} unavailable`);
  }
  connectVr();
  setInterval(connectVr, RETRY_MS);
  log(`layout: ${layoutPath}`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  disconnectVr();
});
app.on('window-all-closed', () => {}); // offscreen windows only; quit via Ctrl+C / tray later

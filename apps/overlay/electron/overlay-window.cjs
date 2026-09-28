// Desktop overlay: transparent, always-on-top, click-through window over iRacing (borderless mode).
const { BrowserWindow, globalShortcut, screen } = require('electron');
const { PRELOAD, loadRoute } = require('./renderer.cjs');

// Tried in order; the first one no other program holds wins (e.g. AMD Radeon Software
// takes Ctrl+Shift+O for its metrics overlay).
const EDIT_HOTKEYS = ['Control+Shift+O', 'Control+Alt+O', 'Control+Shift+F9'];

let win = null;
let edit = false;
let hotkey = null;
let notify = () => {};

/** Called whenever edit mode or the overlay changes (tray menu, setup window). */
const onOverlayChange = (fn) => { notify = fn; };

/** "Control+Shift+O" -> "Strg+Umschalt+O" */
const displayHotkey = (h) => h && h.replace('Control', 'Strg').replace('Shift', 'Umschalt');

function setEdit(on) {
  if (!win) return;
  edit = on;
  // Click-through unless editing; forward keeps hover events for the page.
  win.setIgnoreMouseEvents(!on, { forward: true });
  win.setFocusable(on);
  if (on) win.focus();
  win.webContents.send('edit-mode', on, displayHotkey(hotkey));
  notify();
}

function registerHotkey() {
  hotkey = EDIT_HOTKEYS.find((h) => globalShortcut.register(h, () => setEdit(!edit))) ?? null;
  if (!hotkey) console.warn('[overlay] no edit hotkey available, all taken:', EDIT_HOTKEYS.join(', '));
  else if (hotkey !== EDIT_HOTKEYS[0]) console.warn(`[overlay] ${EDIT_HOTKEYS[0]} is taken, using ${hotkey}`);
}

function startOverlay() {
  if (win) return;
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    title: 'StintView Overlay',
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  // 'screen-saver' level stays above borderless-windowed games.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.on('closed', () => { win = null; });
  // Re-send the mode once the page can receive it.
  win.webContents.on('did-finish-load', () => setEdit(edit));
  setEdit(false);
  loadRoute(win, '/');
  registerHotkey();
}

function stopOverlay() {
  if (!win) return;
  if (hotkey) globalShortcut.unregister(hotkey);
  hotkey = null;
  edit = false;
  win.destroy();
  win = null;
}

const toggleEdit = () => setEdit(!edit);
const setEditMode = (on) => setEdit(Boolean(on));
const overlayRunning = () => win !== null;
const editHotkey = () => displayHotkey(hotkey);
const editing = () => edit;

module.exports = { startOverlay, stopOverlay, toggleEdit, setEditMode, overlayRunning, editHotkey, editing, onOverlayChange };

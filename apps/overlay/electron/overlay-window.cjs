// Desktop overlay: transparent, always-on-top, click-through window over iRacing (borderless mode).
const { BrowserWindow, globalShortcut, screen } = require('electron');
const { PRELOAD, loadRoute } = require('./renderer.cjs');

const EDIT_HOTKEY = 'Control+Shift+O';

let win = null;
let edit = false;

function setEdit(on) {
  if (!win) return;
  edit = on;
  // Click-through unless editing; forward keeps hover events for the page.
  win.setIgnoreMouseEvents(!on, { forward: true });
  win.setFocusable(on);
  if (on) win.focus();
  win.webContents.send('edit-mode', on);
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
  setEdit(false);
  loadRoute(win, '/');
  globalShortcut.register(EDIT_HOTKEY, () => setEdit(!edit));
}

function stopOverlay() {
  if (!win) return;
  globalShortcut.unregister(EDIT_HOTKEY);
  win.destroy();
  win = null;
}

const toggleEdit = () => setEdit(!edit);
const overlayRunning = () => win !== null;

module.exports = { startOverlay, stopOverlay, toggleEdit, overlayRunning, EDIT_HOTKEY };

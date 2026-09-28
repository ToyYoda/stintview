// Electron shell: transparent, always-on-top, click-through overlay window.
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');

const EDIT_HOTKEY = 'Control+Shift+O';
const configPath = () =>
  process.env.STINTVIEW_CONFIG ??
  path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'StintView', 'config.json');

let win = null;
let edit = false;

function setEdit(on) {
  edit = on;
  // Click-through unless editing; forward keeps hover events for the page.
  win.setIgnoreMouseEvents(!on, { forward: true });
  win.setFocusable(on);
  if (on) win.focus();
  win.webContents.send('edit-mode', on);
}

function createWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: false,
    title: 'StintView Overlay',
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  // 'screen-saver' level stays above borderless-windowed games.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  setEdit(false);

  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('get-config', () => {
  try {
    const { serverUrl, token, teamName, memberName } = JSON.parse(readFileSync(configPath(), 'utf8'));
    return { serverUrl, token, teamName, memberName };
  } catch {
    return null;
  }
});

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register(EDIT_HOTKEY, () => setEdit(!edit));
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

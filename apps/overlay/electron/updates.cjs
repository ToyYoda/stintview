// Updates from GitHub Releases (electron-updater): check, download in the background, and
// install on request ("Jetzt aktualisieren") – or on quit, as before.
const { app } = require('electron');

const CHECK_EVERY_MS = 60 * 60 * 1000;

/** phase: unavailable (not installed) | idle | checking | downloading | ready | latest | error */
const info = { phase: app.isPackaged ? 'idle' : 'unavailable', version: '', percent: 0, error: '' };
let updater = null;
let notify = () => {};

function set(patch) {
  Object.assign(info, patch);
  notify(info);
}

function setupUpdates(onChange) {
  notify = onChange;
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // still installs on quit if nobody clicks
  autoUpdater.on('checking-for-update', () => set({ phase: 'checking', error: '' }));
  autoUpdater.on('update-not-available', () => set({ phase: 'latest' }));
  autoUpdater.on('update-available', (u) => set({ phase: 'downloading', version: u.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ phase: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (u) => set({ phase: 'ready', version: u.version, percent: 100 }));
  autoUpdater.on('error', (e) => {
    console.error('[update]', e?.message ?? e);
    // A finished download stays installable even if a later check fails.
    if (info.phase !== 'ready') set({ phase: 'error', error: String(e?.message ?? e).split('\n')[0] });
  });
  checkNow();
  setInterval(checkNow, CHECK_EVERY_MS);
}

function checkNow() {
  if (!updater || info.phase === 'checking' || info.phase === 'downloading' || info.phase === 'ready') return;
  updater.checkForUpdates().catch(() => {});
}

/** Installs the downloaded update silently and starts StintView again. */
function installNow() {
  if (!updater || info.phase !== 'ready') return;
  updater.quitAndInstall(true, true);
}

/** Short German status for tray and window. */
function updateLabel() {
  switch (info.phase) {
    case 'checking': return 'Suche nach Updates …';
    case 'downloading': return `Update ${info.version} wird geladen … ${info.percent} %`;
    case 'ready': return `Update ${info.version} installieren und neu starten`;
    case 'latest': return 'Nach Updates suchen (aktuell)';
    case 'error': return 'Nach Updates suchen (letzte Suche fehlgeschlagen)';
    case 'unavailable': return 'Updates nur in der installierten App';
    default: return 'Nach Updates suchen';
  }
}

module.exports = { setupUpdates, checkNow, installNow, updateInfo: () => ({ ...info }), updateLabel };

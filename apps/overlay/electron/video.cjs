// Video panel (wish 14.11.2026: see a Discord video in the overlay): Discord has no interface for
// other programs to get a stream, so the panel shows another window – e.g. Discord's pop-out of a
// camera or screen share – captured with Chromium's window capture (desktopCapturer). The page
// asks for the source id here and captures it itself (getUserMedia with chromeMediaSourceId).
const { BrowserWindow, desktopCapturer, ipcMain } = require('electron');

/** Our own windows (setup window, panels) are no sources. */
const ownSources = () => new Set(BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => w.getMediaSourceId()));

/** Windows to choose from in the StintView window, with a small preview. */
async function listWindows() {
  const own = ownSources();
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 256, height: 144 } });
  return sources
    .filter((s) => s.name && !own.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }));
}

/**
 * The chosen window now: the same window as when it was chosen, if it still exists (its title
 * may change), else the first with the same title (window ids change when it is reopened).
 */
async function findWindow(want) {
  if (!want || typeof want.name !== 'string') return null;
  const own = ownSources();
  const sources = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })).filter((s) => !own.has(s.id));
  const s = sources.find((x) => x.id === want.id) ?? sources.find((x) => x.name === want.name);
  return s ? { id: s.id, name: s.name } : null;
}

function registerVideoIpc() {
  ipcMain.handle('video:windows', () => listWindows().catch(() => []));
  ipcMain.handle('video:source', (_e, want) => findWindow(want).catch(() => null));
}

module.exports = { registerVideoIpc };

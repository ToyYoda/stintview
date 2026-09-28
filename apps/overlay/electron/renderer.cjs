// Loads a route of the React UI: Vite dev server in development, the built files otherwise.
const path = require('node:path');

const PRELOAD = path.join(__dirname, 'preload.cjs');

/** @param {Electron.BrowserWindow} win @param {string} route e.g. "/widget/inputs" or "/setup" */
function loadRoute(win, route) {
  if (process.env.VITE_DEV_URL) return win.loadURL(`${process.env.VITE_DEV_URL}#${route}`);
  return win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: route });
}

module.exports = { loadRoute, PRELOAD };

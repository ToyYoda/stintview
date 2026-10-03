// Loads a route of the React UI: Vite dev server in development, the built files otherwise.
const path = require('node:path');
const { brand } = require('./brand.cjs');

const PRELOAD = path.join(__dirname, 'preload.cjs');

/** @param {Electron.BrowserWindow} win @param {string} route e.g. "/widget/inputs" or "/setup" */
function loadRoute(win, route) {
  // The page learns which app it belongs to from ?brand= (name, logo, colours).
  if (process.env.VITE_DEV_URL) return win.loadURL(`${process.env.VITE_DEV_URL}?brand=${brand.id}#${route}`);
  return win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: route, query: { brand: brand.id } });
}

module.exports = { loadRoute, PRELOAD };

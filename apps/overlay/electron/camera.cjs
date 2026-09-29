// Spectator camera control: "jump to the incident ahead of our driver" / "back to our car".
// The recorder utility process does the work on the local iRacing; this module routes
// commands from the overlay buttons and global hotkeys, and results back to all windows.
const { BrowserWindow, globalShortcut } = require('electron');

// First free one wins (see overlay-window.cjs for why fallbacks are needed).
const HOTKEYS = {
  incident: ['Control+Shift+J', 'Control+Alt+J', 'Control+Shift+F7'],
  back: ['Control+Shift+K', 'Control+Alt+K', 'Control+Shift+F8'],
};

let sendToRecorder = () => false;
/** Team car as last reported by a renderer that follows the team feed. */
let team = null;
let state = null; // last CameraState from the recorder
/** Car named by the driver's "Unfall voraus", reported by the overlay; hotkeys jump there. */
let hazardCar = null;
const keys = { incident: null, back: null };

const display = (h) => h && h.replace('Control', 'Strg').replace('Shift', 'Umschalt');

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

/** `targetCarIdx`: car named by the driver's "Unfall voraus"; without it the recorder searches. */
/** Ignore commands this soon after the previous one (double clicks, held hotkeys). */
const COOLDOWN_MS = 1000;
let lastCommandAt = 0;

function command(action, targetCarIdx) {
  const now = Date.now();
  if (now - lastCommandAt < COOLDOWN_MS) return console.log(`[camera] ${action} ignored (${now - lastCommandAt} ms after the previous command)`);
  lastCommandAt = now;
  if (!team || team.carIdx < 0) return broadcast('camera', { t: 'camera-result', ok: false, text: 'Noch keine Daten vom Team-Auto' });
  const msg = { t: 'camera', action, team, ...(targetCarIdx !== undefined ? { targetCarIdx } : {}) };
  if (!sendToRecorder(msg)) broadcast('camera', { t: 'camera-result', ok: false, text: 'Recorder läuft nicht' });
}

function startCamera(post) {
  sendToRecorder = post;
  for (const action of Object.keys(HOTKEYS)) {
    if (keys[action]) continue;
    const run = () => command(action, action === 'incident' && hazardCar !== null ? hazardCar : undefined);
    keys[action] = HOTKEYS[action].find((h) => globalShortcut.register(h, run)) ?? null;
  }
}

function stopCamera() {
  for (const action of Object.keys(keys)) {
    if (keys[action]) globalShortcut.unregister(keys[action]);
    keys[action] = null;
  }
}

/** Messages from the recorder: 'camera-state' (where the local camera is) and 'camera-result'. */
function onRecorderMessage(m) {
  if (m.t === 'camera-state') state = m;
  if (m.t === 'camera-state' || m.t === 'camera-result') broadcast('camera', m);
}

/** For the hotkey overview: registered keys (raw accelerators) and the candidates. */
const cameraHotkeyInfo = () => ({ keys: { ...keys }, candidates: HOTKEYS });

module.exports = {
  cameraHotkeyInfo,
  startCamera,
  stopCamera,
  onRecorderMessage,
  cameraCommand: command,
  setTeamCar: (t) => { team = t; },
  setHazardCar: (idx) => { hazardCar = idx; },
  cameraInfo: () => ({ state, hotkeys: { incident: display(keys.incident), back: display(keys.back) } }),
};

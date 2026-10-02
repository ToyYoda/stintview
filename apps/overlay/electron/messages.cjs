// Team messages ("Funk"): the spotter sends short texts with a colour to the team. Sent via
// the recorder's server connection; buttons in the "Radio" panel, the StintView window and
// global hotkeys (one per message). While you drive yourself the hotkeys are released, so they
// don't take keys away from iRacing, and the Radio panel hides itself.
const { BrowserWindow, globalShortcut } = require('electron');
const { displayKey } = require('./hotkeys.cjs');

const SLOTS = 9;
/** Per message slot: first free one wins (see overlay-window.cjs for why fallbacks are needed). */
const candidates = (n) => [`Control+Shift+${n}`, `Control+Alt+${n}`];
/** Ignore sends this soon after the previous one (double clicks, held hotkeys); the server also checks. */
const COOLDOWN_MS = 1000;

let post = () => false;
let messages = []; // [{ id, text, color }]
let driving = false;
let running = false;
/** Registered accelerator per slot index (null = none). */
let keys = [];
let lastSentAt = 0;

function broadcast() {
  const state = radioState();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('radio', state);
}

/** What the Radio panel and the StintView window show. */
function radioState() {
  return {
    driving,
    messages: messages.map((m, i) => ({ ...m, key: displayKey(keys[i] ?? null) })),
  };
}

/** Sends message `id` of the list, or a { text, color } given directly. */
function send(what) {
  const m = typeof what === 'string' ? messages.find((x) => x.id === what) : what;
  if (!m?.text) return false;
  const now = Date.now();
  if (now - lastSentAt < COOLDOWN_MS) return false;
  lastSentAt = now;
  return post({ t: 'send-message', text: m.text, color: m.color });
}

function unregister() {
  for (const k of keys) if (k) globalShortcut.unregister(k);
  keys = [];
}

/** Hotkeys only while running and not driving yourself. */
function register() {
  unregister();
  if (!running || driving) return;
  keys = messages.slice(0, SLOTS).map((m, i) =>
    candidates(i + 1).find((h) => globalShortcut.register(h, () => send(m.id))) ?? null);
}

function startMessages(postToRecorder) {
  post = postToRecorder;
  running = true;
  register();
  broadcast();
}

function stopMessages() {
  running = false;
  unregister();
}

/** New list from the settings. */
function setMessages(list) {
  if (JSON.stringify(list) === JSON.stringify(messages)) return;
  messages = list;
  register();
  broadcast();
}

/** This PC's user got in or out of the car. */
function setDriving(on) {
  if (on === driving) return;
  driving = on;
  register();
  broadcast();
}

/** For the hotkey overview: one item per message. */
function messageHotkeyInfo() {
  return messages.slice(0, SLOTS).map((m, i) => ({ label: m.text, key: keys[i] ?? null, candidates: candidates(i + 1) }));
}

module.exports = { startMessages, stopMessages, setMessages, setDriving, sendMessage: send, radioState, messageHotkeyInfo, isDriving: () => driving };

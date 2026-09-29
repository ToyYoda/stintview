// Team credentials (shared with the recorder) and app settings, both under %APPDATA%\StintView.
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');

// STINTVIEW_HOME redirects everything (tests, a second profile on one PC).
const dataDir = process.env.STINTVIEW_HOME ?? path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'StintView');
const configPath = () => process.env.STINTVIEW_CONFIG ?? path.join(dataDir, 'config.json');
const settingsPath = path.join(dataDir, 'app.json');
const logDir = path.join(dataDir, 'logs');

const DEFAULT_SETTINGS = {
  overlay: true, // desktop overlay window
  vr: false, // SteamVR panels
  autostart: true, // start with Windows
  server: false, // run the team relay on this PC
  serverPort: 8787,
  // Which displays show on the monitor overlay and as VR panels.
  panels: {
    header: { monitor: true, vr: true },
    inputs: { monitor: true, vr: true },
    fuel: { monitor: true, vr: true },
    tyres: { monitor: true, vr: true },
    weather: { monitor: true, vr: false },
  },
};
const PANEL_IDS = Object.keys(DEFAULT_SETTINGS.panels);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

/** { serverUrl, token, teamId, teamName, memberName, inviteCode } or null. */
const loadConfig = () => readJson(configPath());
const saveConfig = (c) => writeJson(configPath(), c);
const clearConfig = () => writeJson(configPath(), null);

function loadSettings() {
  const saved = readJson(settingsPath) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved, panels: cleanPanels(saved.panels) };
}

/** Known panel ids only, each with boolean monitor/vr flags (defaults for missing ones). */
function cleanPanels(p) {
  const out = {};
  for (const id of PANEL_IDS) {
    const d = DEFAULT_SETTINGS.panels[id];
    out[id] = { monitor: typeof p?.[id]?.monitor === 'boolean' ? p[id].monitor : d.monitor, vr: typeof p?.[id]?.vr === 'boolean' ? p[id].vr : d.vr };
  }
  return out;
}

const panelsFor = (settings, where) => PANEL_IDS.filter((id) => settings.panels[id]?.[where]);
const saveSettings = (s) => writeJson(settingsPath, s);

/** Joins or creates a team on the relay and stores the credentials. */
async function register(serverUrl, kind, body) {
  const url = new URL(kind === 'create' ? '/api/teams' : '/api/join', normalizeUrl(serverUrl));
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(`Server nicht erreichbar: ${url.origin}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error === 'unknown invite code' ? 'Unbekannter Einladungscode' : (json.error ?? `Fehler ${res.status}`));
  }
  const config = { ...json, serverUrl: url.origin };
  saveConfig(config);
  return config;
}

/** "beispiel.dyndns.org:8787" -> "http://beispiel.dyndns.org:8787" */
function normalizeUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error('Server-Adresse fehlt');
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error(`Ungültige Server-Adresse: ${s}`);
  }
}

module.exports = {
  dataDir, logDir, configPath, loadConfig, saveConfig, clearConfig, loadSettings, saveSettings, register, normalizeUrl,
  cleanPanels, panelsFor,
};

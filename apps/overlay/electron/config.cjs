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
};

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

const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(settingsPath) });
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
};

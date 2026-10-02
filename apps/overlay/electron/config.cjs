// Team credentials (shared with the recorder) and app settings, both under %APPDATA%\StintView.
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { systemLanguage, t } = require('./i18n.cjs');

// STINTVIEW_HOME redirects everything (tests, a second profile on one PC).
const dataDir = process.env.STINTVIEW_HOME ?? path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'StintView');
const configPath = () => process.env.STINTVIEW_CONFIG ?? path.join(dataDir, 'config.json');
const settingsPath = path.join(dataDir, 'app.json');
const logDir = path.join(dataDir, 'logs');

/** Columns of the Position panel that can be switched off. */
const STANDINGS_COLUMNS = ['pos', 'num', 'flag', 'name', 'best', 'gap', 'tyre', 'delta'];

/** Per panel: shown or not, size in percent of the normal size, panel-specific options. */
const PANEL_DEFAULTS = {
  header: { shown: true, size: 100 },
  inputs: { shown: true, size: 100 },
  fuel: { shown: true, size: 100 },
  tyres: { shown: true, size: 100 },
  weather: { shown: true, size: 100 },
  standings: {
    shown: true, size: 100,
    options: { columns: Object.fromEntries(STANDINGS_COLUMNS.map((c) => [c, true])), lapping: true, duel: true },
  },
  // Added later: off by default, so it does not suddenly appear on existing overlays.
  duel: { shown: false, size: 100, options: { traffic: true } },
  pitstop: { shown: true, size: 100 },
  // Team messages: received ones (everyone) and buttons to send (hidden while you drive).
  messages: { shown: false, size: 100 },
  radio: { shown: false, size: 100 },
};

/** Colours a team message can have (same list as the protocol's MESSAGE_COLORS). */
const MESSAGE_COLORS = ['red', 'amber', 'green', 'blue', 'purple', 'white'];
const MESSAGE_MAX_LENGTH = 60;
const MAX_MESSAGES = 12;
/** Messages a new installation starts with, in the UI language. */
const DEFAULT_MESSAGES = {
  de: [['Box diese Runde', 'red'], ['Sprit sparen', 'amber'], ['Push!', 'green'], ['Gelb voraus', 'amber'], ['Schnelleres Auto hinter dir', 'blue'], ['Gut so, weiter', 'green']],
  en: [['Box this lap', 'red'], ['Save fuel', 'amber'], ['Push!', 'green'], ['Yellow ahead', 'amber'], ['Faster car behind you', 'blue'], ['Good job, keep going', 'green']],
};

const DEFAULT_SETTINGS = {
  language: null, // 'de' | 'en'; null = from Windows
  overlay: true, // show the panels at all
  output: 'monitor', // where: 'monitor' (transparent window over iRacing) or 'vr' (SteamVR panels)
  autostart: true, // start with Windows
  server: false, // run the team relay on this PC
  serverPort: 8787,
  panels: PANEL_DEFAULTS,
  // Panel background opacity in percent, for all panels (text stays fully visible).
  opacity: 78,
  // Pit stop: rates null = measured at our own stops; regulation 'auto' = from the series.
  pitStop: { fillRate: null, tyreTime: null, regulation: 'auto' },
  // iRacing telemetry folder chosen for the pit lane import; null = Documents\\iRacing\\telemetry.
  telemetryDir: null,
  // Team messages to send (StintView window, "Radio" panel, hotkeys); null = defaults in the UI language.
  messages: null,
};
const PANEL_IDS = Object.keys(PANEL_DEFAULTS);

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
  // Up to 0.7: separate switches and panel ticks for monitor and VR. Now one output at a time.
  const legacy = saved.output === undefined;
  const output = legacy ? (saved.vr && saved.overlay === false ? 'vr' : 'monitor') : cleanOutput(saved.output);
  const { vr: _legacyVr, ...rest } = saved;
  return {
    ...DEFAULT_SETTINGS, ...rest,
    overlay: legacy ? (saved.overlay ?? true) || Boolean(saved.vr) : saved.overlay !== false,
    output,
    language: cleanLanguage(saved.language),
    panels: cleanPanels(saved.panels, output),
    opacity: cleanOpacity(typeof saved.opacity === 'object' && saved.opacity ? saved.opacity[output] : saved.opacity),
    pitStop: cleanPitStop(saved.pitStop),
    // Stays null until edited, so the defaults follow the UI language.
    messages: Array.isArray(saved.messages) ? cleanMessages(saved.messages) : null,
  };
}

/**
 * Team messages: { id, text, color }, at most MAX_MESSAGES, text trimmed and cut, unknown
 * colours white. Not a list (never edited) = the defaults in `language`.
 */
function cleanMessages(list, language = 'de') {
  if (!Array.isArray(list)) return DEFAULT_MESSAGES[language === 'en' ? 'en' : 'de'].map(([text, color], i) => ({ id: `m${i + 1}`, text, color }));
  const ids = new Set();
  const out = [];
  for (const m of list) {
    const text = typeof m?.text === 'string' ? m.text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX_LENGTH) : '';
    if (!text || out.length >= MAX_MESSAGES) continue;
    let id = typeof m.id === 'string' && /^[\w-]{1,20}$/.test(m.id) && !ids.has(m.id) ? m.id : '';
    for (let n = 1; !id; n++) if (!ids.has(`m${n}`)) id = `m${n}`;
    ids.add(id);
    out.push({ id, text, color: MESSAGE_COLORS.includes(m.color) ? m.color : 'white' });
  }
  return out;
}

const cleanOutput = (o) => (o === 'vr' ? 'vr' : 'monitor');
const cleanLanguage = (l) => (l === 'de' || l === 'en' ? l : systemLanguage());

/**
 * Known panel ids only, with shown/size/options (defaults for missing or invalid values).
 * `legacyOutput`: old settings had { monitor, vr } ticks – take the one for that output.
 */
function cleanPanels(p, legacyOutput = 'monitor') {
  const out = {};
  for (const id of PANEL_IDS) {
    const d = PANEL_DEFAULTS[id], v = p?.[id] ?? {};
    const shown = typeof v.shown === 'boolean' ? v.shown : typeof v[legacyOutput] === 'boolean' ? v[legacyOutput] : d.shown;
    const size = Number.isFinite(v.size) ? Math.min(250, Math.max(40, Math.round(v.size))) : d.size;
    out[id] = { shown, size };
    if (d.options) out[id].options = cleanOptions(id, v.options);
  }
  return out;
}

function cleanOptions(id, o) {
  const d = PANEL_DEFAULTS[id].options;
  if (id === 'standings') {
    const columns = {};
    for (const c of STANDINGS_COLUMNS) columns[c] = typeof o?.columns?.[c] === 'boolean' ? o.columns[c] : d.columns[c];
    const flag = (k) => (typeof o?.[k] === 'boolean' ? o[k] : d[k]);
    return { columns, lapping: flag('lapping'), duel: flag('duel') };
  }
  if (id === 'duel') return { traffic: typeof o?.traffic === 'boolean' ? o.traffic : d.traffic };
  return d;
}

/** Background opacity, whole percent 0–100. */
function cleanOpacity(o) {
  return Number.isFinite(o) ? Math.min(100, Math.max(0, Math.round(o))) : DEFAULT_SETTINGS.opacity;
}

/** Manual pit stop values: positive numbers or null; iRacing sporting regulation or auto. */
function cleanPitStop(p) {
  const num = (v, max) => (Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : null);
  return {
    fillRate: num(p?.fillRate, 50),
    tyreTime: num(p?.tyreTime, 300),
    regulation: ['auto', 'standard', 'imsa', 'nec', 'dtm'].includes(p?.regulation) ? p.regulation : 'auto',
  };
}

/** Panels switched on. */
const panelsFor = (settings) => PANEL_IDS.filter((id) => settings.panels[id]?.shown);
/** What the panel pages need: size factor and options per panel. */
const panelConfig = (settings) => Object.fromEntries(PANEL_IDS.map((id) => [id, {
  scale: settings.panels[id].size / 100, options: settings.panels[id].options ?? null,
}]));
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
    throw new Error(t('join.unreachable', { url: url.origin }));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error === 'unknown invite code' ? t('join.unknownCode') : (json.error ?? t('join.error', { status: res.status })));
  }
  const config = { ...json, serverUrl: url.origin };
  saveConfig(config);
  return config;
}

/** "beispiel.dyndns.org:8787" -> "http://beispiel.dyndns.org:8787" */
function normalizeUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error(t('join.noAddress'));
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error(t('join.badAddress', { address: s }));
  }
}

module.exports = {
  dataDir, logDir, configPath, loadConfig, saveConfig, clearConfig, loadSettings, saveSettings, register, normalizeUrl,
  cleanLanguage, cleanPanels, cleanOpacity, cleanOutput, cleanPitStop, cleanMessages, panelsFor, panelConfig, MESSAGE_COLORS,
};

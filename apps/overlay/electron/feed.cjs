// Data for the display pages (monitor overlay panels, VR panels) – since 0.25 from one place:
// one team relay connection here in the main process and this PC's own recorder data; each page
// subscribes with the message types its panel shows and gets only those (before, every panel
// window had its own connection, received everything and re-rendered for each message).
const path = require('node:path');
const { ipcMain, webContents } = require('electron');
const { setTeamCar } = require('./camera.cjs');

const BUNDLES = path.join(__dirname, '..', 'dist-bundles');
/** No page left (displays off, profile switch): the connection closes after this long. */
const LINGER_MS = 10_000;

/** webContents id -> Set of telemetry types (null = everything). */
const subscribers = new Map();
let loadConfig = () => null;
let serverTarget = () => Promise.reject(new Error('no team'));
let teamFeed = null;
let lingerTimer = null;

// Own recorder: latest message per type (not inputs), for pages that open later.
const localLatest = new Map();
/** The team streams another iRacing session: the displays show this PC's own data instead. */
let otherSession = false;

function bundle() {
  return require(path.join(BUNDLES, 'team-feed.cjs'));
}

/** Sends `msg` on `channel` to every page that wants it (as far as it wants it). */
function broadcast(channel, msg) {
  const { forDisplay } = bundle();
  for (const [id, types] of subscribers) {
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed()) {
      subscribers.delete(id);
      continue;
    }
    const part = typeof msg === 'object' ? forDisplay(msg, types) : msg;
    if (part) wc.send(channel, part);
  }
  if (!subscribers.size) lingerStop();
}

/** Lets the camera hotkeys know which car to jump back to (the team's car). */
function teamCar(m) {
  const sessions = m.t === 'session' ? [m] : m.t === 'snapshot' ? m.telemetry.filter((x) => x.t === 'session') : [];
  for (const s of sessions) setTeamCar({ carIdx: s.carIdx, carNumber: s.carNumber, sessionId: s.sessionId });
}

function startTeamFeed() {
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = null;
  if (teamFeed) return;
  const config = loadConfig();
  if (!config) return;
  const { TeamFeed } = bundle();
  teamFeed = new TeamFeed(serverTarget, config.token, {
    onMessage: (m) => {
      teamCar(m);
      broadcast('feed', m);
    },
    onState: (state) => broadcast('feed', state),
  });
  teamFeed.start();
}

function stopTeamFeed() {
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = null;
  teamFeed?.stop();
  teamFeed = null;
}

function lingerStop() {
  if (!teamFeed || lingerTimer) return;
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    if (!subscribers.size) stopTeamFeed();
  }, LINGER_MS);
}

/** A page subscribes; answers with everything so far (team and own), filtered for it. */
ipcMain.handle('feed:subscribe', (e, types) => {
  const wc = e.sender;
  const wanted = Array.isArray(types) ? new Set(types.map(String)) : null;
  if (!subscribers.has(wc.id)) wc.once('destroyed', () => {
    subscribers.delete(wc.id);
    if (!subscribers.size) lingerStop();
  });
  subscribers.set(wc.id, wanted);
  startTeamFeed();
  const { forDisplay } = bundle();
  const team = teamFeed?.snapshot() ?? null;
  return {
    team: team ? { state: team.state, snapshot: forDisplay(team.snapshot, wanted) } : null,
    local: [...localLatest.values()].map((m) => forDisplay(m, wanted)).filter(Boolean),
    prefer: otherSession,
  };
});

/** Team joined or left: connect again with the new access (or none). */
function restartTeamFeed() {
  stopTeamFeed();
  if (subscribers.size) startTeamFeed();
}

function setOtherSession(on) {
  if (on === otherSession) return;
  otherSession = on;
  broadcast('local-prefer', on);
}

/** A message of this PC's own recorder (what it would send the team). */
function onLocalTelemetry(msg) {
  if (msg.t === 'session') {
    // Another session: the old laps, standings etc. don't belong to it.
    const prev = localLatest.get('session');
    if (prev && (prev.sessionId !== msg.sessionId || prev.sessionType !== msg.sessionType)) localLatest.clear();
  }
  if (msg.t !== 'inputs' && msg.t !== 'send-message') localLatest.set(msg.t, msg);
  broadcast('local', msg);
}

/** Team messages via the recorder's connection (on time also when the relay feed lags). */
function onTeamMessage(msg) {
  broadcast('team-message', msg);
}

module.exports = {
  init: (opts) => { ({ loadConfig, serverTarget } = opts); },
  restartTeamFeed,
  setOtherSession,
  onLocalTelemetry,
  onTeamMessage,
  clearLocal: () => localLatest.clear(),
  localDriving: () => Boolean(localLatest.get('driving')?.driving),
  otherSession: () => otherSession,
};

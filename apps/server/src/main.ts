import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, isTelemetry, pack, unpack,
  type ClientMessage, type CreateTeamRequest, type JoinTeamRequest, type ServerMessage,
} from '@stintview/protocol';
import { Room, type Peer } from './room.ts';
import { TeamStore } from './store.ts';
import { PlannerStore } from './planner-store.ts';
import { plannerHandler } from './planner-api.ts';
import { loadOrCreateCert } from './tls-cert.ts';

const PORT = Number(process.env.PORT ?? 8787);
// Outside the program folder so replacing it on update keeps the teams.
const dataFile = process.env.STINTVIEW_DATA ??
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'StintView', 'server', 'teams.json');
const store = new TeamStore(dataFile);
const rooms = new Map<string, Room>();
// Stint planner (lap times, races) next to the teams; its page comes from the app's built UI.
const plannerFile = process.env.STINTVIEW_PLANNER_DATA ?? join(dirname(dataFile), 'planner.json');
const planner = new PlannerStore(plannerFile);
const devUi = resolve('..', 'overlay', 'dist'); // `pnpm relay` runs in apps/server
const plannerDir = process.env.STINTVIEW_PLANNER_DIR ?? (existsSync(join(devUi, 'planner.html')) ? devUi : null);
const plannerRoutes = plannerHandler({ teams: store, planner, staticDir: plannerDir, log: (m) => log(m) });
// Own certificate next to teams.json (since 0.26): back up the whole folder, or everyone joins again.
const tlsCert = loadOrCreateCert(dirname(dataFile));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { planner.flush(); process.exit(0); });
process.on('exit', () => planner.flush());

// ---------------------------------------------------------------------------
// HTTP: team management
// ---------------------------------------------------------------------------

async function readJson<T>(req: IncomingMessage): Promise<T> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error('body too large');
  }
  return JSON.parse(body) as T;
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const validName = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 64;

/**
 * Unencrypted only from this PC (the team manager's own app, health check). Everyone else needs
 * TLS: an old app gets told to update instead of sending its token in clear text.
 */
const encryptedOrLocal = (req: IncomingMessage) =>
  (req.socket as { encrypted?: boolean }).encrypted === true || /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
const NEEDS_UPDATE = 'encrypted connection required – update StintView';

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!encryptedOrLocal(req)) return reply(res, 426, { error: NEEDS_UPDATE });
  try {
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true, planner: true });
    if (await plannerRoutes(req, res)) return;
    if (req.method === 'POST' && req.url === '/api/teams') {
      const { teamName, memberName } = await readJson<CreateTeamRequest>(req);
      if (!validName(teamName) || !validName(memberName)) return reply(res, 400, { error: 'teamName and memberName required' });
      return reply(res, 201, store.createTeam(teamName.trim(), memberName.trim()));
    }
    if (req.method === 'POST' && req.url === '/api/join') {
      const { inviteCode, memberName } = await readJson<JoinTeamRequest>(req);
      if (typeof inviteCode !== 'string' || !validName(memberName)) return reply(res, 400, { error: 'inviteCode and memberName required' });
      const creds = store.join(inviteCode, memberName.trim());
      return creds ? reply(res, 200, creds) : reply(res, 404, { error: 'unknown invite code' });
    }
    reply(res, 404, { error: 'not found' });
  } catch {
    reply(res, 400, { error: 'bad request' });
  }
}

const plain = createServer(handle);
const secure = createTlsServer({ key: tlsCert.key, cert: tlsCert.cert }, handle);
// One port for both: a TLS handshake starts with byte 0x16, plain HTTP with a letter.
const front = createNetServer((socket) => {
  socket.on('error', () => {});
  socket.setTimeout(10_000, () => socket.destroy()); // connected but silent
  socket.once('data', (head) => {
    socket.setTimeout(0);
    socket.pause();
    socket.unshift(head);
    (head[0] === 0x16 ? secure : plain).emit('connection', socket);
    process.nextTick(() => socket.resume());
  });
});

// ---------------------------------------------------------------------------
// WebSocket: telemetry relay
// ---------------------------------------------------------------------------

const wsOptions = { path: '/ws', maxPayload: 256 * 1024 };
let nextId = 1;

/** Kept up to date by the recorders anyway: skipped for a connection that can't keep up. */
const DROPPABLE = new Set(['inputs', 'status', 'fuel', 'tyres', 'weather', 'standings', 'pitplan', 'hazard', 'session']);
/** Unsent bytes at which a slow overlay gets no more telemetry until it has caught up (since 0.20). */
const BACKLOG_BYTES = 256 * 1024;

for (const server of [plain, secure]) new WebSocketServer({ server, ...wsOptions }).on('connection', onConnection);

function onConnection(ws: WebSocket, req: IncomingMessage) {
  if (!encryptedOrLocal(req)) {
    // Old app (before 0.26) over the internet: it shows this and stops retrying until updated.
    ws.send(pack({ t: 'error', code: 'version', message: NEEDS_UPDATE } satisfies ServerMessage));
    return ws.close(4003, 'version');
  }
  const send = (msg: ServerMessage) => {
    if (ws.readyState !== ws.OPEN) return;
    // A busy PC (e.g. the driver's, in VR) reads its socket late: buffering everything delayed
    // team messages by minutes behind old telemetry (race 09.10.2026).
    if (ws.bufferedAmount > BACKLOG_BYTES && DROPPABLE.has(msg.t)) return;
    ws.send(pack(msg));
  };
  let peer: Peer | null = null;
  let room: Room | null = null;
  let role: 'recorder' | 'overlay' | null = null;
  let alive = true;
  let active = false;

  const authTimeout = setTimeout(() => ws.close(4001, 'auth timeout'), 5000);
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on('pong', () => { alive = true; });

  ws.on('message', (data, isBinary) => {
    let msg: ClientMessage;
    try {
      if (!isBinary) throw new Error('text frame');
      msg = unpack<ClientMessage>(data as Buffer);
    } catch {
      send({ t: 'error', code: 'protocol', message: 'invalid message' });
      return ws.close(4002, 'protocol');
    }

    if (!peer) {
      if (msg.t !== 'hello') return ws.close(4001, 'hello expected');
      clearTimeout(authTimeout);
      if (msg.v !== PROTOCOL_VERSION) {
        send({ t: 'error', code: 'version', message: `server speaks protocol v${PROTOCOL_VERSION}` });
        return ws.close(4003, 'version');
      }
      const id = store.authenticate(msg.token);
      if (!id) {
        send({ t: 'error', code: 'auth', message: 'invalid token' });
        return ws.close(4001, 'auth');
      }
      peer = { id: nextId++, memberName: id.memberName, send, messages: Array.isArray(msg.features) && msg.features.includes('messages') };
      role = msg.role;
      room = rooms.get(id.teamId) ?? new Room(id.teamId);
      rooms.set(id.teamId, room);
      send({ t: 'welcome', teamId: id.teamId, teamName: id.teamName, memberName: id.memberName });
      if (role === 'overlay') room.addOverlay(peer);
      else room.addRecorder(peer);
      log(`${role} connected: ${id.memberName} (${id.teamName})`);
      return;
    }

    if (msg.t === 'send-message' && room) {
      const sent = room.message(peer, msg.text, msg.color);
      if (sent) log(`message from ${peer.memberName}: ${sent.text}`);
      return;
    }
    if (role !== 'recorder' || !room) return; // overlays only listen (apart from team messages)
    if (msg.t === 'driving') {
      const wasActive = active;
      active = room.driving(peer, msg.driving, msg.driverName, msg.session);
      if (active !== wasActive) log(`${peer.memberName} ${active ? 'is now the active driver' : 'is no longer active'}`);
    } else if (isTelemetry(msg)) {
      room.telemetry(peer, msg);
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    clearInterval(ping);
    if (peer && room) {
      room.remove(peer.id);
      if (room.empty) rooms.delete(room.teamId);
      log(`${role} disconnected: ${peer.memberName}`);
    }
  });
}

// Free the "active driver" slot when its recorder went silent.
setInterval(() => {
  for (const room of rooms.values()) if (room.expire()) log(`active driver of team ${room.teamId} went silent – released`);
}, 2000);

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

front.listen(PORT, () => log(`StintView relay listening on :${PORT} (TLS, ws path /ws; unencrypted only from this PC), certificate ${tlsCert.fingerprint}, teams: ${dataFile}, planner page: ${plannerDir ?? 'none'}`));

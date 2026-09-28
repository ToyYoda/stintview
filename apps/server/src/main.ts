import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, isTelemetry, pack, unpack,
  type ClientMessage, type CreateTeamRequest, type JoinTeamRequest, type ServerMessage,
} from '@stintview/protocol';
import { Room, type Peer } from './room.ts';
import { TeamStore } from './store.ts';

const PORT = Number(process.env.PORT ?? 8787);
const store = new TeamStore(process.env.STINTVIEW_DATA ?? resolve('.data/teams.json'));
const rooms = new Map<string, Room>();

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

const http = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true });
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
});

// ---------------------------------------------------------------------------
// WebSocket: telemetry relay
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 256 * 1024 });
let nextId = 1;

wss.on('connection', (ws: WebSocket) => {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(pack(msg));
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
      peer = { id: nextId++, memberName: id.memberName, send };
      role = msg.role;
      room = rooms.get(id.teamId) ?? new Room(id.teamId);
      rooms.set(id.teamId, room);
      send({ t: 'welcome', teamId: id.teamId, teamName: id.teamName, memberName: id.memberName });
      if (role === 'overlay') room.addOverlay(peer);
      else room.addRecorder(peer);
      log(`${role} connected: ${id.memberName} (${id.teamName})`);
      return;
    }

    if (role !== 'recorder' || !room) return; // overlays only listen
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
});

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

http.listen(PORT, () => log(`StintView relay listening on :${PORT} (ws path /ws)`));

/**
 * Dev tool: pretends to be the driving recorder and raises "Unfall voraus" for ~15 s,
 * so the overlay banner can be checked without a live race.
 * Usage: tsx src/dev/fake-hazard.ts   (uses the normal config / STINTVIEW_CONFIG)
 */
import WebSocket from 'ws';
import { PROTOCOL_VERSION, pack, type ClientMessage } from '@stintview/protocol';
import { loadConfig, wsUrl } from '../config.ts';

const config = loadConfig();
if (!config) throw new Error('no config');
const ws = new WebSocket(wsUrl(config.serverUrl));
const send = (m: ClientMessage) => ws.send(pack(m));
const session = '999/999';

ws.on('open', async () => {
  ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: config.token, role: 'recorder' }));
  await new Promise((r) => setTimeout(r, 300));
  send({ t: 'driving', driving: true, driverName: 'Test Fahrer', session });
  send({
    t: 'session', track: 'Teststrecke', car: 'Testauto', driverName: 'Test Fahrer', teamName: 'Test',
    sessionType: 'Race', carIdx: 0, carNumber: 7, sessionId: session,
  });
  for (let i = 0; i < 30; i++) {
    const t = 1000 + i / 2;
    send({ t: 'status', sessionTime: t, lap: 3, lapDistPct: 0.4, fuelLevel: 50, onPitRoad: false, odometer: { LF: 0, RF: 0, LR: 0, RR: 0 }, flags: 0 });
    send({ t: 'hazard', active: i < 20, sessionTime: t, carIdx: 12, carNumber: 44, driverName: 'Crash Test', distance: 850 - i * 20, reason: 'slow', speed: 0 });
    // Standings sample: P1–P3, then three ahead of / behind the team car at P9.
    const row = (pos: number, lastLap: number, isTeam = false) => ({
      pos, carIdx: pos === 9 ? 0 : 100 + pos, number: String(pos * 3).padStart(2, '0'),
      name: isTeam ? 'Test Fahrer' : `Fahrer P${pos}`, lastLap, isTeam,
    });
    send({
      t: 'standings', sessionTime: t,
      rows: [row(1, 478.2), row(2, 479.9), row(3, 480.4), row(6, 481.3), row(7, 480.1), row(8, 482.6),
        row(9, 481.0, true), row(10, 480.7), row(11, 483.9), row(12, 481.0)],
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  send({ t: 'driving', driving: false, driverName: 'Test Fahrer', session });
  setTimeout(() => ws.close(), 300);
});

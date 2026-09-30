/**
 * Dev tool: sends a realistic-looking Position and Boxenstopp panel (fictitious names) for ~60 s,
 * e.g. for website screenshots. Pretends to be the driving recorder.
 * Usage: tsx src/dev/demo-standings.ts   (uses the normal config / STINTVIEW_CONFIG)
 */
import WebSocket from 'ws';
import { PROTOCOL_VERSION, pack, type ClientMessage, type StandingRow } from '@stintview/protocol';
import { loadConfig, wsUrl } from '../config.ts';

const config = loadConfig();
if (!config) throw new Error('no config');
const ws = new WebSocket(wsUrl(config.serverUrl));
const send = (m: ClientMessage) => ws.send(pack(m));
const session = '999/998';

// pos, number, country, name, gap (s), lapsGap, tyre laps, last lap, in pit
const DEMO: [number, string, string | null, string, number, number, number | null, number, boolean][] = [
  [1, '12', 'nl', 'Jens van Dijk', 0, 1, 14, 486.412, false],
  [2, '77', 'gb', 'Oliver Grant', 0, 1, 9, 487.905, false],
  [3, '4', 'de', 'Lukas Brandt', 0, 1, 21, 488.130, false],
  [6, '31', 'fr', 'Hugo Martin', 12.4, 0, 17, 489.822, false],
  [7, '58', 'at', 'Felix Gruber', 5.1, 0, 3, 487.210, false],
  [8, '19', 'it', 'Marco Rossi', 0.7, 0, 19, 490.518, false],
  [9, '42', 'de', 'Outcast Endurance', 0, 0, 18, 489.604, false],
  [10, '88', 'gb-eng', 'Sam Porter', -0.8, 0, 6, 488.977, false],
  [11, '7', 'ch', 'Nico Keller', -2.6, 0, null, 491.340, false],
  [12, '63', 'us', 'Ryan Cole', -9.3, 0, 0, 495.102, true],
];

ws.on('open', async () => {
  ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: config.token, role: 'recorder' }));
  await new Promise((r) => setTimeout(r, 300));
  send({ t: 'driving', driving: true, driverName: 'Outcast Endurance', session });
  const rows: StandingRow[] = DEMO.map(([pos, number, country, name, gap, lapsGap, tyreLaps, lastLap, inPit], i) => ({
    pos, carIdx: i, number, country, name, gap, lapsGap, tyreLaps, lastLap, inPit, isTeam: pos === 9,
  }));
  for (let i = 0; i < 120; i++) {
    send({ t: 'standings', sessionTime: 5000 + i / 2, rows });
    send({
      t: 'pitplan', sessionTime: 5000 + i / 2, fuel: 86, fuelTime: 34.4, tyres: 4, tyreTime: 16, repair: 0, optRepair: 0,
      simultaneous: true, fillRate: 2.5, stationary: 34.4, laneLoss: 19, laneSamples: 7, total: 53.4, source: 'measured', stops: 3,
      inPit: false,
      rejoin: {
        classPos: 11,
        ahead: [
          { carIdx: 21, number: '3', name: 'Tom Becker', country: 'de', sameClass: true, gap: 2.4, inPit: false },
          { carIdx: 22, number: '910', name: 'Paul Laurent', country: 'fr', sameClass: false, gap: 5.9, inPit: false },
        ],
        behind: [
          { carIdx: 23, number: '14', name: 'Erik Lindqvist', country: 'se', sameClass: true, gap: -1.1, inPit: false },
          { carIdx: 24, number: '27', name: 'Luca Moretti', country: 'it', sameClass: true, gap: -4.8, inPit: true },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  send({ t: 'driving', driving: false, driverName: 'Outcast Endurance', session });
  setTimeout(() => ws.close(), 300);
});

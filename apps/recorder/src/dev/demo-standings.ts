/**
 * Dev tool: sends a realistic-looking Position, Duel and Boxenstopp panel (fictitious names) for ~60 s,
 * e.g. for website screenshots. Pretends to be the driving recorder.
 * Usage: tsx src/dev/demo-standings.ts [--best]   (--best: qualifying view; uses the normal config / STINTVIEW_CONFIG)
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
  [8, '19', 'it', 'Marco Rossi', 2.9, 0, 19, 490.518, false],
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
  // Race session, so the fuel panel shows "to the finish".
  send({ t: 'session', track: 'Demo', car: 'GT3', driverName: 'Outcast Endurance', teamName: 'Outcast Endurance', sessionType: 'Race', carIdx: 6, carNumber: 42, sessionId: session });
  // Fuel: laps 8-15 of a GT3 stint (lap 11 with a pit stop), 51 l in the tank.
  const used = [3.48, 3.51, 3.45, 3.02, 3.52, 3.47, 3.47, 3.44];
  send({
    t: 'fuel', tankCapacity: 100,
    laps: used.map((u, k) => ({ lap: 8 + k, used: u, lapTime: 104 + k / 3, pit: k === 3 })),
  });
  for (let i = 0; i < 120; i++) {
    send({ t: 'status', sessionTime: 5000 + i / 2, lap: 16, lapDistPct: 0.3, fuelLevel: 51.2, onPitRoad: false, odometer: { LF: 30000, RF: 30000, LR: 30000, RR: 30000 }, flags: 0,
      // ~45 laps to go: two stops, or one fewer with a little fuel saving.
      timeRemain: 4700 - i / 2, lapsRemain: null, usableTank: 100 });
    const lapping: StandingRow[] = [
      { pos: 0, carIdx: 30, number: '211', name: 'Jonas Weber', country: 'de', lastLap: 512.4, isTeam: false, gap: 0.6, lapsGap: -1, tyreLaps: 9, inPit: false, lap: 'backmarker', otherClass: true },
      { pos: 0, carIdx: 31, number: '5', name: 'Henri Dubois', country: 'fr', lastLap: 452.2, isTeam: false, gap: -0.5, lapsGap: 1, tyreLaps: 4, inPit: false, lap: 'lapper', otherClass: true },
    ];
    // Duel panel: cars on other laps between us and our class neighbours, nearest first.
    const between = {
      ahead: [
        { ...lapping[0]!, lap: undefined },
        { pos: 0, carIdx: 32, number: '96', name: 'Mia Hoffmann', country: 'de', lastLap: 497.1, isTeam: false, gap: 2.1, lapsGap: -2, tyreLaps: 12, inPit: false, otherClass: false },
      ],
      behind: [{ ...lapping[1]!, lap: undefined }],
    };
    if (process.argv.includes('--best')) {
      // Qualifying view: ranking by best lap.
      const times = [125.104, 125.388, 125.412, 125.731, 125.802, 125.954, 126.020, 126.117, 126.390, 126.902];
      const best: StandingRow[] = rows.map((r, k) => ({
        ...r, pos: k < 3 ? k + 1 : k + 3, bestLap: times[k]!, gap: r.isTeam ? null : times[k]! - 126.020, lapsGap: 0, inPit: false,
      }));
      send({ t: 'standings', sessionTime: 5000 + i / 2, rows: best, mode: 'best', session: 'Qualifying' });
    } else {
      // Duel trend: we close in on #19 (about 2 s per lap), #88 drops back.
      const moving = rows.map((r) => (r.pos === 8 ? { ...r, gap: 2.9 - i * 0.002 } : r.pos === 10 ? { ...r, gap: -0.8 - i * 0.001 } : r));
      send({ t: 'standings', sessionTime: 5000 + i / 2, rows: moving, lapping, between });
    }
    send({
      t: 'pitplan', sessionTime: 5000 + i / 2, fuel: 86, fuelTime: 34.4, tyres: 4, tyreTime: 16, repair: 0, optRepair: 0,
      simultaneous: true, regulation: 'IMSA', regulationFrom: 'class', fillRate: 2.5, stationary: 34.4, laneLoss: 19, laneSamples: 7, laneFrom: 'measured', total: 53.4, source: 'rules', stops: 3,
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

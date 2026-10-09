/**
 * Dev tool: sends a realistic-looking Position, Duel and Boxenstopp panel (fictitious names) for ~60 s,
 * e.g. for website screenshots. Pretends to be the driving recorder.
 * Usage: tsx src/dev/demo-standings.ts [--best]   (--best: qualifying view; uses the normal config / STINTVIEW_CONFIG)
 */
import WebSocket from 'ws';
import { PROTOCOL_VERSION, pack, type ClientMessage, type StandingRow } from '@stintview/protocol';
import { loadConfig, wsUrl } from '../config.ts';
import { bestProjection, computeBestStandings, type BestLap, type CarInfo } from '../standings.ts';

const config = loadConfig();
if (!config) throw new Error('no config');
const ws = new WebSocket(wsUrl(config.serverUrl));
const send = (m: ClientMessage) => ws.send(pack(m));
// STINTVIEW_DEMO_SESSION=<SessionID/SubSessionID>: same session as another recorder (two drivers, one session).
const session = process.env.STINTVIEW_DEMO_SESSION ?? '999/998';

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

const best = process.argv.includes('--best');
// iRating, licence and tyre compound per demo car (by index): a mixed field, two cars still on wets.
const IR = [4812, 3950, 3620, 2870, 2410, 2655, 2390, 1985, 3105, 1720, 2240, 1890];
const LIC: [string, string][] = [['A 4.21', '#0153db'], ['A 3.12', '#0153db'], ['B 3.88', '#00c702'], ['A 2.67', '#0153db'], ['B 2.95', '#00c702'],
  ['C 3.40', '#feec04'], ['A 3.45', '#0153db'], ['B 1.98', '#00c702'], ['D 2.50', '#fc8a27'], ['B 4.02', '#00c702'], ['C 2.11', '#feec04'], ['A 1.87', '#0153db']];
const extra = (i: number) => ({ irating: IR[i % IR.length]!, license: { text: LIC[i % LIC.length]![0], color: LIC[i % LIC.length]![1] }, compound: i === 4 || i === 9 ? 'Wet' : 'Hard' });
// Qualifying field: the demo cars plus two more, best laps in order (car 6 = us).
const QUALI_TIMES = [125.104, 125.388, 125.412, 125.731, 125.802, 125.954, 126.020, 126.117, 126.390, 126.902, 125.55, 125.62];
const QUALI: BestLap[] = QUALI_TIMES.map((t, carIdx) => ({ carIdx, best: t, lastLap: t, classId: 0 }));
const QUALI_INFO = new Map<number, CarInfo>(DEMO.map(([, number, country, name], i) => [i, { number, name, country }]));
QUALI_INFO.set(10, { number: '23', name: 'Anna Lind', country: 'se' });
QUALI_INFO.set(11, { number: '9', name: 'Pablo Ruiz', country: 'es' });

ws.on('open', async () => {
  ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: config.token, role: 'recorder' }));
  await new Promise((r) => setTimeout(r, 300));
  send({ t: 'driving', driving: true, driverName: 'Outcast Endurance', session });
  const rows: StandingRow[] = DEMO.map(([pos, number, country, name, gap, lapsGap, tyreLaps, lastLap, inPit], i) => ({
    pos, carIdx: i, number, country, name, gap, lapsGap, tyreLaps, lastLap, inPit, isTeam: pos === 9, ...extra(i),
  }));
  // Race session, so the fuel panel shows "to the finish" (qualifying: no fuel plan, no pit stop panel).
  send({ t: 'session', track: 'Demo', car: 'GT3', driverName: 'Outcast Endurance', teamName: 'Outcast Endurance', sessionType: best ? 'Open Qualify' : 'Race', carIdx: 6, carNumber: 42, sessionId: session });
  // Fuel: laps 8-15 of a GT3 stint (lap 11 with a pit stop), 51 l in the tank.
  const used = [3.48, 3.51, 3.45, 3.02, 3.52, 3.47, 3.47, 3.44];
  send({
    t: 'fuel', tankCapacity: 100,
    laps: used.map((u, k) => ({ lap: 8 + k, used: u, lapTime: 104 + k / 3, pit: k === 3 })),
  });
  for (let i = 0; i < 120; i++) {
    // Claim the car every 2 s like the real recorder (the server may hand over otherwise).
    if (i % 4 === 0) send({ t: 'driving', driving: true, driverName: 'Outcast Endurance', session });
    send({ t: 'status', sessionTime: 5000 + i / 2, lap: 16, lapDistPct: 0.3, fuelLevel: 51.2, onPitRoad: false, odometer: { LF: 30000, RF: 30000, LR: 30000, RR: 30000 }, flags: 0,
      // ~45 laps to go: two stops, or one fewer with a little fuel saving.
      timeRemain: 4700 - i / 2, lapsRemain: null, usableTank: 100 });
    const lapping: StandingRow[] = [
      { pos: 0, carIdx: 30, number: '211', name: 'Jonas Weber', country: 'de', lastLap: 512.4, isTeam: false, gap: 0.6, lapsGap: -1, tyreLaps: 9, inPit: false, lap: 'backmarker', otherClass: true, irating: 1340, license: { text: 'D 3.10', color: '#fc8a27' }, compound: 'Hard' },
      { pos: 0, carIdx: 31, number: '5', name: 'Henri Dubois', country: 'fr', lastLap: 452.2, isTeam: false, gap: -0.5, lapsGap: 1, tyreLaps: 4, inPit: false, lap: 'lapper', otherClass: true, irating: 5120, license: { text: 'P 4.99', color: '#828287' }, compound: 'Soft' },
    ];
    // Duel panel: cars on other laps between us and our class neighbours, nearest first.
    const between = {
      ahead: [
        { ...lapping[0]!, lap: undefined },
        { pos: 0, carIdx: 32, number: '96', name: 'Mia Hoffmann', country: 'de', lastLap: 497.1, isTeam: false, gap: 2.1, lapsGap: -2, tyreLaps: 12, inPit: false, otherClass: false },
      ],
      behind: [{ ...lapping[1]!, lap: undefined }],
    };
    if (best) {
      // Qualifying view: official ranking by best lap; the lap in progress goes from 0.3 s down to
      // 0.9 s up on our best (126.020, P9), so the projected position climbs.
      const lapTime = 126.020 + 0.3 - i * 0.01;
      send({
        t: 'standings', sessionTime: 5000 + i / 2, mode: 'best', session: 'Qualifying',
        rows: computeBestStandings(QUALI, 6, QUALI_INFO).map((r) => ({ ...r, ...extra(r.carIdx) })), projection: bestProjection(QUALI, 6, QUALI_INFO, lapTime) ?? undefined,
      });
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
          { carIdx: 21, number: '3', name: 'Tom Becker', country: 'de', sameClass: true, gap: 2.4, inPit: false, pos: 10, laps: 0 },
          { carIdx: 22, number: '910', name: 'Paul Laurent', country: 'fr', sameClass: false, gap: 5.9, inPit: false, pos: 6, laps: 1 },
        ],
        behind: [
          { carIdx: 23, number: '14', name: 'Erik Lindqvist', country: 'se', sameClass: true, gap: -1.1, inPit: false, pos: 23, laps: -1 },
          { carIdx: 24, number: '27', name: 'Luca Moretti', country: 'it', sameClass: true, gap: -4.8, inPit: true, pos: 12, laps: 0 },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  send({ t: 'driving', driving: false, driverName: 'Outcast Endurance', session });
  setTimeout(() => ws.close(), 300);
});

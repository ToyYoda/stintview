// Dev tool: reads the live iRacing telemetry once (read only, like the recorder) and prints what
// the Relative panel would show plus the raw values of the cars around this PC's car.
//   npx tsx src/dev/relative-live.ts
import { LiveSource } from '../irsdk/live.ts';
import type { Frame } from '../irsdk/layout.ts';
import { parseSessionCars } from '../spectator.ts';
import { lapRefOf, readProgress, relativeRows, type CarInfo } from '../standings.ts';

const src = new LiveSource();
let info = new Map<number, CarInfo>();
let frames = 0;
src.start(
  (f: Frame) => {
    if (++frames < 30 || info.size === 0) return; // a few frames in, session info read
    src.stop();
    const teamIdx = f.num('PlayerCarIdx');
    const all = readProgress(f, (i) => info.get(i)?.estLap ?? null);
    const cars = all.filter((c) => !info.get(c.carIdx)?.notRacing);
    const team = cars.find((c) => c.carIdx === teamIdx);
    const n = Math.min(f.count('CarIdxLapCompleted'), f.count('CarIdxLapDistPct'));
    console.log(`player ${teamIdx}, cars in telemetry ${n}, read ${all.length}, racing ${cars.length}, team found: ${Boolean(team)}`);
    console.log('team', JSON.stringify(team));
    // Raw values of every car physically near us (±10 % of a lap), including skipped ones.
    const myPct = f.num('CarIdxLapDistPct', teamIdx);
    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      const pct = f.num('CarIdxLapDistPct', i);
      if (!(pct >= 0)) continue;
      let o = pct - myPct;
      if (o > 0.5) o -= 1;
      if (o < -0.5) o += 1;
      if (Math.abs(o) > 0.1) continue;
      const d = info.get(i);
      rows.push(`${o.toFixed(4).padStart(8)}  car ${String(i).padStart(2)} #${(d?.number ?? '?').padEnd(4)} lc ${f.num('CarIdxLapCompleted', i)} pct ${pct.toFixed(4)} est ${f.num('CarIdxEstTime', i).toFixed(1)} last ${f.num('CarIdxLastLapTime', i).toFixed(2)} pit ${f.num('CarIdxOnPitRoad', i)} class ${f.num('CarIdxClass', i)} ${d?.notRacing ? 'NOT RACING' : ''} ${d?.className ?? ''}`);
    }
    console.log('--- cars within ±10 % of a lap (offset, + = in front) ---');
    console.log(rows.sort((a, b) => parseFloat(b) - parseFloat(a)).join('\n'));
    const rel = relativeRows(cars, teamIdx, info, lapRefOf(team), 5);
    console.log('--- Relative panel ---');
    for (const r of rel) console.log(`${r.isTeam ? '>>' : '  '} P${r.pos} #${r.number} ${r.name.padEnd(22)} gap ${r.gap == null ? '–' : r.gap.toFixed(1)} ${r.lap ?? ''} ${r.inPit ? 'PIT' : ''}`);
    process.exit(0);
  },
  (yaml) => {
    const s = parseSessionCars(yaml);
    info = new Map([...s.drivers].map(([idx, d]) => [idx, { number: d.label, name: d.name, estLap: d.estLap, className: d.className, classColor: d.classColor, classSpeed: d.classSpeed, notRacing: d.notRacing }]));
  },
);
setTimeout(() => { console.log('no iRacing frames'); process.exit(1); }, 10000);

/**
 * Dev tool: time lost braking into the pit box and accelerating back to the pit speed limit,
 * compared with driving through at the limit, from .ibt files (own car, stops only).
 * Usage: tsx src/dev/stopstart-from-ibt.ts <telemetry dir>
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IbtSource } from '../irsdk/ibt.ts';

interface S { t: number; v: number; pit: boolean }

const dir = process.argv[2];
if (!dir) throw new Error('usage: stopstart-from-ibt.ts <dir>');
const results: { file: string; limit: number; brake: number; accel: number; lost: number }[] = [];

for (const name of readdirSync(dir).filter((n) => n.endsWith('.ibt'))) {
  let src: IbtSource;
  try { src = new IbtSource(join(dir, name)); } catch { continue; }
  const s: S[] = [];
  for (let i = 0; i < src.recordCount; i++) {
    const f = src.frame(i);
    s.push({ t: f.num('SessionTime'), v: f.num('Speed'), pit: f.num('OnPitRoad') === 1 });
  }
  src.close();
  for (let i = 1; i < s.length; i++) {
    if (!s[i]!.pit || s[i - 1]!.pit) continue;
    let j = i;
    while (j < s.length && s[j]!.pit) j++;
    const lane = s.slice(i, j);
    i = j;
    const stopAt = lane.findIndex((x) => x.v < 0.5);
    if (stopAt < 0) continue; // drive-through
    let stopEnd = stopAt;
    while (stopEnd < lane.length && lane[stopEnd]!.v < 0.5) stopEnd++;
    // Pit speed limit: the most common speed while moving in the lane.
    const moving = lane.filter((x) => x.v > 5).map((x) => x.v).sort((a, b) => a - b);
    if (moving.length < 60) continue;
    const limit = moving[Math.floor(moving.length * 0.75)]!;
    // Braking phase: from the last moment at the limit before the stop.
    let b0 = stopAt;
    while (b0 > 0 && lane[b0 - 1]!.v < limit * 0.97) b0--;
    let a1 = stopEnd;
    while (a1 < lane.length && lane[a1]!.v < limit * 0.97) a1++;
    if (b0 === 0 || a1 >= lane.length) continue;
    const lost = (from: number, to: number) => {
      let dist = 0;
      for (let k = from + 1; k <= to; k++) dist += ((lane[k]!.v + lane[k - 1]!.v) / 2) * (lane[k]!.t - lane[k - 1]!.t);
      return lane[to]!.t - lane[from]!.t - dist / limit;
    };
    const brake = lost(b0, stopAt);
    const accel = lost(stopEnd, a1);
    results.push({ file: name.slice(0, 48), limit: Math.round(limit * 36) / 10, brake: Math.round(brake * 10) / 10, accel: Math.round(accel * 10) / 10, lost: Math.round((brake + accel) * 10) / 10 });
  }
}
console.table(results);
const lost = results.map((r) => r.lost).sort((a, b) => a - b);
if (lost.length) console.log(`median ${lost[Math.floor(lost.length / 2)]} s, min ${lost[0]} s, max ${lost.at(-1)} s over ${lost.length} stops`);

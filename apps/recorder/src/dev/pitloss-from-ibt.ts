/**
 * Dev tool: pit lane loss per track from .ibt files (see ../pitlane-import.ts).
 * Usage: tsx src/dev/pitloss-from-ibt.ts <telemetry dir> [out.json]
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { passesInFile, type PitPass } from '../pitlane-import.ts';

const round = (x: number) => Math.round(x * 10) / 10;
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : null;
};

if (process.argv[2]) {
  const dir = process.argv[2];
  const all: PitPass[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.ibt'))) {
    try {
      const found = passesInFile(join(dir, name));
      all.push(...found);
      if (found.length) console.error(`${name}: ${found.map((p) => p.loss).join(', ')} s`);
    } catch (e) {
      console.error(`${name}: ${(e as Error).message}`);
    }
  }
  const byTrack = new Map<string, PitPass[]>();
  for (const p of all) byTrack.set(`${p.track}|${p.trackName}`, [...(byTrack.get(`${p.track}|${p.trackName}`) ?? []), p]);
  const summary = [...byTrack.entries()].map(([k, ps]) => {
    const [track, name] = k.split('|');
    const losses = ps.map((p) => p.loss);
    return { track, name, median: round(median(losses)!), min: Math.min(...losses), max: Math.max(...losses), passes: ps.length, classes: [...new Set(ps.map((p) => p.carClass))] };
  }).sort((a, b) => a.name!.localeCompare(b.name!));
  console.table(summary);
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ summary, passes: all }, null, 2));
}

/**
 * Dev tool: pit lane loss per track from .ibt files – for every drive through the pit lane
 * of your own car: time between the cones − standing still − the same stretch on a clean lap.
 * Usage: tsx src/dev/pitloss-from-ibt.ts <telemetry dir> [out.json]
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { IbtSource } from '../irsdk/ibt.ts';

interface Sample { t: number; prog: number; onPit: boolean; speed: number; onTrack: boolean }
export interface PitPass { track: string; trackName: string; carClass: string; car: string; event: string; file: string; loss: number; lane: number; stationary: number; normal: number }

const STEP = 6; // 10 Hz at 60 Hz recording

function meta(yaml: string) {
  let y: any = {};
  try { y = parse(yaml, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {}; } catch { /* ignore */ }
  const wi = y.WeekendInfo ?? {}, di = y.DriverInfo ?? {};
  const me = (di.Drivers ?? []).find((d: any) => d.CarIdx === di.DriverCarIdx) ?? {};
  return {
    track: String(wi.TrackID ?? ''),
    trackName: `${wi.TrackDisplayName ?? ''}${wi.TrackConfigName ? ` – ${wi.TrackConfigName}` : ''}`,
    carClass: String(me.CarClassShortName ?? ''),
    car: String(me.CarScreenName ?? ''),
    event: String(wi.EventType ?? ''),
  };
}

/** Time at which `prog` (laps + fraction) is first reached, linearly interpolated. */
function timeAt(s: Sample[], from: number, prog: number) {
  for (let i = Math.max(1, from); i < s.length; i++) {
    if (s[i - 1]!.prog < prog && s[i]!.prog >= prog) {
      const a = s[i - 1]!, b = s[i]!;
      return a.t + ((prog - a.prog) / (b.prog - a.prog)) * (b.t - a.t);
    }
  }
  return null;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : null;
};

export function passesInFile(path: string): PitPass[] {
  const src = new IbtSource(path) as unknown as { records: number; frame(i: number): any; header: any; close(): void };
  const m = meta((src as unknown as { yaml: string }).yaml);
  const s: Sample[] = [];
  for (let i = 0; i < src.records; i += STEP) {
    const f = src.frame(i);
    s.push({ t: f.num('SessionTime'), prog: f.num('Lap') + f.num('LapDistPct'), onPit: f.num('OnPitRoad') === 1, speed: f.num('Speed'), onTrack: f.num('IsOnTrack') === 1 });
  }
  src.close();

  // Pit lane passes: entered from the track and left onto the track.
  const passes: { a: number; b: number }[] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i]!.onPit && !s[i - 1]!.onPit) {
      let j = i;
      while (j < s.length && s[j]!.onPit) j++;
      const before = s.slice(Math.max(0, i - 50), i), after = s.slice(j, j + 50);
      if (j < s.length && before.length === 50 && after.length === 50 && before.every((x) => x.onTrack && x.speed > 8) && after.every((x) => x.onTrack)) {
        passes.push({ a: i, b: j });
      }
      i = j;
    }
  }
  if (!passes.length) return [];

  // Clean laps: whole laps with no pit lane and a normal lap time.
  const lapStarts = new Map<number, number>();
  for (let i = 0; i < s.length; i++) {
    const lap = Math.floor(s[i]!.prog);
    if (!lapStarts.has(lap)) lapStarts.set(lap, i);
  }
  const laps = [...lapStarts.keys()].sort((a, b) => a - b);
  const clean: { lap: number; i0: number; i1: number; time: number }[] = [];
  for (let k = 0; k + 1 < laps.length; k++) {
    const lap = laps[k]!, i0 = lapStarts.get(lap)!, i1 = lapStarts.get(laps[k + 1]!)!;
    if (laps[k + 1] !== lap + 1 || lap < 1) continue;
    const seg = s.slice(i0, i1 + 1);
    if (seg.some((x) => x.onPit || !x.onTrack)) continue;
    clean.push({ lap, i0, i1, time: s[i1]!.t - s[i0]!.t });
  }
  const typical = median(clean.map((c) => c.time));
  const good = typical ? clean.filter((c) => c.time < typical * 1.07) : [];
  if (good.length < 2) return [];

  return passes.flatMap(({ a, b }) => {
    const entry = s[a]!, exit = s[b]!;
    const pe = entry.prog % 1, px = exit.prog % 1;
    const stretch = ((px - pe) % 1 + 1) % 1; // fraction of a lap between the cones
    const normals = good.map((c) => {
      const t0 = timeAt(s, c.i0, c.lap + pe), t1 = timeAt(s, c.i0, c.lap + pe + stretch);
      return t0 !== null && t1 !== null ? t1 - t0 : null;
    }).filter((x): x is number => x !== null);
    const normal = median(normals);
    if (normal === null) return [];
    let stationary = 0;
    for (let i = a + 1; i <= b; i++) if (s[i]!.speed < 0.5) stationary += s[i]!.t - s[i - 1]!.t;
    const lane = exit.t - entry.t;
    const loss = lane - stationary - normal;
    if (loss < 3 || loss > 120) return [];
    return [{ ...m, file: path.split(/[\\/]/).pop()!, loss: round(loss), lane: round(lane), stationary: round(stationary), normal: round(normal) }];
  });
}

const round = (x: number) => Math.round(x * 10) / 10;

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

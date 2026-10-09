/**
 * Pit lane loss from old .ibt files: for every drive of our own car through the pit lane,
 * time between the cones − standing still − the same stretch on a clean lap of that file
 * (+ STOP_START_S for a pass without stopping).
 * Used by the "Boxengassen-Zeiten einlesen" button (recorder command import-pitlane) and
 * the dev tool src/dev/pitloss-from-ibt.ts.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { IbtSource } from './irsdk/ibt.ts';
import { STOP_START_S, type PitModelStore } from './pitstop.ts';

interface Sample { t: number; prog: number; onPit: boolean; speed: number; onTrack: boolean }
export interface PitPass { track: string; trackName: string; carClass: string; car: string; event: string; file: string; loss: number; lane: number; stationary: number; normal: number }

const STEP = 6; // 10 Hz at 60 Hz recording

interface Yaml {
  WeekendInfo?: { TrackID?: number; TrackDisplayName?: string; TrackConfigName?: string; EventType?: string };
  DriverInfo?: { DriverCarIdx?: number; Drivers?: { CarIdx?: number; CarClassShortName?: string; CarScreenName?: string }[] };
}

function meta(yaml: string) {
  let y: Yaml = {};
  try { y = parse(yaml, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {}; } catch { /* ignore */ }
  const wi = y.WeekendInfo ?? {}, di = y.DriverInfo ?? {};
  const me = (di.Drivers ?? []).find((d) => d.CarIdx === di.DriverCarIdx) ?? {};
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

/** Every drive of our own car through the pit lane in one .ibt file, with its time loss. */
export function passesInFile(path: string): PitPass[] {
  const src = new IbtSource(path);
  const m = meta(src.sessionInfo);
  const s: Sample[] = [];
  for (let i = 0; i < src.recordCount; i += STEP) {
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
    // Without a stop, braking into the box and pulling away are missing.
    const loss = lane - stationary - normal + (stationary < 0.5 ? STOP_START_S : 0);
    if (loss < 3 || loss > 120) return [];
    return [{ ...m, file: path.split(/[\\/]/).pop()!, loss: round(loss), lane: round(lane), stationary: round(stationary), normal: round(normal) }];
  });
}

const round = (x: number) => Math.round(x * 10) / 10;

export interface ImportProgress { done: number; total: number; passes: number; tracks: number; file?: string }

/**
 * Reads all .ibt files in `dir` not imported before (oldest first) and adds the passes to
 * the store. Yields between files so progress messages get out.
 */
export async function importArchive(dir: string, store: PitModelStore, progress: (p: ImportProgress) => void) {
  const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.ibt') && !store.isImported(n))
    .map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t).map((x) => x.n);
  const byTrack = new Map<string, number[]>();
  const read: string[] = [];
  let passes = 0;
  for (const [i, name] of files.entries()) {
    try {
      for (const p of passesInFile(join(dir, name))) {
        byTrack.set(p.track, [...(byTrack.get(p.track) ?? []), p.loss]);
        passes++;
      }
      read.push(name);
    } catch { /* unreadable or still being written: try again next time */ }
    progress({ done: i + 1, total: files.length, passes, tracks: byTrack.size, file: name });
    await new Promise((r) => setImmediate(r));
  }
  store.importLaneLosses(byTrack, read);
  return { files: files.length, passes, tracks: byTrack.size };
}

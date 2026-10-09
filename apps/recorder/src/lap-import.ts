/**
 * Lap times from old .ibt files for the stint planner ("Rundenzeiten einlesen", recorder
 * command import-laps). The files hold only this PC's user's own driving. Files whose time
 * span already has live-recorded laps on that track are skipped (no laps twice).
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { LapRecord } from '@stintview/planner';
import { IbtSource } from './irsdk/ibt.ts';
import { trackName } from './session.ts';
import { newLapId, sessionKind, type LapLog } from './laps.ts';

const STEP = 6; // 10 Hz at 60 Hz recording; lap ends are interpolated

interface Yaml {
  WeekendInfo?: { TrackID?: number; TrackDisplayName?: string; TrackConfigName?: string };
  SessionInfo?: { Sessions?: { SessionType?: string }[] };
  DriverInfo?: { DriverCarIdx?: number; DriverCarFuelMaxLtr?: number; DriverCarMaxFuelPct?: number; Drivers?: { CarIdx?: number; CarID?: number; CarScreenName?: string }[] };
}

/** Laps driven in one .ibt file: whole laps on track without pit road, with fuel used. */
export function lapsInFile(path: string): { laps: LapRecord[]; from: number; to: number; track: number } {
  const src = new IbtSource(path);
  try {
    let y: Yaml = {};
    try { y = parse(src.sessionInfo, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {}; } catch { /* ignore */ }
    const di = y.DriverInfo ?? {};
    const me = (di.Drivers ?? []).find((d) => d.CarIdx === di.DriverCarIdx);
    const track = y.WeekendInfo?.TrackID ?? 0, car = me?.CarID ?? 0;
    const to = statSync(path).mtimeMs;
    const from = to - src.durationMinutes * 60_000;
    const atRecord = (i: number) => Math.round(from + (i / src.recordCount) * (to - from));
    if (!track || !car) return { laps: [], from, to, track };
    const base = {
      track, trackName: trackName(y.WeekendInfo), car, carName: me?.CarScreenName ?? '',
      tank: Math.round((di.DriverCarFuelMaxLtr ?? 0) * (di.DriverCarMaxFuelPct ?? 1) * 100) / 100,
    };
    const types = (y.SessionInfo?.Sessions ?? []).map((s) => s.SessionType);

    const laps: LapRecord[] = [];
    let lapStart: number | null = null; // interpolated session time of the start line
    let used = 0, clean = true, wet = false, prev: { t: number; prog: number; fuel: number; session: number } | null = null;
    for (let i = 0; i < src.recordCount; i += STEP) {
      const f = src.frame(i);
      const s = { t: f.num('SessionTime'), prog: f.num('Lap') + f.num('LapDistPct'), fuel: f.num('FuelLevel'), session: f.num('SessionNum') };
      const onTrack = f.num('IsOnTrack') === 1;
      if (!prev || s.session !== prev.session || s.t < prev.t || !onTrack) {
        // New session, time jump or out of the car: the lap in progress doesn't count.
        lapStart = null;
        prev = onTrack ? s : null;
        continue;
      }
      if (s.fuel < prev.fuel) used += prev.fuel - s.fuel;
      if (f.num('OnPitRoad') === 1) clean = false;
      if (f.has('TrackWetness') && f.num('TrackWetness') >= 3) wet = true;
      const a = Math.floor(prev.prog), b = Math.floor(s.prog);
      if (b !== a) {
        const cross = b === a + 1 && s.prog > prev.prog ? prev.t + ((b - prev.prog) / (s.prog - prev.prog)) * (s.t - prev.t) : null;
        if (cross !== null && lapStart !== null && clean && a >= 1) {
          laps.push({
            id: newLapId(), ...base, time: Math.round((cross - lapStart) * 1000) / 1000, fuel: Math.round(used * 1000) / 1000,
            at: atRecord(i), session: sessionKind(types[s.session]), wet, src: 'ibt',
          });
        }
        lapStart = cross;
        used = 0;
        clean = f.num('OnPitRoad') !== 1;
        wet = false;
      }
      prev = s;
    }
    return { laps: laps.filter((l) => l.time > 10), from, to, track };
  } finally {
    src.close();
  }
}

export interface LapImportProgress { done: number; total: number; laps: number; tracks: number; file?: string }

/** Reads all .ibt files in `dir` not imported before (oldest first) into the lap log. */
export async function importLapArchive(dir: string, log: LapLog, progress: (p: LapImportProgress) => void) {
  const known = log.read();
  const imported = new Set(known.importedFiles);
  const live = known.laps.filter((l) => l.src === 'live');
  const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.ibt') && !imported.has(n))
    .map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t).map((x) => x.n);
  const tracks = new Set<number>();
  let count = 0;
  for (const [i, name] of files.entries()) {
    try {
      const r = lapsInFile(join(dir, name));
      const overlaps = live.some((l) => l.track === r.track && l.at >= r.from - 60_000 && l.at <= r.to + 60_000);
      const laps = overlaps ? [] : r.laps;
      log.add(laps, [name]);
      count += laps.length;
      for (const l of laps) tracks.add(l.track);
    } catch { /* unreadable or still being written: try again next time */ }
    progress({ done: i + 1, total: files.length, laps: count, tracks: tracks.size, file: name });
    await new Promise((r) => setImmediate(r));
  }
  return { files: files.length, laps: count, tracks: tracks.size };
}

import type { StandingRow, Standings } from '@stintview/protocol';
import type { Frame } from './irsdk/layout.ts';

export interface CarProgress {
  carIdx: number;
  /** Laps completed + fraction of the current lap: the running order on track. */
  progress: number;
  /** Last lap time in seconds, null if none yet. */
  lastLap: number | null;
  classId: number;
}

export interface CarInfo { number: string; name: string }

/**
 * Running order on track (not iRacing's once-per-lap official position), within the team
 * car's class when there are several classes. Returns P1–P`top` plus `around` cars ahead of
 * and behind the team car, without duplicates, in position order.
 */
export function computeStandings(
  cars: CarProgress[], teamIdx: number, info: Map<number, CarInfo>, top = 3, around = 3,
): StandingRow[] {
  const team = cars.find((c) => c.carIdx === teamIdx);
  if (!team) return [];
  const field = cars
    .filter((c) => c.classId === team.classId)
    .sort((a, b) => b.progress - a.progress);
  const at = field.findIndex((c) => c.carIdx === teamIdx);
  const wanted = new Set<number>();
  for (let i = 0; i < Math.min(top, field.length); i++) wanted.add(i);
  for (let i = Math.max(0, at - around); i <= Math.min(field.length - 1, at + around); i++) wanted.add(i);
  return [...wanted].sort((a, b) => a - b).map((i) => {
    const c = field[i]!;
    const d = info.get(c.carIdx);
    return {
      pos: i + 1,
      carIdx: c.carIdx,
      number: d?.number ?? '?',
      name: d?.name ?? '',
      lastLap: c.lastLap,
      isTeam: c.carIdx === teamIdx,
    };
  });
}

/** Reads all cars from a telemetry frame; cars not on the track (pct < 0) are skipped. */
export function readProgress(f: Frame): CarProgress[] {
  const n = Math.min(f.count('CarIdxLapCompleted'), f.count('CarIdxLapDistPct'));
  const out: CarProgress[] = [];
  for (let i = 0; i < n; i++) {
    const pct = f.num('CarIdxLapDistPct', i);
    const laps = f.num('CarIdxLapCompleted', i);
    if (!(pct >= 0) || !(laps >= 0)) continue;
    const last = f.has('CarIdxLastLapTime') ? f.num('CarIdxLastLapTime', i) : -1;
    out.push({
      carIdx: i,
      progress: laps + pct,
      lastLap: last > 0 ? last : null,
      classId: f.has('CarIdxClass') ? f.num('CarIdxClass', i) : 0,
    });
  }
  return out;
}

const SEND_EVERY_S = 1;

/** Builds the "standings" message about once per second while driving. */
export class StandingsTracker {
  private info = new Map<number, CarInfo>();
  private lastSent = -Infinity;

  setDrivers(info: Map<number, CarInfo>) {
    this.info = info;
  }

  onFrame(f: Frame): Standings | null {
    const t = f.num('SessionTime');
    if (t - this.lastSent < SEND_EVERY_S && t >= this.lastSent) return null;
    this.lastSent = t;
    const teamIdx = f.num('PlayerCarIdx');
    const rows = computeStandings(readProgress(f), teamIdx, this.info);
    return rows.length ? { t: 'standings', sessionTime: t, rows } : null;
  }
}

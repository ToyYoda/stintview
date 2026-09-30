import type { StandingRow, Standings } from '@stintview/protocol';
import type { Frame } from './irsdk/layout.ts';

export interface CarProgress {
  carIdx: number;
  /** Laps completed + fraction of the current lap: the running order on track. */
  progress: number;
  /** Last lap time in seconds, null if none yet. */
  lastLap: number | null;
  classId: number;
  /** iRacing's estimate of the time from the start/finish line to the car's current spot, null if unknown. */
  estTime?: number | null;
  onPitRoad?: boolean;
}

export interface CarInfo { number: string; name: string; /** ISO code for the flag, e.g. "de". */ country?: string | null }

export interface StandingsExtras {
  /** Tyre age in laps per carIdx (null = unknown). */
  tyreLaps?: (carIdx: number) => number | null;
}

/**
 * Time gap from the team car to `car` along the track in seconds; positive = `car` is ahead.
 * Uses iRacing's per-car time estimate (accounts for slow and fast sections) and the team
 * car's last lap to bridge the start/finish line; falls back to distance × lap time.
 * Returns null without a reference lap time.
 */
export function trackGap(car: CarProgress, team: CarProgress, lapRef: number | null): number | null {
  const dp = car.progress - team.progress;
  const laps = Math.trunc(dp);
  const est = car.estTime, ownEst = team.estTime;
  if (est != null && ownEst != null && est >= 0 && ownEst >= 0) {
    let dt = est - ownEst; // same lap: time between the two spots
    const rest = dp - laps; // fraction of a lap between the cars, beyond whole laps
    if (lapRef) {
      if (rest > 0 && dt < 0) dt += lapRef; // car is ahead across the line
      if (rest < 0 && dt > 0) dt -= lapRef; // car is behind across the line
      return dt + laps * lapRef;
    }
    return laps === 0 && Math.sign(dt) === Math.sign(rest) ? dt : null;
  }
  return lapRef ? dp * lapRef : null;
}

/**
 * Running order on track (not iRacing's once-per-lap official position), within the team
 * car's class when there are several classes. Returns P1–P`top` plus `around` cars ahead of
 * and behind the team car, without duplicates, in position order.
 */
export function computeStandings(
  cars: CarProgress[], teamIdx: number, info: Map<number, CarInfo>, top = 3, around = 3,
  extras: StandingsExtras = {},
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
  const lapRef = team.lastLap;
  return [...wanted].sort((a, b) => a - b).map((i) => {
    const c = field[i]!;
    const d = info.get(c.carIdx);
    const isTeam = c.carIdx === teamIdx;
    return {
      pos: i + 1,
      carIdx: c.carIdx,
      number: d?.number ?? '?',
      name: d?.name ?? '',
      country: d?.country ?? null,
      lastLap: c.lastLap,
      isTeam,
      gap: isTeam ? 0 : trackGap(c, team, lapRef),
      lapsGap: isTeam ? 0 : Math.trunc(c.progress - team.progress),
      tyreLaps: extras.tyreLaps?.(c.carIdx) ?? null,
      inPit: c.onPitRoad ?? false,
    };
  });
}

/**
 * The car physically right in front of us and right behind us on track, any class, not in
 * the pits. Returned only if it is at least a lap down (the one in front: a backmarker we are
 * about to lap) or a lap up (the one behind: about to lap us).
 */
export function lappingRows(
  cars: CarProgress[], teamIdx: number, info: Map<number, CarInfo>, lapRef: number | null,
  tyreLaps: (carIdx: number) => number | null = () => null,
): StandingRow[] {
  const team = cars.find((c) => c.carIdx === teamIdx);
  if (!team) return [];
  type Near = { c: CarProgress; o: number; laps: number };
  let ahead: Near | null = null;
  let behind: Near | null = null;
  for (const c of cars) {
    if (c.carIdx === teamIdx || c.onPitRoad) continue;
    const diff = c.progress - team.progress;
    const laps = Math.round(diff);
    const o = diff - laps; // physical offset on track in laps, -0.5..0.5
    if (o > 0 && (!ahead || o < ahead.o)) ahead = { c, o, laps };
    if (o < 0 && (!behind || o > behind.o)) behind = { c, o, laps };
  }
  const row = (x: Near, lap: 'backmarker' | 'lapper'): StandingRow => {
    const d = info.get(x.c.carIdx);
    const g = trackGap(x.c, team, lapRef);
    // Physical gap on track: race gap without the whole laps.
    const gap = g !== null && lapRef ? g - x.laps * lapRef : lapRef ? x.o * lapRef : null;
    return {
      pos: 0, carIdx: x.c.carIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
      lastLap: x.c.lastLap, isTeam: false, gap, lapsGap: x.laps, tyreLaps: tyreLaps(x.c.carIdx), inPit: false,
      lap, otherClass: x.c.classId !== team.classId,
    };
  };
  const out: StandingRow[] = [];
  if (ahead && ahead.laps <= -1) out.push(row(ahead, 'backmarker'));
  if (behind && behind.laps >= 1) out.push(row(behind, 'lapper'));
  return out;
}

/** Reads all cars from a telemetry frame; cars not on the track (pct < 0) are skipped. */
export function readProgress(f: Frame): CarProgress[] {
  const n = Math.min(f.count('CarIdxLapCompleted'), f.count('CarIdxLapDistPct'));
  const hasEst = f.has('CarIdxEstTime');
  const hasPit = f.has('CarIdxOnPitRoad');
  const out: CarProgress[] = [];
  for (let i = 0; i < n; i++) {
    const pct = f.num('CarIdxLapDistPct', i);
    const laps = f.num('CarIdxLapCompleted', i);
    if (!(pct >= 0) || !(laps >= 0)) continue;
    const last = f.has('CarIdxLastLapTime') ? f.num('CarIdxLastLapTime', i) : -1;
    const est = hasEst ? f.num('CarIdxEstTime', i) : -1;
    out.push({
      carIdx: i,
      progress: laps + pct,
      lastLap: last > 0 ? last : null,
      classId: f.has('CarIdxClass') ? f.num('CarIdxClass', i) : 0,
      estTime: est >= 0 ? est : null,
      onPitRoad: hasPit && f.num('CarIdxOnPitRoad', i) === 1,
    });
  }
  return out;
}

/**
 * Tyre age of other cars, approximated as laps since their last pit stop: iRacing does not
 * say whether a car got new tyres, only that it was on pit road. Counting starts when the
 * car is first seen; a car first seen before completing a lap counts from the start.
 */
export class PitStopTracker {
  private sinceLap = new Map<number, number>();
  private onPit = new Map<number, boolean>();

  update(cars: { carIdx: number; laps: number; onPitRoad: boolean }[]) {
    for (const c of cars) {
      const was = this.onPit.get(c.carIdx);
      if (was === undefined && c.laps <= 0) this.sinceLap.set(c.carIdx, 0); // seen from the start
      if (was === true && !c.onPitRoad) this.sinceLap.set(c.carIdx, c.laps); // left the pits
      const since = this.sinceLap.get(c.carIdx);
      if (since !== undefined && c.laps < since) this.sinceLap.set(c.carIdx, c.laps); // lap count went back (reset)
      this.onPit.set(c.carIdx, c.onPitRoad);
    }
  }

  laps(carIdx: number, lapsNow: number): number | null {
    const since = this.sinceLap.get(carIdx);
    return since === undefined ? null : Math.max(0, lapsNow - since);
  }

  reset() {
    this.sinceLap.clear();
    this.onPit.clear();
  }
}

const SEND_EVERY_S = 1;
const WHEELS = ['LF', 'RF', 'LR', 'RR'] as const;

/**
 * Builds the "standings" message about once per second while driving. Pit stops are
 * tracked on every frame, also while not driving, so the tyre age is known at the next stint.
 */
export class StandingsTracker {
  private info = new Map<number, CarInfo>();
  private lastSent = -Infinity;
  private pits = new PitStopTracker();
  private sessionNum = -1;
  private trackLength = 0;

  setDrivers(info: Map<number, CarInfo>, trackLength = 0) {
    this.info = info;
    this.trackLength = trackLength;
  }

  onFrame(f: Frame, driving: boolean): Standings | null {
    const sessionNum = f.has('SessionNum') ? f.num('SessionNum') : 0;
    if (sessionNum !== this.sessionNum) {
      this.pits.reset();
      this.sessionNum = sessionNum;
    }
    const cars = readProgress(f);
    this.pits.update(cars.map((c) => ({ carIdx: c.carIdx, laps: Math.floor(c.progress), onPitRoad: c.onPitRoad ?? false })));
    if (!driving) return null;

    const t = f.num('SessionTime');
    if (t - this.lastSent < SEND_EVERY_S && t >= this.lastSent) return null;
    this.lastSent = t;
    const teamIdx = f.num('PlayerCarIdx');
    const laps = new Map(cars.map((c) => [c.carIdx, Math.floor(c.progress)]));
    const ownTyres = this.ownTyreLaps(f);
    const tyreLaps = (idx: number) => (idx === teamIdx && ownTyres !== null ? ownTyres : this.pits.laps(idx, laps.get(idx) ?? 0));
    const rows = computeStandings(cars, teamIdx, this.info, 3, 3, { tyreLaps });
    const lapRef = cars.find((c) => c.carIdx === teamIdx)?.lastLap ?? null;
    const lapping = lappingRows(cars, teamIdx, this.info, lapRef, tyreLaps);
    return rows.length ? { t: 'standings', sessionTime: t, rows, lapping } : null;
  }

  /** Own car: exact, from the distance the tyres have run since they were fitted (newest tyre). */
  private ownTyreLaps(f: Frame): number | null {
    if (this.trackLength <= 0 || !WHEELS.every((w) => f.has(`${w}odometer`))) return null;
    const metres = Math.min(...WHEELS.map((w) => f.num(`${w}odometer`)));
    return metres >= 0 ? Math.floor(metres / this.trackLength) : null;
  }
}

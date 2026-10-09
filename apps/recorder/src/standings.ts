import type { StandingRow, Standings } from '@stintview/protocol';
import { parse } from 'yaml';
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

export interface CarInfo {
  number: string; name: string; /** ISO code for the flag, e.g. "de". */ country?: string | null;
  team?: string | null; car?: string | null; irating?: number | null; license?: { text: string; color: string } | null;
}

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
  const row = (x: Near, lap: 'backmarker' | 'lapper'): StandingRow =>
    ({ ...physicalRow(x.c, team, x.o, x.laps, info, lapRef, tyreLaps), lap });
  const out: StandingRow[] = [];
  if (ahead && ahead.laps <= -1) out.push(row(ahead, 'backmarker'));
  if (behind && behind.laps >= 1) out.push(row(behind, 'lapper'));
  return out;
}

/**
 * A car near us on track: `o` = physical offset in laps (+ ahead), `laps` = whole laps it is
 * ahead (+) or behind (−) in the race. gap = physical gap on track in seconds.
 */
function physicalRow(
  c: CarProgress, team: CarProgress, o: number, laps: number, info: Map<number, CarInfo>, lapRef: number | null,
  tyreLaps: (carIdx: number) => number | null,
): StandingRow {
  const d = info.get(c.carIdx);
  const g = trackGap(c, team, lapRef);
  // Physical gap on track: race gap without the whole laps.
  const gap = g !== null && lapRef ? g - laps * lapRef : lapRef ? o * lapRef : null;
  return {
    pos: 0, carIdx: c.carIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
    lastLap: c.lastLap, isTeam: false, gap, lapsGap: laps, tyreLaps: tyreLaps(c.carIdx), inPit: false,
    otherClass: c.classId !== team.classId,
  };
}

/**
 * Duel panel: cars on track between us and our class neighbours (in front of / behind us in
 * the running order) that are on a different lap than us – cars we are lapping and cars
 * lapping us, any class, not in the pits. Nearest to us first, at most `max` per side.
 */
export function betweenRows(
  cars: CarProgress[], teamIdx: number, frontIdx: number | null, backIdx: number | null,
  info: Map<number, CarInfo>, lapRef: number | null, max = 3,
  tyreLaps: (carIdx: number) => number | null = () => null,
): { ahead: StandingRow[]; behind: StandingRow[] } {
  const team = cars.find((c) => c.carIdx === teamIdx);
  if (!team) return { ahead: [], behind: [] };
  const side = (rivalIdx: number | null, dir: 1 | -1): StandingRow[] => {
    const rival = cars.find((c) => c.carIdx === rivalIdx);
    if (!rival) return [];
    const span = (rival.progress - team.progress) * dir; // race distance to the rival in laps
    if (!(span > 0)) return [];
    const found: { c: CarProgress; o: number; laps: number }[] = [];
    for (const c of cars) {
      if (c.carIdx === teamIdx || c.carIdx === frontIdx || c.carIdx === backIdx || c.onPitRoad) continue;
      const d = (c.progress - team.progress) * dir;
      const o = d - Math.floor(d); // physical distance in that direction, 0..1 lap
      if (!(o > 0 && o < span)) continue;
      const laps = Math.round(c.progress - team.progress - o * dir);
      if (laps !== 0) found.push({ c, o, laps });
    }
    return found.sort((a, b) => a.o - b.o).slice(0, max)
      .map((x) => physicalRow(x.c, team, x.o * dir, x.laps, info, lapRef, tyreLaps));
  };
  return { ahead: side(frontIdx, 1), behind: side(backIdx, -1) };
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

/**
 * A car's best lap (practice/qualifying ranking); cars in the garage count too.
 * `order` = iRacing's official position, if known (then it decides the ranking).
 */
export interface BestLap { carIdx: number; best: number | null; lastLap: number | null; classId: number; order?: number }

/** Practice/qualifying ranking within the team car's class: fastest first, cars without a time left out (except us, last). */
function rankBest(cars: BestLap[], teamIdx: number): BestLap[] {
  const team = cars.find((c) => c.carIdx === teamIdx);
  if (!team) return [];
  const key = (c: BestLap) => (c.best === null ? Infinity : c.order ?? c.best);
  return cars
    .filter((c) => c.classId === team.classId && (c.best !== null || c.carIdx === teamIdx))
    .sort((a, b) => key(a) - key(b) || a.carIdx - b.carIdx);
}

function bestRow(c: BestLap, pos: number, team: BestLap, info: Map<number, CarInfo>, tyreLaps: (carIdx: number) => number | null): StandingRow {
  const d = info.get(c.carIdx);
  const isTeam = c.carIdx === team.carIdx;
  return {
    pos, carIdx: c.carIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
    lastLap: c.lastLap, isTeam, bestLap: c.best,
    gap: isTeam || c.best === null || team.best === null ? null : c.best - team.best,
    lapsGap: 0, tyreLaps: tyreLaps(c.carIdx), inPit: false,
  };
}

/**
 * Practice and qualifying: ranking by best lap within the team car's class (cars without a
 * time last), P1–P`top` plus `around` cars ahead of and behind us. gap = their best − ours.
 */
export function computeBestStandings(
  cars: BestLap[], teamIdx: number, info: Map<number, CarInfo>, top = 3, around = 3,
  tyreLaps: (carIdx: number) => number | null = () => null,
): StandingRow[] {
  const field = rankBest(cars, teamIdx);
  const at = field.findIndex((c) => c.carIdx === teamIdx);
  if (at < 0) return [];
  const wanted = new Set<number>();
  for (let i = 0; i < Math.min(top, field.length); i++) wanted.add(i);
  for (let i = Math.max(0, at - around); i <= Math.min(field.length - 1, at + around); i++) wanted.add(i);
  return [...wanted].sort((a, b) => a - b).map((i) => bestRow(field[i]!, i + 1, field[at]!, info, tyreLaps));
}

/**
 * Practice/qualifying duel: where the lap in progress (`lapTime`, projected; null = none) would
 * put us in the ranking, and the next car to beat from there with the time still to find on it.
 * A lap slower than our best keeps our position; the time to find then includes what we lost.
 */
export function bestProjection(
  cars: BestLap[], teamIdx: number, info: Map<number, CarInfo>, lapTime: number | null,
): NonNullable<Standings['projection']> | null {
  const field = rankBest(cars, teamIdx);
  const at = field.findIndex((c) => c.carIdx === teamIdx);
  if (at < 0) return null;
  const team = field[at]!;
  const others = field.filter((c) => c.carIdx !== teamIdx && c.best !== null);
  const counts = Math.min(team.best ?? Infinity, lapTime ?? Infinity);
  // A tie doesn't pass: the earlier time stays ahead.
  const ahead = others.filter((c) => c.best! <= counts);
  const pos = counts === Infinity ? at + 1 : ahead.length + 1;
  const target = counts === Infinity ? null : ahead[ahead.length - 1] ?? null;
  const ours = lapTime ?? team.best;
  return {
    lapTime, pos,
    target: target ? bestRow(target, field.indexOf(target) + 1, team, info, () => null) : null,
    needed: target && ours !== null ? ours - target.best! : null,
  };
}

/** One car in iRacing's official results of a session (session YAML, ResultsPositions). */
export interface OfficialResult { carIdx: number; position: number; fastest: number | null }

/** Best laps from the official results: their order and fastest (valid) laps replace the telemetry's. */
export function officialBestLaps(cars: BestLap[], results: OfficialResult[]): BestLap[] {
  const byCar = new Map(results.map((r) => [r.carIdx, r]));
  return cars.map((c) => {
    const r = byCar.get(c.carIdx);
    return r?.fastest ? { ...c, best: r.fastest, order: r.position } : { ...c, best: null };
  });
}

/** Best laps of all cars in the frame (also in the garage), from CarIdxBestLapTime. */
export function readBestLaps(f: Frame): BestLap[] {
  const n = f.count('CarIdxBestLapTime');
  const out: BestLap[] = [];
  for (let i = 0; i < n; i++) {
    const best = f.num('CarIdxBestLapTime', i);
    const last = f.has('CarIdxLastLapTime') ? f.num('CarIdxLastLapTime', i) : -1;
    out.push({
      carIdx: i, best: best > 0 ? best : null, lastLap: last > 0 ? last : null,
      classId: f.has('CarIdxClass') ? f.num('CarIdxClass', i) : 0,
    });
  }
  return out;
}

/** Per session of the event: its type and iRacing's official results so far (empty if none yet). */
export interface SessionResults { type: string; results: OfficialResult[] }

/**
 * SessionNum -> SessionType ("Practice", "Open Qualify", "Race", ...) and the official results
 * (`ResultsPositions`: overall position, fastest lap; -1 = no time) from the session YAML.
 */
export function parseSessions(text: string): Map<number, SessionResults> {
  type Pos = { Position?: number; CarIdx?: number; FastestTime?: number };
  let y: { SessionInfo?: { Sessions?: { SessionNum?: number; SessionType?: string; ResultsPositions?: Pos[] | null }[] } } = {};
  try {
    y = parse(text, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {};
  } catch { /* none */ }
  return new Map((y.SessionInfo?.Sessions ?? []).filter((s) => s.SessionNum !== undefined).map((s) => [s.SessionNum!, {
    type: s.SessionType ?? '',
    results: (s.ResultsPositions ?? [])
      .filter((p) => typeof p.CarIdx === 'number' && typeof p.Position === 'number')
      .map((p) => ({ carIdx: p.CarIdx!, position: p.Position!, fastest: p.FastestTime! > 0 ? p.FastestTime! : null })),
  }]));
}

/**
 * Time the lap in progress will end with: own best lap + iRacing's live delta to it.
 * null without a best lap, without a valid delta or on pit road.
 */
export function projectedLap(f: Frame): number | null {
  const best = f.num('LapBestLapTime');
  if (!(best > 0) || !f.bool('LapDeltaToBestLap_OK') || f.bool('OnPitRoad')) return null;
  const delta = f.num('LapDeltaToBestLap');
  return Number.isFinite(delta) ? best + delta : null;
}

/** Races keep the running order on track; everything else ranks by best lap. */
export const isRaceSession = (type: string | undefined) => type === undefined || /race/i.test(type);
const sessionLabel = (type: string) => (/qualify/i.test(type) ? 'Qualifying' : 'Training');

const SEND_EVERY_S = 1;
/** Practice/qualifying: the projection of the lap in progress changes all the time. */
const SEND_EVERY_BEST_S = 0.5;
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
  private sessions = new Map<number, SessionResults>();

  private tires: string[] = [];

  setDrivers(info: Map<number, CarInfo>, trackLength = 0, tires: string[] = []) {
    this.info = info;
    this.trackLength = trackLength;
    this.tires = tires;
  }

  /** Team, car, tyre compound, iRating and licence on every row (also lapping rows). */
  private decorate(f: Frame, rows: StandingRow[]): StandingRow[] {
    const hasCompound = f.has('CarIdxTireCompound');
    return rows.map((r) => {
      const d = this.info.get(r.carIdx);
      const idx = hasCompound ? f.num('CarIdxTireCompound', r.carIdx) : -1;
      return { ...r, team: d?.team ?? null, car: d?.car ?? null, compound: idx >= 0 ? this.tires[idx] ?? null : null, irating: d?.irating ?? null, license: d?.license ?? null };
    });
  }

  setSessions(sessions: Map<number, SessionResults>) {
    this.sessions = sessions;
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
    const session = this.sessions.get(sessionNum);
    const bestMode = !isRaceSession(session?.type) && f.has('CarIdxBestLapTime');
    if (t - this.lastSent < (bestMode ? SEND_EVERY_BEST_S : SEND_EVERY_S) && t >= this.lastSent) return null;
    this.lastSent = t;
    const teamIdx = f.num('PlayerCarIdx');
    const laps = new Map(cars.map((c) => [c.carIdx, Math.floor(c.progress)]));
    const ownTyres = this.ownTyreLaps(f);
    const tyreLaps = (idx: number) => (idx === teamIdx && ownTyres !== null ? ownTyres : this.pits.laps(idx, laps.get(idx) ?? 0));
    if (bestMode) {
      // iRacing's official ranking (valid laps only) once the session has results, telemetry until then.
      const telemetry = readBestLaps(f);
      const field = session!.results.length ? officialBestLaps(telemetry, session!.results) : telemetry;
      const best = this.decorate(f, computeBestStandings(field, teamIdx, this.info, 3, 3, tyreLaps));
      const projection = bestProjection(field, teamIdx, this.info, projectedLap(f)) ?? undefined;
      return best.length ? { t: 'standings', sessionTime: t, rows: best, mode: 'best', session: sessionLabel(session!.type), projection } : null;
    }
    const rows = this.decorate(f, computeStandings(cars, teamIdx, this.info, 3, 3, { tyreLaps }));
    const lapRef = cars.find((c) => c.carIdx === teamIdx)?.lastLap ?? null;
    const lapping = this.decorate(f, lappingRows(cars, teamIdx, this.info, lapRef, tyreLaps));
    const us = rows.find((r) => r.isTeam);
    const neighbour = (d: number) => (us ? rows.find((r) => r.pos === us.pos + d)?.carIdx ?? null : null);
    const between = betweenRows(cars, teamIdx, neighbour(-1), neighbour(1), this.info, lapRef, 3, tyreLaps);
    // Chips in the duel line show the number only: no need for the extra fields there.
    return rows.length ? { t: 'standings', sessionTime: t, rows, lapping, between, mode: 'race' } : null;
  }

  /** Own car: exact, from the distance the tyres have run since they were fitted (newest tyre). */
  private ownTyreLaps(f: Frame): number | null {
    if (this.trackLength <= 0 || !WHEELS.every((w) => f.has(`${w}odometer`))) return null;
    const metres = Math.min(...WHEELS.map((w) => f.num(`${w}odometer`)));
    return metres >= 0 ? Math.floor(metres / this.trackLength) : null;
  }
}

import type { ClassStandings, StandingRow, Standings } from '@stintview/protocol';
import { parse } from 'yaml';
import type { Frame } from './irsdk/layout.ts';

export interface CarProgress {
  carIdx: number;
  /** Laps completed + fraction of the current lap: the running order on track. */
  progress: number;
  /** Last lap time in seconds, null if none yet. */
  lastLap: number | null;
  /** Best lap time in seconds (CarIdxBestLapTime), null if none yet. */
  bestLap?: number | null;
  /** Lap count still −1: not over the start line yet (out of the pits, before the start). */
  notStarted?: boolean;
  classId: number;
  /** iRacing's estimate of the time from the start/finish line to the car's current spot, null if unknown. */
  estTime?: number | null;
  /** iRacing's estimated lap time of the car's class (CarClassEstLapTime): the scale of `estTime`. */
  estLap?: number | null;
  onPitRoad?: boolean;
}

export interface CarInfo {
  number: string; name: string; /** ISO code for the flag, e.g. "de". */ country?: string | null;
  team?: string | null; car?: string | null; irating?: number | null; license?: { text: string; color: string } | null;
  /** CarClassEstLapTime in seconds. */ estLap?: number | null;
  /** Class short name, colour "#rrggbb", relative speed (higher = faster); pace car / spectator. */
  className?: string; classColor?: string; classSpeed?: number; notRacing?: boolean;
}

export interface StandingsExtras {
  /** Tyre age in laps per carIdx (null = unknown). */
  tyreLaps?: (carIdx: number) => number | null;
  /** Diagnostics: odd gaps with their raw values (recorder.log). */
  note?: (line: string) => void;
}

/**
 * Time gap from the team car to `car` along the track in seconds; positive = `car` is ahead.
 * Uses iRacing's per-car time estimate (`CarIdxEstTime`: time from the line to the car's spot
 * on a reference lap of its class, 0 … `estLap`; accounts for slow and fast sections, like
 * iRacing's Relative) and the team car's last lap for whole laps; falls back to distance ×
 * lap time. The estimate restarts once per lap – not necessarily in the same frame as the
 * position on the lap: of the difference and the difference ± one estimated lap, the one that
 * fits the distance on track best counts (up to 0.20 only a wrap when the signs disagreed, with
 * the real lap: a car right behind us showed > 300 s, race 10.10.2026). Not scaled to the
 * real lap: a pit stop or yellow flag lap as last lap would distort every gap.
 * Way off the distance on track, the distance counts. `note` gets odd cases (a wrap without the
 * line between the cars or the other way round, a gap way off the distance) for the log.
 * Returns null without a reference lap time.
 */
export function trackGap(
  car: CarProgress, team: CarProgress, lapRef: number | null, note?: (line: string) => void,
): number | null {
  const dp = car.progress - team.progress;
  const laps = Math.trunc(dp);
  const rest = dp - laps; // fraction of a lap between the cars, beyond whole laps
  const est = car.estTime, ownEst = team.estTime;
  if (est != null && ownEst != null && est >= 0 && ownEst >= 0) {
    const ownLap = team.estLap ?? lapRef;
    // Another class has another estimated lap: the car's spot on our scale.
    const spot = team.estLap && car.estLap ? est * team.estLap / car.estLap : est;
    const raw = spot - ownEst; // same lap: time between the two spots
    if (!ownLap) return laps === 0 && Math.sign(raw) === Math.sign(rest) ? raw : null;
    const expected = rest * ownLap;
    let dt = raw;
    for (const c of [raw - ownLap, raw + ownLap]) if (Math.abs(c - expected) < Math.abs(dt - expected)) dt = c;
    // Way off the distance on track (> 5 s + 50 %; slow corners differ by up to ~2×): the
    // estimate jumped – take the distance. Seen as "> 300 s" for a car right behind us in the
    // last km of the Nordschleife (race 10.10.2026, not near the line); cause unknown, logged.
    const off = Math.abs(dt - expected) > 5 + 0.5 * Math.abs(expected);
    const estimate = dt;
    if (off) dt = expected;
    if (note) {
      // A wrap is due when the line lies between the two cars (the one in front has crossed it).
      const pct = (p: number) => p - Math.floor(p);
      const across = rest !== 0 && (rest > 0) === (pct(car.progress) < pct(team.progress));
      if (off || (estimate !== raw) !== across) {
        note(`car ${car.carIdx}: ${dt.toFixed(1)} s${off ? ' from the distance' : ''} (estimate ${raw.toFixed(1)}${estimate !== raw ? ` → ${estimate.toFixed(1)}` : ''}, distance ${expected.toFixed(1)}) – `
          + `car ${car.progress.toFixed(4)} est ${est.toFixed(1)}, us ${team.progress.toFixed(4)} est ${ownEst.toFixed(1)}, `
          + `est lap ${ownLap.toFixed(1)}, last lap ${lapRef?.toFixed(1) ?? '–'}`);
      }
    }
    if (lapRef) return dt + laps * lapRef;
    return laps === 0 ? dt : null;
  }
  return lapRef ? dp * lapRef : null;
}

/**
 * Lap time to convert distances and whole laps: the car's last lap, before its first one iRacing's
 * estimated lap of its class (gaps stayed empty until we had completed a lap, 11.10.2026).
 */
export function lapRefOf(c: CarProgress | undefined): number | null {
  return c?.lastLap ?? c?.estLap ?? null;
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
  const lapRef = lapRefOf(team);
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
      gap: isTeam ? 0 : trackGap(c, team, lapRef, extras.note),
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

/** Position of each car in its class by running order on track (carIdx -> position). */
export function classPositions(cars: CarProgress[]): Map<number, number> {
  const out = new Map<number, number>();
  const byClass = new Map<number, CarProgress[]>();
  for (const c of cars) byClass.set(c.classId, [...(byClass.get(c.classId) ?? []), c]);
  for (const field of byClass.values()) {
    field.sort((a, b) => b.progress - a.progress).forEach((c, i) => out.set(c.carIdx, i + 1));
  }
  return out;
}

/**
 * Relative panel: the `n` cars nearest in front of and behind us on track – any class, also in
 * the pits – and our own row, front first. pos = position in the car's class; gap = seconds on
 * track (+ in front); in races lap = 'backmarker' a lap or more down on us, 'lapper' a lap or
 * more up (practice/qualifying: no lap status – everyone drives a different number of laps).
 * A car (or we) not over the start line yet has no comparable lap count: only its place on track counts.
 */
export function relativeRows(
  cars: CarProgress[], teamIdx: number, info: Map<number, CarInfo>, lapRef: number | null, n = 5,
  tyreLaps: (carIdx: number) => number | null = () => null, race = true,
): StandingRow[] {
  const team = cars.find((c) => c.carIdx === teamIdx);
  if (!team) return [];
  const pos = classPositions(cars);
  const near = cars.filter((c) => c.carIdx !== teamIdx).map((c) => {
    const diff = c.progress - team.progress;
    const laps = Math.round(diff);
    const o = diff - laps; // physical offset in laps, -0.5..0.5
    // Lap count not comparable: the car as if on our lap, at its place on track.
    if (c.notStarted || team.notStarted) return { c: { ...c, progress: team.progress + o }, o, laps: 0 };
    return { c, o, laps };
  });
  const ahead = near.filter((x) => x.o > 0).sort((a, b) => a.o - b.o).slice(0, n).reverse();
  const behind = near.filter((x) => x.o <= 0).sort((a, b) => b.o - a.o).slice(0, n);
  const row = (x: { c: CarProgress; o: number; laps: number }): StandingRow => ({
    ...physicalRow(x.c, team, x.o, x.laps, info, lapRef, tyreLaps),
    pos: pos.get(x.c.carIdx) ?? 0, inPit: x.c.onPitRoad ?? false,
    ...(race && x.laps < 0 ? { lap: 'backmarker' as const } : race && x.laps > 0 ? { lap: 'lapper' as const } : {}),
  });
  const d = info.get(teamIdx);
  const own: StandingRow = {
    pos: pos.get(teamIdx) ?? 0, carIdx: teamIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
    lastLap: team.lastLap, isTeam: true, gap: 0, lapsGap: 0, tyreLaps: tyreLaps(teamIdx), inPit: team.onPitRoad ?? false,
  };
  return [...ahead.map(row), own, ...behind.map(row)];
}

/** Fastest class first (iRacing's relative speed), then by class id. */
function classOrder(info: Map<number, CarInfo>, cars: { carIdx: number; classId: number }[]) {
  const speed = new Map<number, number>();
  for (const c of cars) if (!speed.has(c.classId)) speed.set(c.classId, info.get(c.carIdx)?.classSpeed ?? 0);
  return [...speed.keys()].sort((a, b) => speed.get(b)! - speed.get(a)! || a - b);
}

/** Rows to list in a class: P1–P`top`, and around us in our own class. */
function listed(count: number, at: number, top: number, around: number) {
  const want = new Set<number>();
  for (let i = 0; i < Math.min(top, count); i++) want.add(i);
  if (at >= 0) for (let i = Math.max(0, at - around); i <= Math.min(count - 1, at + around); i++) want.add(i);
  return [...want].sort((a, b) => a - b);
}

function classHeader(classId: number, member: number | undefined, info: Map<number, CarInfo>) {
  const d = member === undefined ? undefined : info.get(member);
  return { classId, name: d?.className || `Class ${classId}`, color: d?.classColor ?? '#888888' };
}

/**
 * Class standings panel in the race: every class (fastest first) by running order on track,
 * P1–P`top`, in our class also `around` cars ahead of / behind us. gap = seconds behind the
 * class leader on track, or lapsGap = −whole laps behind (gap null then).
 */
export function classStandings(
  cars: CarProgress[], teamIdx: number, info: Map<number, CarInfo>,
  tyreLaps: (carIdx: number) => number | null = () => null, top = 3, around = 3,
): ClassStandings[] {
  const team = cars.find((c) => c.carIdx === teamIdx);
  return classOrder(info, cars).map((classId) => {
    const field = cars.filter((c) => c.classId === classId).sort((a, b) => b.progress - a.progress);
    const leader = field[0]!;
    const own = team?.classId === classId;
    const at = own ? field.findIndex((c) => c.carIdx === teamIdx) : -1;
    const best = field.reduce<number | null>((m, c) => (c.bestLap && (m === null || c.bestLap < m) ? c.bestLap : m), null);
    const rows = listed(field.length, at, top, around).map((i): StandingRow => {
      const c = field[i]!;
      const d = info.get(c.carIdx);
      const down = i === 0 ? 0 : Math.max(0, Math.floor(leader.progress - c.progress));
      return {
        pos: i + 1, carIdx: c.carIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
        lastLap: c.lastLap, bestLap: c.bestLap ?? null, isTeam: c.carIdx === teamIdx,
        gap: i === 0 ? 0 : down >= 1 ? null : trackGap(leader, c, lapRefOf(c) ?? lapRefOf(leader)),
        lapsGap: down ? -down : 0, tyreLaps: tyreLaps(c.carIdx), inPit: c.onPitRoad ?? false,
      };
    });
    return { ...classHeader(classId, leader.carIdx, info), own, best, rows };
  });
}

/**
 * Class standings in practice/qualifying: every class by best lap (iRacing's official order
 * when there is one), gap = best − the class leader's best. Cars without a time last.
 */
export function classBestStandings(
  cars: BestLap[], teamIdx: number, info: Map<number, CarInfo>,
  tyreLaps: (carIdx: number) => number | null = () => null, top = 3, around = 3,
): ClassStandings[] {
  const key = (c: BestLap) => (c.best === null ? Infinity : c.order ?? c.best);
  return classOrder(info, cars).map((classId) => {
    const field = cars.filter((c) => c.classId === classId && (c.best !== null || c.carIdx === teamIdx))
      .sort((a, b) => key(a) - key(b) || a.carIdx - b.carIdx);
    const own = field.some((c) => c.carIdx === teamIdx);
    const at = field.findIndex((c) => c.carIdx === teamIdx);
    const lead = field[0]?.best ?? null;
    const rows = listed(field.length, at, top, around).map((i): StandingRow => {
      const c = field[i]!;
      const d = info.get(c.carIdx);
      return {
        pos: i + 1, carIdx: c.carIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
        lastLap: c.lastLap, bestLap: c.best, isTeam: c.carIdx === teamIdx,
        gap: c.best !== null && lead !== null ? c.best - lead : null, lapsGap: 0, tyreLaps: tyreLaps(c.carIdx), inPit: false,
      };
    });
    return { ...classHeader(classId, field[0]?.carIdx ?? cars.find((c) => c.classId === classId)?.carIdx, info), own, best: lead, rows };
  }).filter((c) => c.rows.length > 0);
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

/**
 * Reads all cars from a telemetry frame; cars not on the track (pct < 0) are skipped.
 * `estLap`: iRacing's estimated class lap time per car (session info), for `trackGap`.
 */
export function readProgress(f: Frame, estLap: (carIdx: number) => number | null = () => null): CarProgress[] {
  const n = Math.min(f.count('CarIdxLapCompleted'), f.count('CarIdxLapDistPct'));
  const hasEst = f.has('CarIdxEstTime');
  const hasPit = f.has('CarIdxOnPitRoad');
  const out: CarProgress[] = [];
  for (let i = 0; i < n; i++) {
    const pct = f.num('CarIdxLapDistPct', i);
    const laps = f.num('CarIdxLapCompleted', i);
    // Not in the world: pct −1. Lap count −1 = not over the start line yet (race start, out of the
    // pits): counts as lap 0 – these cars were left out before (Relative showed cars further
    // ahead instead of the nearest ones, 11.10.2026).
    if (!(pct >= 0) || !(laps >= -1)) continue;
    const last = f.has('CarIdxLastLapTime') ? f.num('CarIdxLastLapTime', i) : -1;
    const best = f.has('CarIdxBestLapTime') ? f.num('CarIdxBestLapTime', i) : -1;
    const est = hasEst ? f.num('CarIdxEstTime', i) : -1;
    out.push({
      carIdx: i,
      progress: Math.max(0, laps) + pct,
      notStarted: laps < 0,
      lastLap: last > 0 ? last : null,
      bestLap: best > 0 ? best : null,
      classId: f.has('CarIdxClass') ? f.num('CarIdxClass', i) : 0,
      estTime: est >= 0 ? est : null,
      estLap: estLap(i),
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
/** Odd gaps logged per session (diagnostics). */
const MAX_NOTES = 50;
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
  private noted = 0;
  private sessionNum = -1;
  private trackLength = 0;
  private sessions = new Map<number, SessionResults>();

  private tires: string[] = [];

  constructor(private readonly log: (line: string) => void = () => {}) {}

  /** Odd gaps for recorder.log, a limited number per session. */
  private note = (line: string) => {
    if (this.noted < MAX_NOTES) this.log(`[gap] ${line}`);
    else if (this.noted === MAX_NOTES) this.log('[gap] more odd gaps this session, not logged');
    this.noted++;
  };

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
      return {
        ...r, team: d?.team ?? null, car: d?.car ?? null, compound: idx >= 0 ? this.tires[idx] ?? null : null,
        irating: d?.irating ?? null, license: d?.license ?? null, classColor: d?.classColor ?? null,
      };
    });
  }

  setSessions(sessions: Map<number, SessionResults>) {
    this.sessions = sessions;
  }

  onFrame(f: Frame, driving: boolean): Standings | null {
    const sessionNum = f.has('SessionNum') ? f.num('SessionNum') : 0;
    if (sessionNum !== this.sessionNum) {
      this.pits.reset();
      this.noted = 0;
      this.sessionNum = sessionNum;
    }
    // Pace car and spectators are not in any standings.
    const cars = readProgress(f, (idx) => this.info.get(idx)?.estLap ?? null).filter((c) => !this.info.get(c.carIdx)?.notRacing);
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
    const lapRef = lapRefOf(cars.find((c) => c.carIdx === teamIdx));
    // Relative panel: on track, in every session.
    const relative = this.decorate(f, relativeRows(cars, teamIdx, this.info, lapRef, 5, tyreLaps, !bestMode));
    const decorateClasses = (cs: ClassStandings[]) => cs.map((c) => ({ ...c, rows: this.decorate(f, c.rows) }));
    if (bestMode) {
      // iRacing's official ranking (valid laps only) once the session has results, telemetry until then.
      const telemetry = readBestLaps(f).filter((c) => !this.info.get(c.carIdx)?.notRacing);
      const field = session!.results.length ? officialBestLaps(telemetry, session!.results) : telemetry;
      const best = this.decorate(f, computeBestStandings(field, teamIdx, this.info, 3, 3, tyreLaps));
      const projection = bestProjection(field, teamIdx, this.info, projectedLap(f)) ?? undefined;
      const classes = decorateClasses(classBestStandings(field, teamIdx, this.info, tyreLaps));
      return best.length ? { t: 'standings', sessionTime: t, rows: best, mode: 'best', session: sessionLabel(session!.type), projection, relative, classes } : null;
    }
    const rows = this.decorate(f, computeStandings(cars, teamIdx, this.info, 3, 3, { tyreLaps, note: this.note }));
    const classes = decorateClasses(classStandings(cars, teamIdx, this.info, tyreLaps));
    const lapping = this.decorate(f, lappingRows(cars, teamIdx, this.info, lapRef, tyreLaps));
    const us = rows.find((r) => r.isTeam);
    const neighbour = (d: number) => (us ? rows.find((r) => r.pos === us.pos + d)?.carIdx ?? null : null);
    const between = betweenRows(cars, teamIdx, neighbour(-1), neighbour(1), this.info, lapRef, 3, tyreLaps);
    // Chips in the duel line show the number only: no need for the extra fields there.
    return rows.length ? { t: 'standings', sessionTime: t, rows, lapping, between, mode: 'race', relative, classes } : null;
  }

  /** Own car: exact, from the distance the tyres have run since they were fitted (newest tyre). */
  private ownTyreLaps(f: Frame): number | null {
    if (this.trackLength <= 0 || !WHEELS.every((w) => f.has(`${w}odometer`))) return null;
    const metres = Math.min(...WHEELS.map((w) => f.num(`${w}odometer`)));
    return metres >= 0 ? Math.floor(metres / this.trackLength) : null;
  }
}

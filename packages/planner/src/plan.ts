import { median } from './stats.ts';
import { DEFAULT_PARTICIPANT, type DriverStats, type Interval, type PlanStint, type Race } from './types.ts';

/** A participant as the planner sees them: availability, limits and their numbers on this combination. */
export interface PlanMember {
  name: string;
  /** Merged and sorted. */
  avail: Interval[];
  maxStints: number;
  drives: boolean;
  /** Seconds per lap (manual or measured pace); null = no data, not planned as driver. */
  lapTime: number | null;
  /** Litres per lap (manual, measured or the team's median). */
  fuel: number | null;
  /** Fuel is the team's median, not this driver's. */
  fuelEstimated: boolean;
  /** Laps per full tank, null without tank or fuel figure. */
  stintLaps: number | null;
}

export interface PlanContext {
  start: number;
  end: number;
  pitMs: number;
  tank: number | null;
  members: PlanMember[];
  /** For stints without (known) driver: median lap time (s) and laps per tank of the drivers. */
  typicalLap: number | null;
  typicalLaps: number | null;
}

export type IssueCode =
  | 'no-driver' | 'no-spotter' | 'driver-away' | 'spotter-away' | 'spotter-is-driver'
  | 'streak' | 'fuel' | 'not-a-driver' | 'no-laptime' | 'unknown-member' | 'after-end';

export interface EvaluatedStint extends PlanStint {
  index: number;
  /** Takes over at `start` (pit stop begins, previous stint ends), drives from `drive` to `end`; ms. */
  start: number;
  drive: number;
  end: number;
  /** Lap time used for this stint, s. */
  lapTime: number | null;
  issues: IssueCode[];
}

export interface MemberLoad { drive: number; spot: number; stints: number }

export interface PlanSummary {
  stints: EvaluatedStint[];
  /** End of the last stint, ms. */
  end: number;
  /** The plan stops before the race does. */
  short: boolean;
  laps: number;
  members: Record<string, MemberLoad>;
  /** Stints with at least one issue. */
  problems: number;
}

export interface AutoPlanResult {
  stints: PlanStint[];
  /** Every stint has a driver and a spotter that fit all rules. */
  complete: boolean;
  /** Nobody can be planned as driver (no lap times, no tank/fuel figures). */
  noDrivers: boolean;
}

/** Search steps before falling back to the greedy plan with gaps. */
const BUDGET = 200_000;
const DEFAULT_LAP = 120;
const DEFAULT_LAPS = 25;

/** Sorted, overlapping/touching intervals joined, empty ones dropped. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const v = list.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).map(([a, b]) => [a, b] as Interval).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const i of v) {
    const last = out.at(-1);
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else out.push(i);
  }
  return out;
}

/** Available for the whole of [a, b]. */
export const available = (avail: readonly Interval[], a: number, b: number) => avail.some(([f, t]) => f <= a && t >= b);

/** Available for a stint: the last lap usually ends after the race clock – only the race time counts. */
const availableFor = (ctx: PlanContext, avail: readonly Interval[], a: number, b: number) => available(avail, a, Math.min(b, ctx.end));

/** Planner view of a race: who drives how fast with how much fuel. */
export function planContext(race: Race, stats: Record<string, DriverStats | undefined>): PlanContext {
  const raw = race.invited.map((name) => {
    const p = { ...DEFAULT_PARTICIPANT, ...race.participants[name] };
    const s = stats[name];
    return { name, p, lapTime: p.lapTime ?? s?.pace ?? null, fuel: p.fuel ?? s?.fuel ?? null };
  });
  const teamFuel = median(raw.map((r) => r.fuel).filter((x): x is number => x !== null && x > 0));
  const tanks = Object.values(stats).map((s) => s?.tank).filter((x): x is number => !!x && x > 0);
  const tank = race.tank ?? (tanks.length ? Math.max(...tanks) : null);
  const members = raw.map(({ name, p, lapTime, fuel }): PlanMember => {
    const f = fuel ?? teamFuel;
    return {
      name, avail: mergeIntervals(p.avail), maxStints: Math.max(1, Math.round(p.maxStints)), drives: p.drives,
      lapTime, fuel: f, fuelEstimated: fuel === null && f !== null,
      stintLaps: tank && f ? Math.max(1, Math.floor(tank / f + 1e-9)) : null,
    };
  });
  const drivers = members.filter((m) => m.drives && m.lapTime);
  return {
    start: race.start, end: race.start + race.duration * 1000, pitMs: race.pitTime * 1000, tank, members,
    typicalLap: median(drivers.map((m) => m.lapTime!)),
    typicalLaps: median(drivers.map((m) => m.stintLaps).filter((x): x is number => x !== null)),
  };
}

/** Times, laps and rule violations of a plan (auto or edited by hand). */
export function evaluatePlan(ctx: PlanContext, plan: readonly PlanStint[]): PlanSummary {
  const byName = new Map(ctx.members.map((m) => [m.name, m]));
  const load: Record<string, MemberLoad> = Object.fromEntries(ctx.members.map((m) => [m.name, { drive: 0, spot: 0, stints: 0 }]));
  const stints: EvaluatedStint[] = [];
  let t = ctx.start, streak = 0, laps = 0, problems = 0;
  plan.forEach((p, index) => {
    const driver = p.driver ? byName.get(p.driver) : undefined;
    const spotter = p.spotter ? byName.get(p.spotter) : undefined;
    const lapTime = driver?.lapTime ?? ctx.typicalLap ?? DEFAULT_LAP;
    const start = t, drive = start + (index === 0 ? 0 : ctx.pitMs);
    const n = Math.max(1, Math.round(p.laps));
    const end = drive + n * lapTime * 1000;
    streak = index > 0 && p.driver && plan[index - 1]!.driver === p.driver ? streak + 1 : 1;

    const issues: IssueCode[] = [];
    if (start >= ctx.end) issues.push('after-end');
    if (!p.driver) issues.push('no-driver');
    else if (!driver) issues.push('unknown-member');
    else {
      if (!driver.drives) issues.push('not-a-driver');
      if (!driver.lapTime) issues.push('no-laptime');
      if (!availableFor(ctx, driver.avail, start, end)) issues.push('driver-away');
      if (streak > driver.maxStints) issues.push('streak');
      if (driver.stintLaps !== null && n > driver.stintLaps) issues.push('fuel');
    }
    if (!p.spotter) issues.push('no-spotter');
    else if (!spotter) issues.push('unknown-member');
    else {
      if (p.spotter === p.driver) issues.push('spotter-is-driver');
      if (!availableFor(ctx, spotter.avail, start, end)) issues.push('spotter-away');
    }
    if (issues.length) problems++;
    if (driver) { load[driver.name]!.drive += end - drive; load[driver.name]!.stints++; }
    if (spotter && p.spotter !== p.driver) load[spotter.name]!.spot += end - start;
    if (start < ctx.end) laps += n;
    stints.push({ ...p, laps: n, index, start, drive, end, lapTime, issues: [...new Set(issues)] });
    t = end;
  });
  return { stints, end: t, short: t < ctx.end, laps, members: load, problems };
}

interface Option { laps: number; end: number }

/**
 * Stint plan from the availabilities: one driver and one spotter per stint, a stint = one full
 * tank of that driver. Fastest drivers first (pace ties within 0.5 % → fewer stints so far), at
 * most `maxStints` in a row, each available for the whole stint including the pit stop before
 * it. `keep` = stints taken over unchanged ("plan again from here"). If no complete plan exists,
 * stints that can't be filled get no driver/spotter, and the rest is planned around them.
 */
export function autoPlan(ctx: PlanContext, keep: readonly PlanStint[] = []): AutoPlanResult {
  const drivers = ctx.members.filter((m) => m.drives && m.lapTime && m.stintLaps);
  if (!drivers.length) return { stints: [...keep], complete: false, noDrivers: true };

  const kept = evaluatePlan(ctx, keep);
  const counts = new Map<string, number>();
  for (const s of keep) if (s.driver) counts.set(s.driver, (counts.get(s.driver) ?? 0) + 1);
  let last = keep.at(-1)?.driver ?? null;
  let streak = 0;
  for (let i = keep.length - 1; i >= 0 && keep[i]!.driver === last && last; i--) streak++;
  const start = keep.length ? kept.end : ctx.start;

  const option = (m: (typeof drivers)[number], s: number, first: boolean): Option => {
    const lapMs = m.lapTime! * 1000;
    const drive = s + (first ? 0 : ctx.pitMs);
    const toGo = Math.max(1, Math.ceil((ctx.end - drive) / lapMs - 1e-9));
    const laps = Math.min(m.stintLaps!, toGo);
    return { laps, end: drive + laps * lapMs };
  };
  const hasSpotter = (driver: string, a: number, b: number) => ctx.members.some((m) => m.name !== driver && availableFor(ctx, m.avail, a, b));
  const ordered = () => [...drivers].sort((a, b) => {
    const pa = a.lapTime!, pb = b.lapTime!;
    if (Math.abs(pa - pb) > 0.005 * Math.min(pa, pb)) return pa - pb;
    return (counts.get(a.name) ?? 0) - (counts.get(b.name) ?? 0) || pa - pb || a.name.localeCompare(b.name);
  });
  const candidates = (s: number, first: boolean, prev: string | null, run: number) =>
    ordered().flatMap((m) => {
      const st = m.name === prev ? run + 1 : 1;
      if (st > m.maxStints) return [];
      const o = option(m, s, first);
      return availableFor(ctx, m.avail, s, o.end) ? [{ m, st, o, key: `${o.end}|${m.name}|${st}`, spotter: hasSpotter(m.name, s, o.end) }] : [];
    });

  // Depth-first search for a complete plan. Whether the rest of the race can be filled depends
  // only on (time, last driver, run length), so dead ends are remembered.
  const failed = new Set<string>();
  let nodes = 0, aborted = false;
  const dfs = (s: number, first: boolean, prev: string | null, run: number): PlanStint[] | null => {
    if (s >= ctx.end) return [];
    if (++nodes > BUDGET) { aborted = true; return null; }
    for (const c of candidates(s, first, prev, run)) {
      if (!c.spotter || failed.has(c.key)) continue;
      counts.set(c.m.name, (counts.get(c.m.name) ?? 0) + 1);
      const rest = dfs(c.o.end, false, c.m.name, c.st);
      counts.set(c.m.name, counts.get(c.m.name)! - 1);
      if (rest) return [{ driver: c.m.name, spotter: null, laps: c.o.laps }, ...rest];
      if (aborted) return null;
      failed.add(c.key);
    }
    return null;
  };
  const found = start >= ctx.end ? [] : dfs(start, keep.length === 0, last, streak);
  if (found) return { stints: assignSpotters(ctx, [...keep, ...found], keep.length), complete: true, noDrivers: false };

  // No complete plan: greedy, avoiding known dead ends; a driver without spotter beats nobody,
  // and where nobody can drive, an empty stint lasts until someone becomes available.
  const lapMs = (ctx.typicalLap ?? DEFAULT_LAP) * 1000;
  const typicalLaps = ctx.typicalLaps ?? DEFAULT_LAPS;
  const out: PlanStint[] = [];
  let s = start;
  while (s < ctx.end && out.length < 500) {
    const first = keep.length + out.length === 0;
    const cs = candidates(s, first, last, streak);
    const pick = cs.find((c) => c.spotter && !failed.has(c.key)) ?? cs.find((c) => c.spotter) ?? cs[0];
    if (pick) {
      out.push({ driver: pick.m.name, spotter: null, laps: pick.o.laps });
      counts.set(pick.m.name, (counts.get(pick.m.name) ?? 0) + 1);
      last = pick.m.name;
      streak = pick.st;
      s = pick.o.end;
      continue;
    }
    const drive = s + (first ? 0 : ctx.pitMs);
    const next = Math.min(ctx.end, ...drivers.flatMap((m) => m.avail.map(([f]) => f)).filter((f) => f > s));
    const laps = Math.min(typicalLaps, Math.max(1, Math.ceil((next - drive) / lapMs - 1e-9)));
    out.push({ driver: null, spotter: null, laps });
    last = null;
    streak = 0;
    s = drive + laps * lapMs;
  }
  return { stints: assignSpotters(ctx, [...keep, ...out], keep.length), complete: false, noDrivers: false };
}

/**
 * Spotters for the stints from `from` on: available for the whole stint, not its driver;
 * preferably not driving the next stint, then whoever spotted least, then not just out of the car.
 */
export function assignSpotters(ctx: PlanContext, plan: PlanStint[], from = 0): PlanStint[] {
  const ev = evaluatePlan(ctx, plan).stints;
  const spot = new Map<string, number>();
  const out = plan.map((p) => ({ ...p }));
  ev.forEach((s, i) => {
    if (i < from) {
      if (s.spotter) spot.set(s.spotter, (spot.get(s.spotter) ?? 0) + s.end - s.start);
      return;
    }
    const next = plan[i + 1]?.driver, prev = plan[i - 1]?.driver;
    const score = (name: string) => (name === next ? 1e12 : 0) + (spot.get(name) ?? 0) + (name === prev ? 30 * 60_000 : 0);
    const pick = ctx.members
      .filter((m) => m.name !== s.driver && availableFor(ctx, m.avail, s.start, s.end))
      .sort((a, b) => score(a.name) - score(b.name) || a.name.localeCompare(b.name))[0];
    out[i]!.spotter = pick?.name ?? null;
    if (pick) spot.set(pick.name, (spot.get(pick.name) ?? 0) + s.end - s.start);
  });
  return out;
}

import type { Combo, DriverStats, LapRecord } from './types.ts';

/** Newest laps per driver and combination that count for the stats. */
const RECENT = 100;
/** Laps slower than best + 3 % are traffic, incidents, cool-down laps … */
const PACE_WINDOW = 1.03;

export const median = (xs: number[]): number | null => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Plausible lap: positive finite time and fuel, not absurdly long. */
export function validLap(l: LapRecord): boolean {
  return Number.isFinite(l.time) && l.time > 10 && l.time < 1800 && Number.isFinite(l.fuel) && l.fuel >= 0 && Number.isFinite(l.at);
}

/**
 * Pace and fuel of one driver on a track/car: dry laps outside qualifying, newest 100;
 * pace = median of the laps within 3 % of the best (filters traffic, incidents, in/out laps).
 */
export function lapStats(laps: readonly LapRecord[], track: number, car: number): DriverStats {
  const here = laps.filter((l) => l.track === track && l.car === car && validLap(l));
  const tanks = here.map((l) => l.tank).filter((x) => x > 0);
  const use = here.filter((l) => !l.wet && l.session !== 'qualify').sort((a, b) => b.at - a.at).slice(0, RECENT);
  if (!use.length) return { laps: 0, best: null, pace: null, fuel: null, tank: tanks.length ? Math.max(...tanks) : null };
  const best = Math.min(...use.map((l) => l.time));
  const good = use.filter((l) => l.time <= best * PACE_WINDOW);
  const fuel = median(good.map((l) => l.fuel).filter((x) => x > 0));
  return {
    laps: use.length,
    best: round(best, 3),
    pace: round(median(good.map((l) => l.time))!, 3),
    fuel: fuel === null ? null : round(fuel, 3),
    tank: tanks.length ? round(Math.max(...tanks), 2) : null,
  };
}

/** Track/car combinations in the laps of all members, most laps first. */
export function combos(byMember: Record<string, readonly LapRecord[]>): Combo[] {
  const map = new Map<string, Combo & { who: Set<string> }>();
  for (const [member, laps] of Object.entries(byMember)) {
    for (const l of laps) {
      const key = `${l.track}/${l.car}`;
      let c = map.get(key);
      if (!c) map.set(key, c = { track: l.track, trackName: l.trackName, car: l.car, carName: l.carName, drivers: 0, laps: 0, who: new Set() });
      c.laps++;
      c.who.add(member);
    }
  }
  return [...map.values()].map(({ who, ...c }) => ({ ...c, drivers: who.size })).sort((a, b) => b.laps - a.laps);
}

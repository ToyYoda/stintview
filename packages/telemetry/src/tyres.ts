import { WHEELS, type Triple, type TyreMeasurement, type Wheel } from '@stintview/protocol';

export interface TyreSample {
  sessionTime: number;
  lap: number;
  odometer: Record<Wheel, number>;
  carcass: Record<Wheel, Triple>;
  wear: Record<Wheel, Triple>;
}

/**
 * iRacing only updates carcass temperature and wear when the car stops in the pit
 * stall; it then measures the set currently fitted. The odometer resets to 0 right
 * after if tyres are changed. A measurement is recorded whenever the values change,
 * together with the odometer at that moment. The values present when tracking
 * starts are stale (previous stop or session) and are ignored.
 */
export class TyreTracker {
  private last: string | null = null;
  readonly measurements: TyreMeasurement[] = [];

  constructor(private readonly keep = 20) {}

  /** Returns the new measurement if this sample contained one. */
  feed(s: TyreSample): TyreMeasurement | null {
    const key = JSON.stringify([s.carcass, s.wear]);
    if (this.last === null || key === this.last) {
      this.last = key;
      return null;
    }
    this.last = key;
    const m: TyreMeasurement = {
      lap: s.lap,
      sessionTime: s.sessionTime,
      odometer: { ...s.odometer },
      carcass: clone(s.carcass),
      wear: clone(s.wear),
    };
    this.measurements.push(m);
    if (this.measurements.length > this.keep) this.measurements.shift();
    return m;
  }
}

export interface WearEstimate {
  /** Estimated tread remaining 0..1 of the most worn zone, or null if unknown. */
  remaining: number | null;
  /** Wear per 10 km (0..1), from the last measurement. */
  ratePer10km: number | null;
}

/**
 * Estimates current tread from the wear rate of the last measured stint.
 * If the odometer went down since the measurement the set was changed (new tyres).
 */
export function estimateWear(
  measurements: readonly TyreMeasurement[],
  odometerNow: Record<Wheel, number>,
): Record<Wheel, WearEstimate> {
  const out = {} as Record<Wheel, WearEstimate>;
  const last = measurements.at(-1);
  for (const w of WHEELS) {
    if (!last || last.odometer[w] < 1000) {
      out[w] = { remaining: null, ratePer10km: null };
      continue;
    }
    const measured = Math.min(...last.wear[w]);
    // Assumes the measured set started new; first stint of a session may start used.
    const ratePerM = (1 - measured) / last.odometer[w];
    const now = odometerNow[w];
    const remaining = now >= last.odometer[w]
      ? measured - ratePerM * (now - last.odometer[w])
      : 1 - ratePerM * now;
    out[w] = { remaining: Math.max(0, remaining), ratePer10km: ratePerM * 10_000 };
  }
  return out;
}

function clone(r: Record<Wheel, Triple>): Record<Wheel, Triple> {
  return { LF: [...r.LF], RF: [...r.RF], LR: [...r.LR], RR: [...r.RR] };
}

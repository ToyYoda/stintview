import type { WeatherEvent, WeatherKind, WeatherNow } from '@stintview/protocol';

export interface WeatherSample {
  sessionTime: number;
  /** In-sim time of day, seconds since midnight. */
  timeOfDay: number;
  airTemp: number;
  trackTemp: number;
  /** 0 clear, 1 partly cloudy, 2 mostly cloudy, 3 overcast */
  skies: number;
  /** 0..1 */
  precipitation: number;
  /** irsdk_TrackWetness 0..7 */
  wetness: number;
  declaredWet: boolean;
}

/** A category must hold this long (sim seconds) before it counts as a change. */
export const STABLE_S = 30;
/** Temperature changes smaller than this (°C) since the last reported level are noise. */
export const AIR_STEP = 2;
export const TRACK_STEP = 3;
/** Trend window (sim seconds) and minimum change (°C) for an arrow. */
const TREND_S = 600;
const TREND_MIN = 1;

/** Precipitation in steps: 0 none, 1 light, 2 moderate, 3 heavy. */
export function precipLevel(p: number): number {
  if (p < 0.01) return 0;
  if (p < 0.3) return 1;
  if (p < 0.6) return 2;
  return 3;
}

type Category = 'skies' | 'precip' | 'wetness' | 'declaredWet';
const categoryOf = (s: WeatherSample): Record<Category, number> => ({
  skies: s.skies,
  precip: precipLevel(s.precipitation),
  wetness: s.wetness,
  declaredWet: s.declaredWet ? 1 : 0,
});

/**
 * Turns the raw weather values into the current state plus a short list of real changes
 * (clouds, rain, track wetness, rain tyres allowed, notable temperature swings).
 */
export class WeatherTracker {
  readonly events: WeatherEvent[] = [];
  private committed: Record<Category, number> | null = null;
  private pending = new Map<Category, { value: number; since: number; at: WeatherSample }>();
  private tempRef: { air: number; track: number } | null = null;
  private history: { t: number; air: number; track: number }[] = [];
  private last: WeatherSample | null = null;

  constructor(private readonly keep = 30) {}

  /** Returns events created by this sample. */
  feed(s: WeatherSample): WeatherEvent[] {
    if (this.last && s.sessionTime < this.last.sessionTime - 1) this.reset(); // new session / replay seek
    this.last = s;
    const out: WeatherEvent[] = [];
    const cats = categoryOf(s);

    if (!this.committed) {
      this.committed = cats;
      this.tempRef = { air: s.airTemp, track: s.trackTemp };
    } else {
      for (const k of Object.keys(cats) as Category[]) {
        const v = cats[k];
        if (v === this.committed[k]) {
          this.pending.delete(k);
          continue;
        }
        const p = this.pending.get(k);
        if (!p || p.value !== v) {
          this.pending.set(k, { value: v, since: s.sessionTime, at: s });
        } else if (s.sessionTime - p.since >= STABLE_S) {
          out.push(event(p.at, k, this.committed[k], v));
          this.committed[k] = v;
          this.pending.delete(k);
        }
      }
      const ref = this.tempRef!;
      if (Math.abs(s.airTemp - ref.air) >= AIR_STEP) {
        out.push(event(s, 'airTemp', round(ref.air), round(s.airTemp)));
        ref.air = s.airTemp;
      }
      if (Math.abs(s.trackTemp - ref.track) >= TRACK_STEP) {
        out.push(event(s, 'trackTemp', round(ref.track), round(s.trackTemp)));
        ref.track = s.trackTemp;
      }
    }

    const h = this.history.at(-1);
    if (!h || s.sessionTime - h.t >= 30) {
      this.history.push({ t: s.sessionTime, air: s.airTemp, track: s.trackTemp });
      while (this.history.length > 2 && s.sessionTime - this.history[1]!.t >= TREND_S) this.history.shift();
    }

    this.events.push(...out);
    if (this.events.length > this.keep) this.events.splice(0, this.events.length - this.keep);
    return out;
  }

  /** Current values with temperature trends (−1 falling, 0 steady, 1 rising over ~10 min). */
  current(): WeatherNow | null {
    const s = this.last;
    if (!s) return null;
    const old = this.history.find((h) => s.sessionTime - h.t <= TREND_S) ?? this.history[0];
    const trend = (now: number, then: number | undefined) =>
      then === undefined || Math.abs(now - then) < TREND_MIN ? 0 : now > then ? 1 : -1;
    return {
      sessionTime: s.sessionTime,
      timeOfDay: s.timeOfDay,
      airTemp: s.airTemp,
      trackTemp: s.trackTemp,
      skies: s.skies,
      precipitation: s.precipitation,
      wetness: s.wetness,
      declaredWet: s.declaredWet,
      airTrend: trend(s.airTemp, old?.air),
      trackTrend: trend(s.trackTemp, old?.track),
    };
  }

  private reset() {
    this.events.length = 0;
    this.committed = null;
    this.pending.clear();
    this.tempRef = null;
    this.history = [];
  }
}

function event(s: WeatherSample, kind: WeatherKind, from: number, to: number): WeatherEvent {
  return { sessionTime: s.sessionTime, timeOfDay: s.timeOfDay, kind, from, to };
}

const round = (n: number) => Math.round(n * 10) / 10;

import type { FuelLap } from '@stintview/protocol';

export interface FuelSample {
  sessionTime: number;
  lap: number;
  lapDistPct: number;
  fuelLevel: number;
  onPitRoad: boolean;
}

/**
 * Derives fuel used per lap from a stream of samples.
 *
 * Consumption is accumulated from decreases of the fuel level only, so refuelling
 * during a pit stop never produces negative values. Laps that touched pit road are
 * flagged and excluded from averages. The lap in progress when tracking starts is
 * dropped because its start was not observed.
 */
export class FuelTracker {
  private lap: number | null = null;
  private lapStart = 0;
  private used = 0;
  private pit = false;
  private lastLevel: number | null = null;
  private observedStart = false;
  readonly laps: FuelLap[] = [];

  constructor(private readonly keep = 50) {}

  /** Returns the completed lap if this sample finished one. */
  feed(s: FuelSample): FuelLap | null {
    if (this.lastLevel !== null && s.fuelLevel < this.lastLevel) {
      this.used += this.lastLevel - s.fuelLevel;
    }
    this.lastLevel = s.fuelLevel;
    if (s.onPitRoad) this.pit = true;

    if (this.lap === null) {
      this.startLap(s, s.lapDistPct < 0.02);
      return null;
    }
    if (s.lap === this.lap) return null;

    let done: FuelLap | null = null;
    if (s.lap === this.lap + 1 && this.observedStart) {
      done = { lap: this.lap, used: round(this.used), lapTime: round(s.sessionTime - this.lapStart), pit: this.pit };
      this.laps.push(done);
      if (this.laps.length > this.keep) this.laps.shift();
    }
    // A jump by more than one lap (tow, reset, replay seek) invalidates the current lap.
    this.startLap(s, s.lap === this.lap + 1 || s.lapDistPct < 0.02);
    return done;
  }

  private startLap(s: FuelSample, observed: boolean) {
    this.lap = s.lap;
    this.lapStart = s.sessionTime;
    this.used = 0;
    this.pit = s.onPitRoad;
    this.observedStart = observed;
  }
}

export interface FuelStats {
  lastLap: number | null;
  avg3: number | null;
  avg5: number | null;
  /** Laps the current fuel level lasts at avg3 (falls back to lastLap). */
  lapsRemaining: number | null;
}

export function fuelStats(laps: readonly FuelLap[], fuelLevel: number): FuelStats {
  const green = laps.filter((l) => !l.pit && l.used > 0);
  const avg = (n: number) => {
    const last = green.slice(-n);
    return last.length ? round(last.reduce((a, l) => a + l.used, 0) / last.length) : null;
  };
  const lastLap = green.at(-1)?.used ?? null;
  const avg3 = avg(3);
  const perLap = avg3 ?? lastLap;
  return {
    lastLap,
    avg3,
    avg5: avg(5),
    lapsRemaining: perLap ? Math.floor((fuelLevel / perLap) * 10) / 10 : null,
  };
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

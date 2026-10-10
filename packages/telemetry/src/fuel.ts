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
    // Lap 0 is the formation lap (rolling start) or the few metres from the grid to the line
    // (standing start): not a lap to count fuel by (race 09.10.2026).
    if (s.lap === this.lap + 1 && this.observedStart && this.lap >= 1) {
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

export interface FuelPlanInput {
  fuelLevel: number;
  /** Lap in progress (iRacing `Lap`) and how far into it, 0..1. */
  lap: number;
  lapDistPct: number;
  /** Fuel per lap to plan with (average of recent green laps), litres. */
  perLap: number;
  /** Lap time to plan with, seconds. */
  lapTime: number;
  /** Seconds left in a timed race, null if the race goes over laps. */
  timeRemain: number | null;
  /** Laps left in a race over laps (`SessionLapsRemainEx`, including the current one), null if timed. */
  lapsRemain: number | null;
  /** Litres the car may carry (tank × allowed percentage). */
  usableTank: number;
}

export interface FuelPlan {
  /** Distance to the finish in laps, from where the car is now. */
  lapsToGo: number;
  /** Litres needed to the finish. */
  needed: number;
  /** Stops still needed for fuel (0 = enough in the tank). */
  stops: number;
  /** stops = 0: litres left at the finish. */
  reserve: number | null;
  /** Last lap to come in before running dry (in-lap), null if it reaches the finish. */
  pitByLap: number | null;
  /** Fuel per lap that saves one stop, and the saving it takes per lap; null without stops. */
  saveTarget: { perLap: number; save: number; pct: number } | null;
  /** Litres to add at the last stop (the others fill up). */
  lastStopFuel: number | null;
}

/**
 * Fuel to the finish. Timed race: the current lap, then laps until the clock runs out, then
 * the lap in which it runs out (the race ends when the leader crosses the line after zero;
 * being on the leader's lap is assumed). Each stop is assumed to fill up to `usableTank`.
 */
export function fuelPlan(i: FuelPlanInput): FuelPlan | null {
  if (!(i.perLap > 0) || !(i.lapTime > 0) || !(i.usableTank > 0)) return null;
  const rest = 1 - i.lapDistPct; // of the lap in progress
  let lapsToGo: number;
  if (i.lapsRemain !== null) lapsToGo = Math.max(0, i.lapsRemain - i.lapDistPct);
  else if (i.timeRemain !== null) lapsToGo = rest + Math.ceil(Math.max(0, i.timeRemain - rest * i.lapTime) / i.lapTime);
  else return null;
  const needed = lapsToGo * i.perLap;
  const missing = needed - i.fuelLevel;
  const stops = missing > 0 ? Math.ceil(missing / i.usableTank) : 0;
  const lapsOfFuel = i.fuelLevel / i.perLap;
  const save = (() => {
    if (stops === 0 || lapsToGo <= 0) return null;
    const perLap = (i.fuelLevel + (stops - 1) * i.usableTank) / lapsToGo;
    return { perLap: round(perLap), save: round(i.perLap - perLap), pct: round((i.perLap - perLap) / i.perLap) };
  })();
  return {
    lapsToGo: round(lapsToGo),
    needed: round(needed),
    stops,
    reserve: stops === 0 ? round(-missing) : null,
    pitByLap: stops > 0 ? i.lap + Math.floor(i.lapDistPct + lapsOfFuel) - 1 : null,
    saveTarget: save,
    lastStopFuel: stops > 0 ? round(missing - (stops - 1) * i.usableTank) : null,
  };
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

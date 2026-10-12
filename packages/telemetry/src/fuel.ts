import type { FuelLap } from '@stintview/protocol';

export interface FuelSample {
  sessionTime: number;
  /** iRacing `Lap`: only to number a lap when `lapsCompleted` is missing. */
  lap: number;
  lapDistPct: number;
  fuelLevel: number;
  onPitRoad: boolean;
  /** iRacing `LapCompleted`: right after the line, the number of the lap just finished. */
  lapsCompleted?: number;
  /** iRacing `SessionState` (4 = racing): laps begun on the grid, behind the pace car or after the flag don't count. */
  sessionState?: number;
}

/** SessionState racing; 1–3 = get in car / warmup / parade laps, 5–6 = checkered / cool-down. */
const RACING = 4;
/** Green flag this soon after the line (rolling start): the lap counts – it is lap 1. */
const GREEN_WINDOW = 0.1;
/** Longer without samples (out of the car, not driving): the lap in progress can't be measured. */
const MAX_GAP_S = 2;
/** Moved more than this in one sample without crossing the line: towed, reset, replay seek. */
const MAX_STEP = 0.25;

/**
 * Derives fuel used per lap from a stream of samples.
 *
 * A lap is the way from one crossing of the start/finish line to the next, seen in the position
 * on the lap (LapDistPct going from near 1 to near 0) – not in iRacing's `Lap` counter: live it
 * jumped back at the start and when getting into the car in the pits, which dropped lap 1 and
 * every lap of a stint (race 12.10.2026). Only laps whose start was seen count: not the lap in
 * progress when tracking starts, after a gap in the samples or a jump on track. Laps begun
 * outside racing (grid, formation lap, cool-down) don't count either.
 *
 * Consumption is accumulated from decreases of the fuel level only, so refuelling
 * during a pit stop never produces negative values. Laps that touched pit road are
 * flagged and excluded from averages.
 */
export class FuelTracker {
  private prev: { t: number; pct: number } | null = null;
  private lapStart = 0;
  private used = 0;
  private pit = false;
  private lastLevel: number | null = null;
  private observedStart = false;
  private racing = false;
  private lastNumber: number | null = null;
  readonly laps: FuelLap[] = [];

  constructor(private readonly keep = 50) {}

  /** Returns the completed lap if this sample finished one. */
  feed(s: FuelSample): FuelLap | null {
    if (this.lastLevel !== null && s.fuelLevel < this.lastLevel) {
      this.used += this.lastLevel - s.fuelLevel;
    }
    this.lastLevel = s.fuelLevel;
    if (s.onPitRoad) this.pit = true;

    // Right after the line iRacing may say −0.0001; −1 = not in the world.
    const pct = s.lapDistPct < 0 && s.lapDistPct > -0.01 ? 0 : s.lapDistPct;
    const prev = this.prev;
    this.prev = { t: s.sessionTime, pct };
    if (!(pct >= 0)) return null;
    if (!prev || !(prev.pct >= 0) || s.sessionTime - prev.t > MAX_GAP_S || s.sessionTime < prev.t) {
      this.startLap(s, false);
      return null;
    }
    const step = pct - prev.pct;
    const crossed = step < -0.5 && step + 1 <= MAX_STEP;
    if (!crossed) {
      if (Math.abs(step) > MAX_STEP) this.startLap(s, false);
      else if (pct < GREEN_WINDOW && countsState(s.sessionState)) this.racing = true;
      return null;
    }

    let done: FuelLap | null = null;
    const next = this.lastNumber !== null ? this.lastNumber + 1 : null;
    const counted = s.lapsCompleted ?? s.lap - 1;
    // iRacing's count, at least one more than the lap before (in case it lags a frame behind the line).
    const number = counted >= 1 ? Math.max(counted, next ?? 0) : next;
    // Without a number iRacing still counts it as lap 0 (grid to the line, formation lap).
    if (this.observedStart && this.racing && number !== null) {
      done = { lap: number, used: round(this.used), lapTime: round(s.sessionTime - this.lapStart), pit: this.pit };
      this.laps.push(done);
      if (this.laps.length > this.keep) this.laps.shift();
    }
    if (number !== null) this.lastNumber = number;
    this.startLap(s, true);
    return done;
  }

  private startLap(s: FuelSample, observed: boolean) {
    this.lapStart = s.sessionTime;
    this.used = 0;
    this.pit = s.onPitRoad;
    this.observedStart = observed;
    this.racing = countsState(s.sessionState);
  }
}

/** Laps may count in this session state (unknown or invalid: yes, as before SessionState was read). */
const countsState = (state: number | undefined) => state === undefined || state === RACING || state === 0;

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

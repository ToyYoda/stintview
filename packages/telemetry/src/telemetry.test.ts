import { describe, expect, it } from 'vitest';
import type { FuelLap, Triple, TyreMeasurement, Wheel } from '@stintview/protocol';
import { FuelTracker, fuelPlan, fuelStats } from './fuel.ts';
import { InputBatcher } from './inputs.ts';
import { TyreTracker, estimateWear } from './tyres.ts';

const all = <T>(v: T): Record<Wheel, T> => ({ LF: v, RF: v, LR: v, RR: v });

describe('FuelTracker', () => {
  /**
   * Drives from `from` to `to` (laps completed + position on the lap) in 100 s laps, a sample every
   * 0.5 s, 3 l per lap. iRacing's counters by default: LapCompleted = whole laps, Lap = one more.
   */
  function driver(t = new FuelTracker()) {
    let time = 0, fuel = 80;
    const done: FuelLap[] = [];
    const drive = (from: number, to: number, o: {
      state?: number; pit?: (p: number) => boolean; lap?: (p: number) => number; completed?: (p: number) => number | undefined;
    } = {}) => {
      for (let i = Math.round(from * 200); i <= Math.round(to * 200); i++) {
        const p = i / 200;
        fuel -= 0.015;
        const r = t.feed({
          sessionTime: time, lapDistPct: p - Math.floor(p), fuelLevel: fuel, onPitRoad: o.pit?.(p) ?? false,
          lap: o.lap?.(p) ?? Math.floor(p) + 1,
          lapsCompleted: o.completed ? o.completed(p) : Math.floor(p),
          sessionState: o.state ?? 4,
        });
        if (r) done.push(r);
        time += 0.5;
      }
    };
    return { t, done, drive, pause: (s: number) => { time += s; }, refuel: (l: number) => { fuel += l; } };
  }

  it('computes fuel per lap, flags pit laps and ignores refuelling', () => {
    const d = driver();
    d.drive(0.5, 3.995); // starts mid-lap: lap 1 dropped
    d.drive(4, 4.9, { pit: (p) => p > 4.8 });
    d.refuel(40);
    d.drive(4.905, 6.2, { pit: (p) => p < 5.1 });
    expect(d.done.map((l) => [l.lap, l.pit])).toEqual([[2, false], [3, false], [4, false], [5, true], [6, true]]);
    expect(d.done[0]!.used).toBeCloseTo(3.0);
    expect(d.done[0]!.lapTime).toBeCloseTo(100);
    expect(d.done[3]!.used).toBeGreaterThan(0);

    const stats = fuelStats(d.done, 30);
    expect(stats.avg3).toBeCloseTo(3.0);
    expect(stats.lapsRemaining).toBe(10);
  });

  it('drops the lap of a jump on track (tow, reset) or a gap in the samples (out of the car)', () => {
    const d = driver();
    d.drive(0.9, 2.3);
    d.drive(2.7, 3.5); // jumped from 2.3 to 2.7
    d.pause(120); // got out and back in
    d.drive(3.5, 5.1, { completed: (p) => Math.floor(p) + 1 }); // and iRacing counts one more lap
    expect(d.done.map((l) => l.lap)).toEqual([2, 6]);
  });

  it('standing start: grid to the line not counted, lap 1 counted', () => {
    const d = driver();
    d.drive(-0.03, 2.05, { completed: (p) => (p < 0 ? -1 : Math.floor(p)), lap: (p) => (p < 0 ? 0 : Math.floor(p) + 1) });
    expect(d.done.map((l) => l.lap)).toEqual([1, 2]);
  });

  it('rolling start: formation lap not counted, lap 1 counted although Lap jumps back after the line (12.10.2026)', () => {
    const d = driver();
    // Pace laps (state 3) over the line, iRacing goes back to lap 0, green just after the line.
    d.drive(-0.4, 0.035, { state: 3, completed: (p) => (p < 0 || p > 0.02 ? -1 : 0), lap: (p) => (p < 0 || p > 0.02 ? 0 : 1) });
    // Lap stays 0 on the whole lap 1 – it used to count it as lap 0 and drop it.
    d.drive(0.04, 0.995, { completed: () => -1, lap: () => 0 });
    d.drive(1, 2.05);
    expect(d.done.map((l) => l.lap)).toEqual([1, 2]);
  });

  it('green flag late in the lap after the pace car: that lap is not lap 1', () => {
    const d = driver();
    d.drive(0.6, 1.9, { state: 3, completed: () => -1, lap: () => 0 });
    d.drive(1.905, 1.995, { completed: () => -1, lap: () => 0 });
    d.drive(2, 3.05, { completed: (p) => Math.floor(p) - 2, lap: (p) => Math.floor(p) - 1 });
    expect(d.done.map((l) => l.lap)).toEqual([1]);
  });

  it('no cool-down lap after the chequered flag', () => {
    const d = driver();
    d.drive(0.9, 2.995);
    d.drive(3, 4.1, { state: 5 }); // lap 3 began before the flag: counts
    expect(d.done.map((l) => l.lap)).toEqual([2, 3]);
  });

  it('a position just below 0 after the line (iRacing: −0.0001) is still on track', () => {
    const t = new FuelTracker();
    const at = (time: number, pct: number, completed: number) =>
      t.feed({ sessionTime: time, lap: completed + 1, lapDistPct: pct, fuelLevel: 50 - time / 100, onPitRoad: false, lapsCompleted: completed, sessionState: 4 });
    at(0, 0.9998, 0);
    at(0.02, -0.0001, 1);
    for (let i = 1; i <= 100; i++) at(0.02 + i, i / 100 - 0.0002, 1);
    expect(at(101.1, -0.0001, 2)).toMatchObject({ lap: 2 });
  });

  it('without LapCompleted and SessionState: numbered by Lap, lap 0 not counted', () => {
    const t = new FuelTracker();
    const done = [];
    let time = 0;
    for (let i = -4; i <= 410; i++, time += 0.5) {
      const p = i / 200;
      const r = t.feed({ sessionTime: time, lap: p < 0 ? 0 : Math.floor(p) + 1, lapDistPct: p - Math.floor(p), fuelLevel: 50 - p, onPitRoad: false });
      if (r) done.push(r);
    }
    expect(done.map((l) => l.lap)).toEqual([1, 2]);
  });
});

describe('TyreTracker', () => {
  const sample = (wear: number, odo: number, carcass = 80) => ({
    sessionTime: 0, lap: 9, odometer: all(odo),
    carcass: all<Triple>([carcass, carcass, carcass]), wear: all<Triple>([wear, wear - 0.01, wear]),
  });

  it('ignores the initial stale values and records changes', () => {
    const t = new TyreTracker();
    expect(t.feed(sample(0.9, 1000))).toBeNull();
    expect(t.feed(sample(0.9, 2000))).toBeNull();
    const m = t.feed(sample(0.8, 169_400, 76));
    expect(m?.odometer.LF).toBe(169_400);
    expect(m?.wear.LF[1]).toBeCloseTo(0.79);
  });

  it('estimates wear for a fresh set and for a kept set', () => {
    const m: TyreMeasurement = {
      lap: 9, sessionTime: 0, odometer: all(100_000),
      carcass: all<Triple>([80, 80, 80]), wear: all<Triple>([0.8, 0.8, 0.8]),
    };
    // 20 % per 100 km -> 2 % per 10 km
    const fresh = estimateWear([m], all(50_000));
    expect(fresh.LF.ratePer10km).toBeCloseTo(0.02);
    expect(fresh.LF.remaining).toBeCloseTo(0.9);
    const kept = estimateWear([m], all(150_000));
    expect(kept.RR.remaining).toBeCloseTo(0.7);
    expect(estimateWear([], all(0)).LF.remaining).toBeNull();
  });
});

describe('InputBatcher', () => {
  it('downsamples 60 Hz to 30 Hz in batches of 3', () => {
    const b = new InputBatcher();
    const batches = [];
    for (let i = 0; i < 60; i++) {
      const r = b.feed(i / 60, [i, 0, 0, 1]);
      if (r) batches.push(r);
    }
    expect(batches).toHaveLength(10);
    expect(batches[0]!.samples.map((s) => s[0])).toEqual([0, 2, 4]);
    expect(batches[1]!.st).toBeCloseTo(6 / 60);
  });
});

describe('fuelPlan', () => {
  const base = { fuelLevel: 50, lap: 10, lapDistPct: 0.5, perLap: 3, lapTime: 100, timeRemain: 1000, lapsRemain: null, usableTank: 100 };

  it('timed race: rest of this lap, laps until zero, the lap in which it runs out', () => {
    const p = fuelPlan(base)!;
    expect(p.lapsToGo).toBeCloseTo(10.5); // 0.5 + ceil(950 / 100)
    expect(p).toMatchObject({ stops: 0, pitByLap: null, saveTarget: null, lastStopFuel: null });
    expect(p.reserve).toBeCloseTo(50 - 31.5);
  });

  it('stops, latest in-lap, what saves a stop and the last fill', () => {
    const p = fuelPlan({ ...base, timeRemain: 6000 })!;
    expect(p.lapsToGo).toBeCloseTo(60.5);
    expect(p.stops).toBe(2); // 181.5 l needed, 50 in the tank, 100 per stop
    expect(p.pitByLap).toBe(26); // 16.7 laps of fuel from lap 10.5: dry in lap 27
    expect(p.saveTarget!.perLap).toBeCloseTo(150 / 60.5);
    expect(p.saveTarget!.pct).toBeCloseTo((3 - 150 / 60.5) / 3);
    expect(p.lastStopFuel).toBeCloseTo(31.5);
  });

  it('race over laps; nothing without consumption, lap time, tank or race length', () => {
    expect(fuelPlan({ ...base, timeRemain: null, lapsRemain: 20, lapDistPct: 0.25 })!.lapsToGo).toBeCloseTo(19.75);
    expect(fuelPlan({ ...base, perLap: 0 })).toBeNull();
    expect(fuelPlan({ ...base, usableTank: 0 })).toBeNull();
    expect(fuelPlan({ ...base, timeRemain: null })).toBeNull();
  });
});

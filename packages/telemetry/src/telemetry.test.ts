import { describe, expect, it } from 'vitest';
import type { Triple, TyreMeasurement, Wheel } from '@stintview/protocol';
import { FuelTracker, fuelPlan, fuelStats } from './fuel.ts';
import { InputBatcher } from './inputs.ts';
import { TyreTracker, estimateWear } from './tyres.ts';

const all = <T>(v: T): Record<Wheel, T> => ({ LF: v, RF: v, LR: v, RR: v });

describe('FuelTracker', () => {
  it('computes fuel per lap, flags pit laps and ignores refuelling', () => {
    const t = new FuelTracker();
    const done = [];
    let fuel = 50;
    let time = 0;
    // start mid-lap 0 -> dropped; laps 1..3 green, lap 4 refuels on pit road
    for (let lap = 0; lap <= 5; lap++) {
      for (let i = lap === 0 ? 5 : 0; i < 10; i++) {
        const onPitRoad = lap === 4 && i >= 8;
        if (lap === 4 && i === 9) fuel += 40;
        else fuel -= 0.3;
        time += 10;
        const r = t.feed({ sessionTime: time, lap, lapDistPct: i / 10, fuelLevel: fuel, onPitRoad });
        if (r) done.push(r);
      }
    }
    expect(done.map((l) => l.lap)).toEqual([1, 2, 3, 4]);
    expect(done[0]!.used).toBeCloseTo(3.0);
    expect(done[0]!.lapTime).toBe(100);
    expect(done[3]!.pit).toBe(true);
    expect(done[3]!.used).toBeGreaterThan(0);

    const stats = fuelStats(done, 30);
    expect(stats.avg3).toBeCloseTo(3.0);
    expect(stats.lapsRemaining).toBe(10);
  });

  it('drops a lap when laps jump (reset/seek)', () => {
    const t = new FuelTracker();
    t.feed({ sessionTime: 0, lap: 1, lapDistPct: 0, fuelLevel: 10, onPitRoad: false });
    expect(t.feed({ sessionTime: 5, lap: 3, lapDistPct: 0, fuelLevel: 9, onPitRoad: false })).toBeNull();
    expect(t.feed({ sessionTime: 9, lap: 4, lapDistPct: 0, fuelLevel: 8, onPitRoad: false })?.used).toBeCloseTo(1);
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

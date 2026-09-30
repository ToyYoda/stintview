import { describe, expect, it } from 'vitest';
import {
  computeRejoin, DEFAULT_RATES, LaneLossLearner, OwnStopLearner, PitModelStore, PitPlanner, stationaryTime, stopRequest, wrapGap,
} from './pitstop.ts';
import type { CarInfo, CarProgress } from './standings.ts';

describe('stop duration', () => {
  it('fuel and tyres at the same time: the longer job counts', () => {
    const r = stationaryTime({ fuel: 93, tyres: 4, repair: 0 }, { ...DEFAULT_RATES, simultaneous: true });
    expect(r.fuelTime).toBeCloseTo(37.2);
    expect(r.stationary).toBeCloseTo(37.2);
  });

  it('one after the other: both add up, repairs come on top', () => {
    const r = stationaryTime({ fuel: 50, tyres: 2, repair: 10 }, { fillRate: 2, tyreTime: 20, simultaneous: false });
    expect(r.tyreTime).toBe(10);
    expect(r.stationary).toBe(25 + 10 + 10);
  });

  it('reads the pit service settings: fuel limited by the tank, fast repair skips repairs', () => {
    expect(stopRequest(0x1f, 98, 20, 98, 12)).toEqual({ fuel: 78, tyres: 4, repair: 12 });
    expect(stopRequest(0x03, 98, 20, 98, 12)).toEqual({ fuel: 0, tyres: 2, repair: 12 });
    expect(stopRequest(0x50, 30, 20, 98, 12)).toEqual({ fuel: 30, tyres: 0, repair: 0 });
  });
});

/** Replays a stop: 10 Hz frames, fuel rising at `rate` from `fuelFrom` s, flag bits cleared at given times. */
function replayStop(o: { length: number; fuelFrom: number; fuelTo: number; rate: number; clears: Record<number, number> }) {
  const learner = new OwnStopLearner();
  let flags = 0x1f;
  let fuel = 10;
  learner.onFrame(0, true, flags, fuel);
  for (let t = 0.1; t <= o.length + 1e-9; t += 0.1) {
    if (t > o.fuelFrom && t <= o.fuelTo) fuel += o.rate * 0.1;
    for (const [bit, at] of Object.entries(o.clears)) if (Math.abs(t - at) < 0.05) flags &= ~Number(bit);
    learner.onFrame(t, true, flags, fuel);
  }
  return learner.onFrame(o.length + 0.1, false, flags, fuel);
}

describe('learning from our own stops', () => {
  it('fuel with tyres in parallel (as in the 06.06. race)', () => {
    const s = replayStop({ length: 17, fuelFrom: 0.8, fuelTo: 13.8, rate: 2.2, clears: { 1: 3, 2: 7, 16: 13.8, 4: 13, 8: 16.5 } });
    expect(s?.fillRate).toBeCloseTo(2.2, 1);
    expect(s?.simultaneous).toBe(true);
    expect(s?.tyreTime).toBeCloseTo(16.5, 0);
  });

  it('fuel first, then tyres', () => {
    const s = replayStop({ length: 42, fuelFrom: 0.5, fuelTo: 20.5, rate: 3, clears: { 16: 20.5, 1: 26, 2: 31, 4: 36, 8: 41 } });
    expect(s?.fillRate).toBeCloseTo(3, 1);
    expect(s?.simultaneous).toBe(false);
    expect(s?.tyreTime).toBeCloseTo(20.5, 0);
  });

  it('tyres first, then fuel', () => {
    const s = replayStop({ length: 40, fuelFrom: 18, fuelTo: 38, rate: 2.5, clears: { 1: 5, 2: 10, 4: 14, 8: 18, 16: 38 } });
    expect(s?.simultaneous).toBe(false);
    expect(s?.tyreTime).toBeCloseTo(18, 0);
  });

  it('store: median of measured stops, estimates before', () => {
    const store = new PitModelStore(null);
    expect(store.car('x')).toEqual({ ...DEFAULT_RATES, stops: 0 });
    store.addStop('x', { fillRate: 3, tyreTime: 20, simultaneous: false });
    store.addStop('x', { fillRate: 3.2 });
    expect(store.car('x')).toEqual({ fillRate: 3.1, tyreTime: 20, stops: 2 });
  });
});

describe('sporting regulation', () => {
  const yaml = (series: number) => `WeekendInfo:
 TrackID: 262
 SeriesID: ${series}
DriverInfo:
 DriverCarIdx: 0
 Drivers:
 - CarIdx: 0
   CarPath: porsche992rgt3
`;
  const planner = (series: number) => {
    const p = new PitPlanner(new PitModelStore(null));
    p.setSession(yaml(series), new Map());
    return p;
  };

  it('known series: from the table (NEC = fuel and tyres at once)', () => {
    expect(planner(275).regulation()).toEqual({ regulation: 'nec', from: 'series' });
    expect(planner(275).model().model.simultaneous).toBe(true);
  });

  it('unknown series: standard rules, fuel first then tyres', () => {
    expect(planner(228).regulation()).toEqual({ regulation: 'standard', from: 'default' });
    expect(planner(228).model().model.simultaneous).toBe(false);
  });

  it('chosen in the app wins', () => {
    const p = planner(228);
    p.setOverride({ fillRate: 4, tyreTime: null, regulation: 'dtm' });
    expect(p.regulation()).toEqual({ regulation: 'dtm', from: 'manual' });
    expect(p.model()).toMatchObject({ model: { fillRate: 4, simultaneous: true }, source: 'manual' });
  });
});

const car = (carIdx: number, progress: number, estTime: number | null, onPitRoad = false, classId = 0): CarProgress =>
  ({ carIdx, progress, lastLap: 100, classId, estTime, onPitRoad });

describe('pit lane loss', () => {
  it('time between the cones minus standing still minus the same stretch on track', () => {
    const lane = new LaneLossLearner();
    const lap = () => 100;
    // enters at 50 % (est 50 s), drives 10 s, stands 30 s, drives 20 s, leaves at 55 % (est 55 s)
    let t = 0;
    let pct = 0.5;
    const move = (seconds: number, to: number, onPit: boolean) => {
      const out = [];
      const from = pct;
      const n = Math.round(seconds * 10);
      for (let i = 1; i <= n; i++) {
        t = Math.round((t + 0.1) * 10) / 10;
        pct = from + ((to - from) * i) / n;
        out.push(...lane.onFrame(t, [car(1, 3 + pct, onPit ? 50 + (pct - 0.5) * 100 : 55, onPit)], lap));
      }
      return out;
    };
    lane.onFrame(0, [car(1, 3.5, 50, true)], lap);
    move(10, 0.52, true);
    move(30, 0.52, true);
    move(20, 0.549, true);
    const done = move(0.1, 0.55, false);
    expect(done).toHaveLength(1);
    // 60.1 s between the cones − 30 s standing − 5 s for that stretch on track ≈ 25 s
    expect(done[0]!.loss).toBeCloseTo(25, 0);
  });
});

describe('rejoin', () => {
  const info = new Map<number, CarInfo>([[0, { number: '42', name: 'Us' }], [1, { number: '7', name: 'A' }], [2, { number: '8', name: 'B' }], [3, { number: '9', name: 'C' }]]);

  it('wraps gaps into one lap around us', () => {
    expect(wrapGap(70, 100)).toBe(-30);
    expect(wrapGap(-60, 100)).toBe(40);
    expect(wrapGap(30, 100)).toBe(30);
  });

  it('cars behind us now are around us after a 60 s stop', () => {
    const cars = [
      car(0, 5.5, 50),
      car(1, 5.45, 45), // 5 s behind -> 55 s ahead after the stop
      car(2, 4.905, 90.5), // 59.5 s behind (previous lap) -> 0.5 s ahead after the stop
      car(3, 4.88, 88, false, 1), // other class, 62 s behind -> 2 s behind after the stop
    ];
    const r = computeRejoin(cars, 0, 60, 100, info);
    expect(r.ahead[0]).toMatchObject({ carIdx: 2, sameClass: true });
    expect(r.ahead[0]!.gap).toBeCloseTo(0.5, 5);
    expect(r.behind[0]).toMatchObject({ carIdx: 3, sameClass: false });
    expect(r.behind[0]!.gap).toBeCloseTo(-2, 5);
    // class position: cars 1 and 2 ahead in the race after the stop -> P3
    expect(r.classPos).toBe(3);
  });
});

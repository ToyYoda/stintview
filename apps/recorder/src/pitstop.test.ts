import { describe, expect, it } from 'vitest';
import {
  carCategory, computeRejoin, KNOWN_LANE_LOSS, DEFAULT_RATES, LaneLossLearner, regulationFromClass, OwnStopLearner, PitModelStore, PitPlanner, stationaryTime, STOP_START_S, stopRequest, wrapGap,
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
    expect(store.car('x')).toEqual({ fillRate: null, tyreTime: null, stops: 0 });
    store.addStop('x', { fillRate: 3, tyreTime: 20, simultaneous: false });
    store.addStop('x', { fillRate: 3.2 });
    expect(store.car('x')).toEqual({ fillRate: 3.1, tyreTime: 20, stops: 2 });
  });
});

describe('sporting regulation', () => {
  it('car category from the names iRacing uses', () => {
    const cases: [string, string, string, string | null][] = [
      ['porsche992rgt3', 'Porsche 911 GT3 R (992)', 'NECGT3 2026', 'gt3'],
      ['bmwlmdh', 'BMW M Hybrid V8', 'GTP', 'gtp'],
      ['ferrari499p', 'Ferrari 499P', 'GTP', 'gtp'],
      ['dallarap217', 'Dallara P217 LMP2', 'Dallara P217', 'lmp2'],
      ['porsche718gt4', 'Porsche 718 Cayman GT4', 'GT4 Class', 'gt4'],
      ['audirs3lmsgen2', 'Audi RS3 LMS Gen2 TCR', 'NECTCR 2026', 'tcr'],
      ['bmwm2g87', 'BMW M2 Racing (G87)', 'BMW M2 G87', 'm2'],
      ['porsche9922cup', 'Porsche 911 Cup (992.2)', 'NECPCup 2026', 'cup'],
      ['bmwm8gte', 'BMW M8 GTE', 'GTE Class', null],
      ['dallaraf3', 'Dallara F312 F3', 'Dallara F3', null],
    ];
    for (const [path, screen, cls, want] of cases) expect([path, carCategory(path, screen, cls)]).toEqual([path, want]);
  });

  it('regulation from the class name', () => {
    expect(regulationFromClass('NECGT3 2026')).toBe('nec');
    expect(regulationFromClass('NEC M2 Cup')).toBe('nec');
    expect(regulationFromClass('IMSA23')).toBe('imsa');
    expect(regulationFromClass('GT3 Class')).toBeNull();
  });

  const yaml = (series: number, path = 'porsche992rgt3', cls = 'GT3 Class', tank = 100) =>
    `WeekendInfo:
 TrackID: 262
 SeriesID: ${series}
DriverInfo:
 DriverCarIdx: 0
 DriverCarFuelMaxLtr: ${tank}
 Drivers:
 - CarIdx: 0
   CarPath: ${path}
   CarClassShortName: ${cls}
`;
  const planner = (...args: Parameters<typeof yaml>) => {
    const p = new PitPlanner(new PitModelStore(null));
    p.setSession(yaml(...args), new Map());
    return p;
  };

  it('standard: fuel then tyres, GT3 2.5 % of the tank per second', () => {
    const p = planner(228);
    expect(p.regulation()).toEqual({ regulation: 'standard', from: 'default' });
    expect(p.model()).toMatchObject({ model: { fillRate: 2.5, simultaneous: false }, source: 'rules' });
  });

  it('NEC from the class name: at once, slow pumps (GT3 0.83 %/s)', () => {
    const p = planner(999, 'porsche992rgt3', 'NECGT3 2026');
    expect(p.regulation()).toEqual({ regulation: 'nec', from: 'class' });
    expect(p.model().model.simultaneous).toBe(true);
    expect(p.model().model.fillRate).toBeCloseTo(0.83);
  });

  it('NEC from the SeriesID table when the class name says nothing', () => {
    expect(planner(275).regulation()).toEqual({ regulation: 'nec', from: 'series' });
  });

  it('DTM: GT3 at once with faster tyres, GT4 fuel first', () => {
    const gt3 = planner(1, 'porsche992rgt3', 'GT3 Class');
    gt3.setOverride({ fillRate: null, tyreTime: null, regulation: 'dtm' });
    expect(gt3.model().model).toMatchObject({ simultaneous: true, fillRate: 2.5 });
    expect(gt3.model().model.tyreTime).toBeCloseTo(DEFAULT_RATES.tyreTime / 3);
    const gt4 = planner(1, 'porsche718gt4', 'GT4 Class', 95);
    gt4.setOverride({ fillRate: null, tyreTime: null, regulation: 'dtm' });
    expect(gt4.model().model.simultaneous).toBe(false);
    expect(gt4.model().model.fillRate).toBeCloseTo(0.0208 * 95);
  });

  it('cars outside the table: measured rate, else estimate; manual wins', () => {
    const p = planner(228, 'bmwm8gte', 'GTE Class');
    expect(p.model()).toMatchObject({ model: { fillRate: DEFAULT_RATES.fillRate }, source: 'default' });
    p.setOverride({ fillRate: 4, tyreTime: null, regulation: 'auto' });
    expect(p.model()).toMatchObject({ model: { fillRate: 4 }, source: 'manual' });
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

  it('a drive-through without stopping gets the time for stopping and pulling away added', () => {
    const lane = new LaneLossLearner();
    const lap = () => 100;
    let t = 0;
    lane.onFrame(0, [car(1, 3.5, 50, true)], lap);
    let done: ReturnType<LaneLossLearner['onFrame']> = [];
    // 30 s through the lane for 5 % of the lap (5 s on track), never standing still
    for (let i = 1; i <= 300; i++) {
      t = i / 10;
      const pct = 0.5 + (0.05 * i) / 300;
      done = lane.onFrame(t, [car(1, 3 + pct, 50 + (pct - 0.5) * 100, i < 300)], lap);
    }
    expect(done).toHaveLength(1);
    expect(done[0]!.loss).toBeCloseTo(30 - 5 + STOP_START_S, 0);
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
    // current positions in their own class; both on our lap after the stop
    expect(r.ahead[0]).toMatchObject({ pos: 3, laps: 0 });
    expect(r.behind[0]).toMatchObject({ pos: 1, laps: 0 });
  });

  it('marks cars on other laps: backmarkers negative, cars lapping us positive', () => {
    const cars = [
      car(0, 5.5, 50),
      car(1, 3.92, 92), // 158 s behind: 2 s ahead on track after the stop, but 98 s behind in the race
      car(2, 5.45, 45), // 5 s behind: 55 s ahead in the race after the stop = 45 s behind on track, coming to lap us
    ];
    const r = computeRejoin(cars, 0, 60, 100, info);
    expect(r.ahead.find((c) => c.carIdx === 1)).toMatchObject({ laps: -1 });
    expect(r.behind.find((c) => c.carIdx === 2)).toMatchObject({ laps: 1 });
  });
});

describe('pit lane loss lookup', () => {
  it('archive value until measured live, then the measurement', () => {
    const store = new PitModelStore(null);
    expect(store.laneLoss('168')).toEqual({ loss: KNOWN_LANE_LOSS['168'], samples: 0, from: 'archive' });
    expect(store.laneLoss('99999')).toEqual({ loss: null, samples: 0, from: null });
    store.addLaneLoss('168', 15);
    expect(store.laneLoss('168')).toEqual({ loss: 15, samples: 1, from: 'measured' });
  });

  it('archive import goes before live values and remembers the files', () => {
    const store = new PitModelStore(null);
    store.addLaneLoss('1', 20);
    store.importLaneLosses(new Map([['1', Array(12).fill(10)]]), ['a.ibt']);
    // 13 values, the oldest archive value drops out, the live one stays
    expect(store.laneLoss('1').samples).toBe(12);
    expect(store.isImported('a.ibt')).toBe(true);
    store.addLaneLoss('1', 20);
    expect(store.laneLoss('1').loss).toBe(10); // median of 10×10 and 2×20
  });
});

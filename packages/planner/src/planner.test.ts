import { describe, expect, it } from 'vitest';
import { autoPlan, evaluatePlan, mergeIntervals, planContext } from './plan.ts';
import { combos, lapStats } from './stats.ts';
import type { DriverStats, Interval, LapRecord, Participant, Race } from './types.ts';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 10, 12);

function lap(time: number, extra: Partial<LapRecord> = {}): LapRecord {
  return {
    id: Math.random().toString(36), track: 1, trackName: 'Suzuka', car: 2, carName: 'Porsche', time, fuel: 3,
    tank: 90, at: T0, session: 'race', wet: false, src: 'live', ...extra,
  };
}

const stats = (pace: number, fuel = 3, tank = 90): DriverStats => ({ laps: 20, best: pace - 1, pace, fuel, tank });

function race(hours: number, people: Record<string, Partial<Participant>>, pitTime = 0): Race {
  return {
    id: 'r', name: 'Test', track: 1, trackName: 'Suzuka', car: 2, carName: 'Porsche', start: T0, duration: hours * 3600,
    pitTime, tank: null, createdBy: 'A', invited: Object.keys(people), plan: null, updatedAt: 0,
    participants: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, { avail: [[T0, T0 + hours * H]] as Interval[], maxStints: 2, drives: true, lapTime: null, fuel: null, ...v }])),
  };
}

describe('lapStats', () => {
  it('uses dry non-qualifying laps, pace within 3 % of the best', () => {
    const laps = [
      lap(100), lap(101), lap(102), lap(102.5), lap(110), // 110 = traffic, outside 3 %
      lap(95, { session: 'qualify' }), lap(90, { wet: true }), lap(99, { track: 7 }),
      lap(101, { fuel: 3.4, tank: 100 }),
    ];
    const s = lapStats(laps, 1, 2);
    expect(s.best).toBe(100);
    expect(s.pace).toBe(101);
    expect(s.fuel).toBe(3);
    expect(s.tank).toBe(100);
    expect(s.laps).toBe(6);
  });

  it('is empty without laps on the combination', () => {
    expect(lapStats([lap(100)], 9, 2)).toEqual({ laps: 0, best: null, pace: null, fuel: null, tank: null });
  });

  it('lists combinations with drivers and laps', () => {
    const c = combos({ A: [lap(100), lap(100, { track: 5, trackName: 'Spa' })], B: [lap(101)] });
    expect(c[0]).toMatchObject({ track: 1, drivers: 2, laps: 2 });
    expect(c[1]).toMatchObject({ track: 5, trackName: 'Spa', drivers: 1, laps: 1 });
  });
});

describe('mergeIntervals', () => {
  it('joins overlapping and touching ranges', () => {
    expect(mergeIntervals([[5, 6], [1, 3], [3, 4], [2, 2]])).toEqual([[1, 4], [5, 6]]);
  });
});

describe('autoPlan', () => {
  it('plans full-tank stints, fastest first, respecting the stints in a row', () => {
    // 90 l / 3 l = 30 laps; A 118 s → 59 min, B 120 s → 60 min; pit stop 60 s.
    const r = race(3, { A: {}, B: {}, S: { drives: false } }, 60);
    const ctx = planContext(r, { A: stats(118), B: stats(120) });
    const res = autoPlan(ctx);
    expect(res.complete).toBe(true);
    expect(res.stints.map((s) => s.driver)).toEqual(['A', 'A', 'B']);
    expect(res.stints.map((s) => s.laps)).toEqual([30, 30, 30]);
    for (const s of res.stints) expect(s.spotter).not.toBe(s.driver);
    const ev = evaluatePlan(ctx, res.stints);
    expect(ev.problems).toBe(0);
    expect(ev.short).toBe(false);
    // Stint 2 starts with the pit stop at 59 min and drives 59 min.
    expect(ev.stints[1]!.start).toBe(T0 + 59 * 60_000);
    expect(ev.stints[1]!.drive).toBe(T0 + 60 * 60_000);
  });

  it('backtracks when the greedy choice leads to a dead end', () => {
    // A max 2 in a row, B only around stint 2: A A ? fails, so A B A A.
    const r = race(4, {
      A: {}, B: { avail: [[T0 + H, T0 + 2 * H + 5 * 60_000]] }, S: { drives: false, avail: [[T0, T0 + 4 * H]] },
    });
    const ctx = planContext(r, { A: stats(120), B: stats(121) });
    const res = autoPlan(ctx);
    expect(res.complete).toBe(true);
    expect(res.stints.map((s) => s.driver)).toEqual(['A', 'B', 'A', 'A']);
  });

  it('leaves stints empty where nobody can drive and reports it', () => {
    const r = race(3, {
      A: { avail: [[T0, T0 + H]], maxStints: 5 }, B: { avail: [[T0 + 2 * H, T0 + 3 * H]], maxStints: 5 },
      S: { drives: false, avail: [[T0, T0 + 3 * H]] },
    });
    const ctx = planContext(r, { A: stats(120), B: stats(120) });
    const res = autoPlan(ctx);
    expect(res.complete).toBe(false);
    expect(res.stints.map((s) => s.driver)).toEqual(['A', null, 'B']);
    const ev = evaluatePlan(ctx, res.stints);
    expect(ev.stints[1]!.issues).toContain('no-driver');
    expect(ev.stints[1]!.start).toBe(T0 + H);
    expect(ev.stints[2]!.start).toBe(T0 + 2 * H);
  });

  it('plans a driver without spotter rather than nobody', () => {
    const r = race(1, { A: {} });
    const ctx = planContext(r, { A: stats(120) });
    const res = autoPlan(ctx);
    expect(res.complete).toBe(false);
    expect(res.stints).toEqual([{ driver: 'A', spotter: null, laps: 30 }]);
  });

  it('stays fast on a 24 h race without a complete solution', () => {
    // 8 drivers with slightly different paces, each available 6 h, a 2 h hole at night.
    const people: Record<string, Partial<Participant>> = {};
    const st: Record<string, DriverStats> = {};
    for (let i = 0; i < 8; i++) {
      const from = T0 + ((i * 3) % 22) * H;
      const night = from >= T0 + 10 * H && from < T0 + 12 * H;
      people[`D${i}`] = { avail: night ? [] : [[from, from + 6 * H]], maxStints: 3 };
      st[`D${i}`] = stats(118 + i * 0.4, 3 + i * 0.05);
    }
    const ctx = planContext(race(24, people), st);
    const t = performance.now();
    const res = autoPlan(ctx);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(res.complete).toBe(false);
    expect(evaluatePlan(ctx, res.stints).short).toBe(false);
  });

  it('says so when nobody has lap times', () => {
    const ctx = planContext(race(2, { A: {}, B: {} }), {});
    expect(autoPlan(ctx).noDrivers).toBe(true);
  });

  it('keeps the first stints and plans the rest', () => {
    const r = race(3, { A: {}, B: {}, S: { drives: false } });
    const ctx = planContext(r, { A: stats(118), B: stats(120) });
    const res = autoPlan(ctx, [{ driver: 'B', spotter: 'S', laps: 30 }]);
    expect(res.complete).toBe(true);
    expect(res.stints[0]).toEqual({ driver: 'B', spotter: 'S', laps: 30 });
    // A twice (59 min each), then B for the last lap: A may not drive three in a row.
    expect(res.stints.slice(1).map((s) => s.driver)).toEqual(['A', 'A', 'B']);
    expect(res.stints.at(-1)!.laps).toBe(1);
  });

  it('uses the team median fuel for a driver without fuel data', () => {
    const r = race(1, { A: {}, B: {} });
    const ctx = planContext(r, { A: stats(120, 3), B: { laps: 3, best: 121, pace: 122, fuel: null, tank: null } });
    const b = ctx.members.find((m) => m.name === 'B')!;
    expect(b.fuel).toBe(3);
    expect(b.fuelEstimated).toBe(true);
    expect(b.stintLaps).toBe(30);
  });
});

describe('evaluatePlan', () => {
  it('flags rule violations of a hand-edited plan', () => {
    const r = race(3, { A: { maxStints: 1 }, B: { avail: [[T0, T0 + H]] } });
    const ctx = planContext(r, { A: stats(120), B: stats(120) });
    const ev = evaluatePlan(ctx, [
      { driver: 'A', spotter: 'A', laps: 31 },
      { driver: 'A', spotter: 'B', laps: 30 },
      { driver: null, spotter: null, laps: 30 },
      { driver: 'A', spotter: 'B', laps: 10 },
    ]);
    expect(ev.stints[0]!.issues).toEqual(expect.arrayContaining(['spotter-is-driver', 'fuel']));
    expect(ev.stints[1]!.issues).toEqual(expect.arrayContaining(['streak', 'spotter-away']));
    expect(ev.stints[2]!.issues).toEqual(['no-driver', 'no-spotter']);
    expect(ev.stints[3]!.issues).toContain('after-end');
    expect(ev.members.A!.stints).toBe(3);
  });
});

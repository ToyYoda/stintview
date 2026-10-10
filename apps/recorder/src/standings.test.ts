import { describe, expect, it } from 'vitest';
import { countryCode } from './country.ts';
import { SteadyProgress, bestProjection, betweenRows, computeBestStandings, computeStandings, isRaceSession, lappingRows, officialBestLaps, parseSessions, PitStopTracker, trackGap, type CarInfo, type CarProgress } from './standings.ts';

const info = new Map<number, CarInfo>(
  Array.from({ length: 20 }, (_, i) => [i, { number: String(i + 1).padStart(2, '0'), name: `Driver ${i}` }]),
);
/** Car i is at `progress[i]` laps; class 0 unless given. */
const field = (progress: number[], classes: number[] = []): CarProgress[] =>
  progress.map((p, i) => ({ carIdx: i, progress: p, lastLap: 480 + i, classId: classes[i] ?? 0 }));

describe('computeStandings', () => {
  it('orders by distance on track, not by the official position', () => {
    // car 3 is ahead on track mid-lap although it may still be behind in iRacing's position
    const rows = computeStandings(field([5.2, 5.1, 5.0, 5.25]), 1, info);
    expect(rows.map((r) => [r.pos, r.carIdx])).toEqual([[1, 3], [2, 0], [3, 1], [4, 2]]);
    expect(rows.find((r) => r.isTeam)).toMatchObject({ pos: 3, number: '02', name: 'Driver 1' });
  });

  it('shows P1-P3 and three cars ahead and behind, without duplicates', () => {
    const progress = Array.from({ length: 15 }, (_, i) => 20 - i); // car i at P(i+1)
    const rows = computeStandings(field(progress), 9, info); // team at P10
    expect(rows.map((r) => r.pos)).toEqual([1, 2, 3, 7, 8, 9, 10, 11, 12, 13]);
    const nearTop = computeStandings(field(progress), 2, info); // team at P3
    expect(nearTop.map((r) => r.pos)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ranks within the team car\'s class in multi-class races', () => {
    const rows = computeStandings(field([9, 8, 7, 6], [1, 0, 1, 0]), 3, info); // GT class = 0
    expect(rows.map((r) => [r.pos, r.carIdx])).toEqual([[1, 1], [2, 3]]);
  });

  it('returns nothing when the team car is not on track', () => {
    expect(computeStandings(field([1, 2]), 7, info)).toEqual([]);
  });
});

const car = (progress: number, estTime: number | null, lastLap: number | null = 100): CarProgress =>
  ({ carIdx: 0, progress, lastLap, classId: 0, estTime });

describe('trackGap', () => {
  it('uses the time estimate on the same lap', () => {
    expect(trackGap(car(5.6, 58), car(5.5, 52), 100)).toBeCloseTo(6); // ahead
    expect(trackGap(car(5.4, 45), car(5.5, 52), 100)).toBeCloseTo(-7); // behind
  });

  it('bridges the start/finish line with the lap time', () => {
    // car ahead has just crossed the line (est 2 s), we are at 97 s of a 100 s lap
    expect(trackGap(car(6.02, 2), car(5.97, 97), 100)).toBeCloseTo(5);
    expect(trackGap(car(5.97, 97), car(6.02, 2), 100)).toBeCloseTo(-5);
  });

  it('bridges the line with the estimated lap of iRacing, not the real one', () => {
    // estimate scale 105 s, real lap 100 s: car ahead 2 s (est) past the line, we 3 s (est) before it
    const est = (progress: number, estTime: number, estLap = 105): CarProgress => ({ ...car(progress, estTime), estLap });
    expect(trackGap(est(6.02, 2), est(5.97, 102), 100)).toBeCloseTo(5);
    expect(trackGap(est(5.97, 102), est(6.02, 2), 100)).toBeCloseTo(-5);
    // not scaled with the last lap (a pit stop lap would distort every gap)
    expect(trackGap(est(5.6, 63), est(5.5, 52.5), 180)).toBeCloseTo(10.5);
    // other class (estimated lap 120 s) halfway round = halfway on our scale
    expect(trackGap({ ...car(5.6, 60), estLap: 120 }, est(5.5, 42), 100)).toBeCloseTo(10.5);
  });
});

describe('SteadyProgress', () => {
  const at = (carIdx: number, progress: number): CarProgress => ({ carIdx, progress, lastLap: 100, classId: 0 });
  const run = (steps: [number, number][]) => {
    const lines: string[] = [];
    const s = new SteadyProgress((l) => lines.push(l));
    const out = steps.map(([t, p]) => { const c = [at(7, p)]; s.apply(t, c); return c[0]!.progress; });
    return { out, lines };
  };

  it('ignores a lap count that changes before the car reaches the line', () => {
    // at 98.5 % the count already says the next lap, the position wraps 0.3 s later
    const { out, lines } = run([[0, 5.98], [0.1, 5.983], [0.2, 6.985], [0.3, 6.99], [0.4, 6.995], [0.5, 6.001], [0.6, 6.004]]);
    expect(out.map((p) => +p.toFixed(3))).toEqual([5.98, 5.983, 5.985, 5.99, 5.995, 6.001, 6.004]);
    expect(lines).toHaveLength(2); // mismatch noticed and resolved
  });

  it('ignores a lap count that changes after the line', () => {
    const { out } = run([[0, 5.995], [0.1, 5.002], [0.2, 5.005], [0.3, 6.008]]);
    expect(out.map((p) => +p.toFixed(3))).toEqual([5.995, 6.002, 6.005, 6.008]);
  });

  it('takes over a lap count that stays different (towed, reset)', () => {
    const steps: [number, number][] = [[0, 5.5]];
    for (let i = 1; i <= 40; i++) steps.push([i / 10, 4.5]); // count one lap lower for 4 s
    const { out } = run(steps);
    expect(out[10]).toBeCloseTo(5.5);
    expect(out[40]).toBeCloseTo(4.5);
  });

});

describe('trackGap (whole laps)', () => {
  it('adds whole laps for lapped cars', () => {
    expect(trackGap(car(4.5, 50), car(5.6, 58), 100)).toBeCloseTo(-108);
  });

  it('falls back to distance × lap time without estimates, null without lap time', () => {
    expect(trackGap(car(5.6, null), car(5.5, null), 100)).toBeCloseTo(10);
    expect(trackGap(car(5.6, null), car(5.5, null), null)).toBeNull();
  });
});

describe('computeStandings extras', () => {
  it('reports gap, lap difference, tyre age and pit status per row', () => {
    const cars: CarProgress[] = [
      { carIdx: 0, progress: 5.5, lastLap: 100, classId: 0, estTime: 50 },
      { carIdx: 1, progress: 5.6, lastLap: 99, classId: 0, estTime: 60, onPitRoad: true },
    ];
    const rows = computeStandings(cars, 0, info, 3, 3, { tyreLaps: (i) => (i === 1 ? 12 : null) });
    expect(rows[0]).toMatchObject({ carIdx: 1, gap: 10, lapsGap: 0, tyreLaps: 12, inPit: true });
    expect(rows[1]).toMatchObject({ carIdx: 0, gap: 0, isTeam: true, tyreLaps: null, inPit: false });
  });
});

describe('PitStopTracker', () => {
  it('counts laps since the car left pit road', () => {
    const p = new PitStopTracker();
    p.update([{ carIdx: 3, laps: 10, onPitRoad: false }]);
    expect(p.laps(3, 10)).toBeNull(); // first seen mid-race, no stop seen yet
    p.update([{ carIdx: 3, laps: 11, onPitRoad: true }]);
    p.update([{ carIdx: 3, laps: 11, onPitRoad: false }]);
    expect(p.laps(3, 15)).toBe(4);
  });

  it('counts from the start when the car is seen before its first lap', () => {
    const p = new PitStopTracker();
    p.update([{ carIdx: 1, laps: 0, onPitRoad: false }]);
    expect(p.laps(1, 7)).toBe(7);
    p.reset();
    expect(p.laps(1, 7)).toBeNull();
  });
});

describe('countryCode', () => {
  it('maps iRacing flair names to flag codes', () => {
    expect(countryCode('Germany')).toBe('de');
    expect(countryCode('Netherlands')).toBe('nl');
    expect(countryCode('United Kingdom')).toBe('gb');
    expect(countryCode('England')).toBe('gb-eng');
    expect(countryCode('Czech Republic')).toBe('cz');
    expect(countryCode('Bosnia and Herzegovina')).toBe('ba');
  });

  it('has no flag for Global / none', () => {
    expect(countryCode('Global')).toBeNull();
    expect(countryCode('-none-')).toBeNull();
    expect(countryCode(undefined)).toBeNull();
  });
});

describe('lappingRows', () => {
  const at = (carIdx: number, progress: number, classId = 0, onPitRoad = false): CarProgress =>
    ({ carIdx, progress, lastLap: 100, classId, onPitRoad });

  it('backmarker right in front, lapper right behind', () => {
    const rows = lappingRows([
      at(0, 10.50),
      at(1, 9.55, 1), // physically 5 % ahead, a lap down (other class) -> backmarker
      at(2, 10.60), // further ahead, same lap
      at(3, 11.47), // physically 3 % behind, a lap up -> lapper
      at(4, 10.40), // further behind, same lap
    ], 0, info, 100);
    expect(rows.map((r) => [r.carIdx, r.lap, r.otherClass])).toEqual([[1, 'backmarker', true], [3, 'lapper', false]]);
    expect(rows[0]!.gap).toBeCloseTo(5);
    expect(rows[1]!.gap).toBeCloseTo(-3);
  });

  it('nothing when the neighbours are on our lap, and cars in the pits are ignored', () => {
    expect(lappingRows([at(0, 10.5), at(1, 10.55), at(2, 10.45)], 0, info, 100)).toEqual([]);
    expect(lappingRows([at(0, 10.5), at(1, 9.52, 0, true), at(2, 10.6)], 0, info, 100)).toEqual([]);
  });
});

describe('betweenRows', () => {
  const at = (carIdx: number, progress: number, classId = 0, onPitRoad = false): CarProgress =>
    ({ carIdx, progress, lastLap: 100, classId, onPitRoad });

  it('cars on another lap between us and our class neighbours, nearest first', () => {
    const cars = [
      at(0, 10.50), // us
      at(1, 10.70), // class neighbour in front
      at(2, 10.30), // class neighbour behind
      at(3, 9.60, 1), // 10 % ahead, a lap down (other class)
      at(4, 8.55), // 5 % ahead, two laps down
      at(5, 10.60, 1), // 10 % ahead, same lap (other class) -> not shown
      at(6, 9.65, 0, true), // in the pits -> not shown
      at(7, 11.40, 1), // 10 % behind, a lap up
      at(8, 9.80), // further ahead than the neighbour in front -> not shown
    ];
    const { ahead, behind } = betweenRows(cars, 0, 1, 2, info, 100);
    expect(ahead.map((r) => [r.carIdx, r.lapsGap])).toEqual([[4, -2], [3, -1]]);
    expect(ahead[0]!.gap).toBeCloseTo(5);
    expect(ahead[1]!.otherClass).toBe(true);
    expect(behind.map((r) => [r.carIdx, r.lapsGap])).toEqual([[7, 1]]);
    expect(behind[0]!.gap).toBeCloseTo(-10);
  });

  it('nothing on a side without a class neighbour, at most `max` per side', () => {
    const cars = [at(0, 10.5), at(1, 10.9), ...[9.55, 9.6, 9.65, 9.7].map((p, i) => at(2 + i, p))];
    const { ahead, behind } = betweenRows(cars, 0, 1, null, info, 100, 3);
    expect(ahead.map((r) => r.carIdx)).toEqual([2, 3, 4]);
    expect(behind).toEqual([]);
  });

  it('neighbour more than a lap away: everything on the way counts', () => {
    const { ahead } = betweenRows([at(0, 10.5), at(1, 12.0), at(2, 9.9), at(3, 11.2)], 0, 1, null, info, 100);
    // car 2: 40 % ahead physically, a lap down; car 3: 70 % ahead on our lap -> not shown
    expect(ahead.map((r) => [r.carIdx, r.lapsGap])).toEqual([[2, -1]]);
  });
});

describe('practice and qualifying: ranking by best lap', () => {
  const best = (carIdx: number, t: number | null, classId = 0) => ({ carIdx, best: t, lastLap: t, classId });

  it('fastest first, own class only, cars without a time left out, gap to our best', () => {
    const rows = computeBestStandings([
      best(0, 101.5), best(1, 100.2), best(2, null), best(3, 99.9, 1), best(4, 102.0), best(5, 100.9),
    ], 0, info);
    expect(rows.map((r) => [r.pos, r.carIdx])).toEqual([[1, 1], [2, 5], [3, 0], [4, 4]]);
    expect(rows[0]!.gap).toBeCloseTo(-1.3); // 1.3 s faster than us
    expect(rows[3]!.gap).toBeCloseTo(0.5);
    expect(rows[2]).toMatchObject({ isTeam: true, gap: null, bestLap: 101.5 });
  });

  it('we have no time yet: listed last, no gaps', () => {
    const rows = computeBestStandings([best(0, null), best(1, 100), best(2, 101)], 0, info);
    expect(rows.map((r) => [r.pos, r.carIdx, r.gap])).toEqual([[1, 1, null], [2, 2, null], [3, 0, null]]);
  });

  it('session types from the YAML; only races keep the order on track', () => {
    const sessions = parseSessions('SessionInfo:\n Sessions:\n - SessionNum: 0\n   SessionType: Practice\n - SessionNum: 1\n   SessionType: Open Qualify\n - SessionNum: 2\n   SessionType: Race\n');
    expect([...sessions].map(([n, s]) => [n, s.type])).toEqual([[0, 'Practice'], [1, 'Open Qualify'], [2, 'Race']]);
    expect([0, 1, 2].map((n) => isRaceSession(sessions.get(n)?.type))).toEqual([false, false, true]);
    expect(isRaceSession(undefined)).toBe(true);
  });

  it('official results from the YAML decide order and best lap', () => {
    const sessions = parseSessions([
      'SessionInfo:', ' Sessions:', ' - SessionNum: 0', '   SessionType: Practice', '   ResultsPositions:',
      '   - Position: 1', '     CarIdx: 4', '     FastestTime: 100.5',
      '   - Position: 2', '     CarIdx: 0', '     FastestTime: 101.0',
      '   - Position: 3', '     CarIdx: 2', '     FastestTime: -1.0000', '',
    ].join('\n'));
    const results = sessions.get(0)!.results;
    expect(results).toEqual([{ carIdx: 4, position: 1, fastest: 100.5 }, { carIdx: 0, position: 2, fastest: 101 }, { carIdx: 2, position: 3, fastest: null }]);
    // Telemetry best laps include an invalid 99.0 of car 1 that the official results don't count.
    const field = officialBestLaps([best(0, 100.8), best(1, 99.0), best(2, 102.0), best(4, 100.5)], results);
    const rows = computeBestStandings(field, 0, info);
    expect(rows.map((r) => [r.pos, r.carIdx, r.bestLap])).toEqual([[1, 4, 100.5], [2, 0, 101]]);
  });
});

describe('practice and qualifying: projection of the lap in progress', () => {
  const best = (carIdx: number, t: number | null, classId = 0) => ({ carIdx, best: t, lastLap: t, classId });
  // Us (car 0) P4 with 101.0; ahead 100.0, 100.4, 100.8; behind 101.5.
  const cars = [best(0, 101.0), best(1, 100.0), best(2, 100.4), best(3, 100.8), best(4, 101.5), best(5, 99.0, 1)];

  it('a faster lap moves us up: new position, next car to beat and the time still to find', () => {
    const p = bestProjection(cars, 0, info, 100.6)!;
    expect(p.pos).toBe(3);
    expect(p.target).toMatchObject({ carIdx: 2, pos: 2, bestLap: 100.4 });
    expect(p.needed).toBeCloseTo(0.2);
  });

  it('a slower lap keeps our position; the loss counts towards the car in front', () => {
    const p = bestProjection(cars, 0, info, 101.3)!;
    expect(p.pos).toBe(4);
    expect(p.target?.carIdx).toBe(3);
    expect(p.needed).toBeCloseTo(0.5);
  });

  it('without a lap in progress: our best against the car in front', () => {
    const p = bestProjection(cars, 0, info, null)!;
    expect([p.pos, p.target?.carIdx]).toEqual([4, 3]);
    expect(p.needed).toBeCloseTo(0.2);
  });

  it('fastest of the class: nobody left to beat; a tie does not pass', () => {
    expect(bestProjection(cars, 0, info, 99.5)).toMatchObject({ pos: 1, target: null, needed: null });
    expect(bestProjection(cars, 0, info, 100.4)).toMatchObject({ pos: 3, target: { carIdx: 2 } });
  });

  it('no time at all yet: last, nothing to compare', () => {
    expect(bestProjection([best(0, null), best(1, 100)], 0, info, null)).toMatchObject({ pos: 2, target: null, needed: null });
  });
});

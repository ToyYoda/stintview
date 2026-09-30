import { describe, expect, it } from 'vitest';
import { countryCode } from './country.ts';
import { computeStandings, lappingRows, PitStopTracker, trackGap, type CarInfo, type CarProgress } from './standings.ts';

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

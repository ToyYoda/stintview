import { describe, expect, it } from 'vitest';
import { computeStandings, type CarInfo, type CarProgress } from './standings.ts';

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

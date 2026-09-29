import { describe, expect, it } from 'vitest';
import { packWords } from './irsdk/broadcast.ts';
import { findIncidentCar, parseTrackLength, type CarSnapshot } from './spectator.ts';

const L = 24_154; // Nordschleife combined, metres
const on = (pct: number, surface = 3, onPitRoad = false): CarSnapshot => ({ pct, surface, onPitRoad });
const absent: CarSnapshot = { pct: -1, surface: -1, onPitRoad: false };

describe('findIncidentCar', () => {
  it('picks the closest off-track car ahead of the team car', () => {
    const now = [on(0.5), on(0.52, 0), on(0.51, 0), on(0.49, 0)];
    const hit = findIncidentCar(now, null, 0, 0, L);
    expect(hit?.carIdx).toBe(2); // 0.51 is closer than 0.52; 0.49 is behind
    expect(hit?.reason).toBe('offtrack');
    expect(hit?.distanceAhead).toBeCloseTo(0.01 * L);
  });

  it('detects a stopped car on track from two snapshots, but not a moving one', () => {
    const prev = [on(0.5), on(0.505), on(0.51)];
    const now = [on(0.502), on(0.505), on(0.513)]; // car 1 stopped, car 2 at ~72 m/s
    const hit = findIncidentCar(now, prev, 1, 0, L);
    expect(hit?.carIdx).toBe(1);
    expect(hit?.reason).toBe('slow');
    expect(hit?.speed).toBeCloseTo(0);
  });

  it('wraps around the start/finish line', () => {
    const now = [on(0.99), on(0.01, 0)];
    const hit = findIncidentCar(now, null, 0, 0, L);
    expect(hit?.carIdx).toBe(1);
    expect(hit?.distanceAhead).toBeCloseTo(0.02 * L);
    // speed across the line is not a huge negative number
    const moving = findIncidentCar([on(0.99), on(0.0005)], [on(0.98), on(0.999)], 1, 0, L);
    expect(moving).toBeNull();
  });

  it('ignores cars too far ahead, in the pits or not in the world', () => {
    const now = [on(0.1), on(0.3, 0), on(0.11, 1), on(0.11, 3, true), absent];
    expect(findIncidentCar(now, null, 0, 0, L)).toBeNull();
  });
});

describe('helpers', () => {
  it('parses iRacing track lengths', () => {
    expect(parseTrackLength('24.1544 km')).toBeCloseTo(24_154.4);
    expect(parseTrackLength('2.50 mi')).toBeCloseTo(4023.36);
    expect(parseTrackLength(undefined)).toBe(0);
  });

  it('packs broadcast words like MAKELONG, including negative car numbers', () => {
    expect(packWords(1, 42)).toBe(0x002a0001);
    expect(packWords(1, -3)).toBe(0xfffd0001);
  });
});

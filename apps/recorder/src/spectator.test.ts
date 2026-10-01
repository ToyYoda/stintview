import { describe, expect, it } from 'vitest';
import { packWords } from './irsdk/broadcast.ts';
import type { Frame } from './irsdk/layout.ts';
import { NOT_ACCEPTED, Spectator, VERIFY_MS, findIncidentCar, parseTrackLength, type CarSnapshot } from './spectator.ts';

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

describe('Spectator: camera switch is verified', () => {
  const YAML = `WeekendInfo:
 TrackLength: 5.0 km
 SessionID: 1
 SubSessionID: 2
DriverInfo:
 Drivers:
 - CarIdx: 5
   UserName: Team Driver
   CarNumberRaw: 7
 - CarIdx: 12
   UserName: Crash Test
   CarNumberRaw: 44
CameraInfo:
 Groups:
 - GroupNum: 3
   GroupName: Chase
 - GroupNum: 4
   GroupName: Far Chase
`;
  const team = { carIdx: 5, carNumber: 7, sessionId: '1/2' };
  const frame = (camIdx: number) => ({
    num: (n: string) => ({ SessionTime: 100, CamCarIdx: camIdx, CamGroupNumber: 3, CamCameraNumber: 1 } as Record<string, number>)[n] ?? 0,
    bool: () => false, has: () => false, count: () => 0,
  }) as unknown as Frame;

  function setup() {
    let now = 0;
    const results: { ok: boolean; text: string }[] = [];
    const switches: number[][] = [];
    const s = new Spectator(
      (m) => { if (m.t === 'camera-result') results.push(m); },
      (car, group, cam) => { switches.push([car, group, cam]); },
      () => {},
      () => now,
    );
    s.onSessionInfo(YAML);
    s.setConnected(true);
    s.onFrame(frame(5), false); // watching the team car
    return { s, results, switches, advance: (ms: number) => { now += ms; } };
  }

  it('reports success only once iRacing shows the target car', () => {
    const { s, results, switches, advance } = setup();
    s.command({ t: 'camera', action: 'incident', team, targetCarIdx: 12 });
    expect(switches).toEqual([[44, 4, 0]]); // car #44 in Far Chase
    expect(results).toEqual([]);
    advance(300);
    s.onFrame(frame(12), false);
    expect(results).toEqual([{ t: 'camera-result', ok: true, text: '#44 Crash Test', code: 'jump-car', vars: { car: '#44 Crash Test' } }]);
  });

  it('reports a refused switch when the camera does not move (e.g. iRacing elevated)', () => {
    const { s, results, advance } = setup();
    s.command({ t: 'camera', action: 'incident', team, targetCarIdx: 12 });
    advance(VERIFY_MS + 1);
    s.onFrame(frame(5), false);
    expect(results).toEqual([{ t: 'camera-result', ok: false, text: NOT_ACCEPTED, code: 'not-accepted' }]);
  });

  it('verifies "back" against the team car and restores the previous camera', () => {
    const { s, results, switches, advance } = setup();
    s.command({ t: 'camera', action: 'incident', team, targetCarIdx: 12 });
    s.onFrame(frame(12), false);
    s.command({ t: 'camera', action: 'back', team });
    expect(switches.at(-1)).toEqual([7, 3, 1]); // team car, previous group/camera
    advance(200);
    s.onFrame(frame(5), false);
    expect(results.at(-1)).toMatchObject({ ok: true, text: 'Kamera zurück beim Team-Auto' });
  });

  it('refuses immediately while driving', () => {
    const { s, results, switches } = setup();
    s.onFrame(frame(5), true);
    s.command({ t: 'camera', action: 'incident', team, targetCarIdx: 12 });
    expect(switches).toEqual([]);
    expect(results[0]).toMatchObject({ ok: false });
  });
});

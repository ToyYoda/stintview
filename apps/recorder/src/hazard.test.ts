import { describe, expect, it } from 'vitest';
import type { Hazard } from '@stintview/protocol';
import { HazardDetector } from './hazard.ts';
import type { Frame } from './irsdk/layout.ts';

const L = 24_154;
const YAML = `WeekendInfo:
 TrackLength: 24.1544 km
 SessionID: 1
 SubSessionID: 2
DriverInfo:
 Drivers:
 - CarIdx: 0
   UserName: Anna
   CarNumberRaw: 7
 - CarIdx: 1
   UserName: Crash Test
   CarNumberRaw: 12
`;

interface Car { pct: number; surface?: number }

/** Minimal Frame stand-in: team car 0 plus other cars, positions as lap fraction. */
function frame(t: number, cars: Car[], onPitRoad = false): Frame {
  const vars: Record<string, number | number[]> = {
    SessionTime: t,
    PlayerCarIdx: 0,
    OnPitRoad: onPitRoad ? 1 : 0,
    CarIdxLapDistPct: cars.map((c) => c.pct),
    CarIdxTrackSurface: cars.map((c) => c.surface ?? 3),
    CarIdxOnPitRoad: cars.map(() => 0),
  };
  return {
    num: (name: string, i = 0) => { const v = vars[name]; return Array.isArray(v) ? v[i]! : (v ?? NaN); },
    bool: (name: string) => vars[name] === 1,
    has: (name: string) => name in vars,
    count: (name: string) => { const v = vars[name]; return Array.isArray(v) ? v.length : 0; },
  } as unknown as Frame;
}

/** Drives for `seconds` at 60 Hz: team car at ~60 m/s, other car per `other(t)`. */
function run(d: HazardDetector, from: number, seconds: number, other: (t: number) => Car, pit = false) {
  const out: Hazard[] = [];
  for (let t = from; t < from + seconds; t += 1 / 60) {
    const team = { pct: (0.1 + (t * 60) / L) % 1 };
    const msg = d.onFrame(frame(t, [team, other(t)], pit), true);
    if (msg) out.push(msg);
  }
  return out;
}

describe('HazardDetector', () => {
  it('reports a car stopped ahead once, then keeps it alive, then clears', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    const stopped = () => ({ pct: 0.1 + 600 / L }); // ~600 m ahead at start
    const first = run(d, 0, 3, stopped);
    expect(first[0]).toMatchObject({ t: 'hazard', active: true, carIdx: 1, carNumber: 12, driverName: 'Crash Test', reason: 'slow' });
    expect(first[0]!.distance).toBeGreaterThan(400);
    // it drives off at racing speed: cleared after CLEAR_AFTER_S
    const later = run(d, 3, 8, (t) => ({ pct: (0.1 + 600 / L + ((t - 3) * 70) / L) % 1 }));
    expect(later.at(-1)).toMatchObject({ active: false });
  });

  it('ignores a fast car running wide off track (track limits)', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    const wide = (t: number) => ({ pct: (0.1 + 500 / L + (t * 55) / L) % 1, surface: 0 });
    expect(run(d, 0, 4, wide).filter((m) => m.active)).toEqual([]);
  });

  it('reports a slow car crawling off track', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    const crawling = (t: number) => ({ pct: (0.1 + 500 / L + (t * 5) / L) % 1, surface: 0 });
    expect(run(d, 0, 3, crawling)[0]).toMatchObject({ active: true, reason: 'offtrack' });
  });

  it('ignores cars beyond the range and says nothing in the pit lane', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    expect(run(d, 0, 3, () => ({ pct: 0.1 + 3000 / L }))).toEqual([]);
    expect(run(d, 0, 3, () => ({ pct: 0.1 + 1000 / L }))).toEqual([]); // the spotter's range, not a sector ahead
    expect(run(d, 3, 3, () => ({ pct: 0.1 + 400 / L }), true)).toEqual([]);
  });

  it('ignores a car running wide at 70 km/h in a slow corner', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    const wide = (t: number) => ({ pct: (0.1 + 400 / L + (t * 19) / L) % 1, surface: 0 });
    expect(run(d, 0, 3, wide).filter((m) => m.active)).toEqual([]);
  });

  it('keeps the warning through session info updates of the same session', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    const stopped = () => ({ pct: 0.1 + 600 / L });
    expect(run(d, 0, 2, stopped)[0]).toMatchObject({ active: true });
    expect(d.onSessionInfo(`${YAML}SessionInfo:\n Sessions: []\n`)).toBeNull();
    // it drives off: the displays must get the clear (race 08.10.: dropped, banner stuck for minutes)
    const later = run(d, 2, 8, (t) => ({ pct: (0.1 + 600 / L + ((t - 2) * 70) / L) % 1 }));
    expect(later.at(-1)).toMatchObject({ active: false });
  });

  it('sends a clear when a new session starts during a warning', () => {
    const d = new HazardDetector();
    d.onSessionInfo(YAML);
    expect(run(d, 0, 2, () => ({ pct: 0.1 + 600 / L }))[0]).toMatchObject({ active: true });
    expect(d.onSessionInfo(YAML.replace('SessionID: 1', 'SessionID: 3'))).toMatchObject({ t: 'hazard', active: false });
    expect(d.onSessionInfo(YAML.replace('SessionID: 1', 'SessionID: 3'))).toBeNull();
  });
});

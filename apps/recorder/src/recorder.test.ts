import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@stintview/protocol';
import type { Frame } from './irsdk/layout.ts';
import { Recorder } from './recorder.ts';
import { parseSession } from './session.ts';

/** Team race YAML as seen on `localUserId`'s PC while `driverUserId` drives car 5. */
const teamYaml = (localUserId: number, driverUserId: number, driverName: string) => `WeekendInfo:
 TrackDisplayName: Nordschleife
 SessionID: 100
 SubSessionID: 200
SessionInfo:
 Sessions:
 - SessionType: Race
DriverInfo:
 DriverCarIdx: 5
 DriverUserID: ${localUserId}
 Drivers:
 - CarIdx: 5
   UserID: ${driverUserId}
   UserName: ${driverName}
   TeamName: Outcast Endurance
   CarNumberRaw: 7
 - CarIdx: 6
   UserID: 999
   UserName: Someone Else
   CarNumberRaw: 8
`;

const PHILIPP = 1;
const STEFAN = 2;

function frame(t: number, isOnTrack: boolean): Frame {
  const vars: Record<string, number> = { SessionTime: t, SessionNum: 0, IsOnTrack: isOnTrack ? 1 : 0, Lap: 1 };
  return {
    num: (name: string) => vars[name] ?? 0,
    bool: (name: string) => vars[name] === 1,
    has: (name: string) => name in vars,
    count: () => 0,
  } as unknown as Frame;
}

function drivingMessages(yaml: string, isOnTrack: boolean, seconds = 10) {
  const out: Extract<ClientMessage, { t: 'driving' }>[] = [];
  const r = new Recorder((m) => { if (m.t === 'driving') out.push(m); });
  r.onSessionInfo(yaml);
  for (let t = 0; t < seconds; t += 1 / 60) r.onFrame(frame(t, isOnTrack));
  return { out, recorder: r };
}

describe('Recorder: who is driving', () => {
  it('the car\'s current driver streams', () => {
    const { out } = drivingMessages(teamYaml(STEFAN, STEFAN, 'Stefan Behring'), true);
    expect(out[0]).toMatchObject({ driving: true, driverName: 'Stefan Behring', session: '100/200' });
  });

  it('a teammate following the team car does NOT count as driving (race 29.09., 17:07)', () => {
    // iRacing reports IsOnTrack on Philipp's PC while Stefan drives the team car.
    const { out } = drivingMessages(teamYaml(PHILIPP, STEFAN, 'Stefan Behring'), true);
    expect(out.every((m) => !m.driving)).toBe(true);
  });

  it('after a driver swap the previous driver stops streaming', () => {
    const { out, recorder } = drivingMessages(teamYaml(PHILIPP, PHILIPP, 'Phil Kipp'), true);
    expect(out.at(-1)?.driving).toBe(true);
    recorder.onSessionInfo(teamYaml(PHILIPP, STEFAN, 'Stefan Behring')); // iRacing updates the car's driver
    for (let t = 10; t < 15; t += 1 / 60) recorder.onFrame(frame(t, true));
    expect(out.at(-1)?.driving).toBe(false);
  });

  it('reports leaving the car when iRacing goes away while driving', () => {
    const { out, recorder } = drivingMessages(teamYaml(PHILIPP, PHILIPP, 'Phil Kipp'), true);
    expect(out.at(-1)?.driving).toBe(true);
    recorder.sourceLost();
    expect(out.at(-1)?.driving).toBe(false);
  });
});

describe('parseSession', () => {
  it('knows whether the local user drives their car', () => {
    expect(parseSession(teamYaml(PHILIPP, PHILIPP, 'Phil Kipp')).isCurrentDriver).toBe(true);
    expect(parseSession(teamYaml(PHILIPP, STEFAN, 'Stefan Behring')).isCurrentDriver).toBe(false);
    expect(parseSession('WeekendInfo:\n TrackDisplayName: x\n').isCurrentDriver).toBe(true); // unknown: don't block
  });
});

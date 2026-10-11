import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { pack, unpack, type ServerMessage, type SessionInfo, type Status } from '@stintview/protocol';
import { TeamFeed, forDisplay, type FeedState } from './team-feed.ts';
import { parseSessionYaml } from './session.ts';

const status = { t: 'status', sessionTime: 1 } as unknown as Status;
const session = { t: 'session', sessionId: '1/2', carIdx: 3 } as unknown as SessionInfo;
const inputs = { t: 'inputs', st: 0, dt: 1 / 30, samples: [] } as unknown as ServerMessage;

describe('forDisplay', () => {
  it('passes only the types a page shows, control messages and the session always', () => {
    const types = new Set(['standings']);
    expect(forDisplay(status, types)).toBeNull();
    expect(forDisplay(inputs, types)).toBeNull();
    expect(forDisplay(session, types)).toBe(session);
    const active = { t: 'active', driverName: 'A', memberName: null, since: 0 };
    expect(forDisplay(active, types)).toBe(active);
    expect(forDisplay({ t: 'message', id: 1 }, types)).toEqual({ t: 'message', id: 1 });
    expect(forDisplay({ t: 'feed-conn', conn: 'connected' }, new Set())).toEqual({ t: 'feed-conn', conn: 'connected' });
    expect(forDisplay({ t: 'driving', driving: true }, new Set())).toEqual({ t: 'driving', driving: true });
    expect(forDisplay(status, new Set(['status']))).toBe(status);
    expect(forDisplay(status, null)).toBe(status);
  });

  it('filters the telemetry inside a snapshot', () => {
    const snap = { t: 'snapshot', active: null, telemetry: [status, session], messages: [] };
    expect(forDisplay(snap, new Set<string>())!.telemetry).toEqual([session]);
    expect(forDisplay(snap, new Set(['status']))!.telemetry).toEqual([status, session]);
  });
});

describe('TeamFeed', () => {
  let wss: WebSocketServer | null = null;
  let feed: TeamFeed | null = null;
  afterEach(() => {
    feed?.stop();
    wss?.close();
  });

  it('connects as display, reports the connection and keeps the latest state for later pages', async () => {
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    const hello = new Promise<{ role: string }>((resolve) => wss!.on('connection', (ws: WebSocket) => {
      ws.on('message', (d: Buffer) => {
        resolve(unpack<{ t: string; role: string }>(d));
        ws.send(pack({ t: 'welcome', v: 3, teamName: 'Outcast Endurance', memberName: 'X' } as unknown as ServerMessage));
        ws.send(pack({ t: 'snapshot', active: { t: 'active', driverName: 'D', memberName: 'D', since: 1 }, telemetry: [session], messages: [] }));
        ws.send(pack(status));
        ws.send(pack(inputs));
      });
    }));
    const states: FeedState[] = [];
    const got: string[] = [];
    let done!: () => void;
    const all = new Promise<void>((r) => { done = r; });
    feed = new TeamFeed(`http://localhost:${port}`, 'token', {
      onState: (s) => states.push(s),
      onMessage: (m) => { got.push(m.t); if (m.t === 'inputs') done(); },
    });
    feed.start();
    expect((await hello).role).toBe('overlay');
    await all;
    expect(states.at(-1)).toMatchObject({ conn: 'connected', teamName: 'Outcast Endurance' });
    expect(got).toEqual(['snapshot', 'status', 'inputs']);
    const later = feed.snapshot();
    expect(later.state.conn).toBe('connected');
    expect(later.snapshot.active.driverName).toBe('D');
    // Latest per type, no input samples.
    expect(later.snapshot.telemetry.map((m) => m.t).sort()).toEqual(['session', 'status']);
  });
});

describe('parseSessionYaml', () => {
  it('parses each update once and shares the result', () => {
    const a = parseSessionYaml<{ WeekendInfo: { TrackID: number } }>('WeekendInfo:\n  TrackID: 7\n');
    expect(a.WeekendInfo.TrackID).toBe(7);
    expect(parseSessionYaml('WeekendInfo:\n  TrackID: 7\n')).toBe(a);
    expect(parseSessionYaml<{ WeekendInfo: { TrackID: number } }>('WeekendInfo:\n  TrackID: 8\n').WeekendInfo.TrackID).toBe(8);
  });
});

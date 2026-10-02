import { describe, expect, it } from 'vitest';
import type { ServerMessage, Status, Telemetry } from '@stintview/protocol';
import { ACTIVE_STALE_MS, Room, SESSION_STALE_MS, type Peer } from './room.ts';

const RACE = '100/5000';
const PRACTICE = '101/6000';

function setup() {
  let now = 1_000_000;
  const room = new Room('team', () => now);
  const peer = (id: number, name: string) => {
    const got: ServerMessage[] = [];
    const p: Peer = { id, memberName: name, send: (m) => got.push(m) };
    return Object.assign(p, { got });
  };
  const overlay = peer(99, 'viewer');
  room.addOverlay(overlay);
  const status = (lap: number): Status => ({
    t: 'status', sessionTime: lap, lap, lapDistPct: 0, fuelLevel: 50, onPitRoad: false,
    odometer: { LF: 0, RF: 0, LR: 0, RR: 0 }, flags: 0,
  });
  const received = () => overlay.got.filter((m): m is Telemetry => m.t === 'status');
  return { room, peer, overlay, status, received, advance: (ms: number) => { now += ms; } };
}

describe('Room: only the driver in the car reaches the overlays', () => {
  it('relays telemetry of the active driver only', () => {
    const { room, peer, status, received } = setup();
    const a = peer(1, 'Anna'), b = peer(2, 'Ben');
    room.addRecorder(a);
    room.addRecorder(b);
    expect(room.driving(a, true, 'Anna', RACE)).toBe(true);
    room.telemetry(a, status(1));
    room.telemetry(b, status(2)); // Ben is not in the car
    expect(received().map((m) => (m as Status).lap)).toEqual([1]);
  });

  it('never displaces a driver who is still streaming (early claim, second car)', () => {
    const { room, peer, status, received, advance } = setup();
    const a = peer(1, 'Anna'), b = peer(2, 'Ben');
    room.driving(a, true, 'Anna', RACE);
    for (let i = 0; i < 5; i++) {
      advance(2000);
      room.telemetry(a, status(i));
      expect(room.driving(b, true, 'Ben', RACE)).toBe(false);
      room.telemetry(b, status(100 + i));
    }
    expect(b.got).toContainEqual({ t: 'standby', reason: 'other-driver' });
    expect(received().every((m) => (m as Status).lap < 100)).toBe(true);
  });

  it('hands over after a driver change', () => {
    const { room, peer, overlay, advance } = setup();
    const a = peer(1, 'Anna'), b = peer(2, 'Ben');
    room.driving(a, true, 'Anna', RACE);
    advance(1000);
    expect(room.driving(b, true, 'Ben', RACE)).toBe(false); // Anna not out yet
    room.driving(a, false, 'Anna', RACE); // Anna leaves the car
    advance(2000);
    expect(room.driving(b, true, 'Ben', RACE)).toBe(true); // Ben's next periodic claim
    const actives = overlay.got.filter((m) => m.t === 'active').map((m) => (m as { driverName: string | null }).driverName);
    expect(actives).toEqual(['Anna', null, 'Ben']);
  });

  it('takes over from a driver whose recorder went silent', () => {
    const { room, peer, advance } = setup();
    const a = peer(1, 'Anna'), b = peer(2, 'Ben');
    room.driving(a, true, 'Anna', RACE);
    advance(ACTIVE_STALE_MS + 1);
    expect(room.driving(b, true, 'Ben', RACE)).toBe(true);
  });

  it('refuses a teammate practising in another session while the race runs', () => {
    const { room, peer, status, received, advance } = setup();
    const a = peer(1, 'Anna'), c = peer(3, 'Chris');
    room.driving(a, true, 'Anna', RACE);
    room.telemetry(a, status(1));
    room.driving(a, false, 'Anna', RACE); // pit stop / driver swap window
    advance(3000);
    expect(room.driving(c, true, 'Chris', PRACTICE)).toBe(false);
    room.telemetry(c, status(200));
    expect(c.got).toContainEqual({ t: 'standby', reason: 'other-session' });
    expect(received().map((m) => (m as Status).lap)).toEqual([1]);
    // The next race driver still gets in.
    const b = peer(2, 'Ben');
    expect(room.driving(b, true, 'Ben', RACE)).toBe(true);
  });

  it('accepts a new session once the old one has been quiet long enough', () => {
    const { room, peer, advance } = setup();
    const a = peer(1, 'Anna'), c = peer(3, 'Chris');
    room.driving(a, true, 'Anna', RACE);
    room.driving(a, false, 'Anna', RACE);
    advance(SESSION_STALE_MS + 1);
    expect(room.driving(c, true, 'Chris', PRACTICE)).toBe(true);
  });

  it('frees the slot when the active recorder disconnects', () => {
    const { room, peer } = setup();
    const a = peer(1, 'Anna'), b = peer(2, 'Ben');
    room.driving(a, true, 'Anna', RACE);
    room.remove(a.id);
    expect(room.driving(b, true, 'Ben', RACE)).toBe(true);
  });
});

describe('Room: silent active driver', () => {
  it('releases the active driver after ACTIVE_STALE_MS without data (iRacing crashed)', () => {
    const { room, peer, overlay, advance } = setup();
    const a = peer(1, 'Anna');
    room.driving(a, true, 'Anna', RACE);
    advance(ACTIVE_STALE_MS - 1);
    expect(room.expire()).toBe(false);
    advance(2);
    expect(room.expire()).toBe(true);
    const actives = overlay.got.filter((m) => m.t === 'active').map((m) => (m as { driverName: string | null }).driverName);
    expect(actives).toEqual(['Anna', null]);
  });

  it('keeps a driver whose recorder keeps claiming', () => {
    const { room, peer, advance } = setup();
    const a = peer(1, 'Anna');
    room.driving(a, true, 'Anna', RACE);
    for (let i = 0; i < 10; i++) {
      advance(2000);
      room.driving(a, true, 'Anna', RACE);
      expect(room.expire()).toBe(false);
    }
  });
});

describe('Room: team messages', () => {
  const messages = (got: ServerMessage[]) => got.filter((m) => m.t === 'message');

  it('relays to overlays that understand messages, with the sender', () => {
    const { room, peer, overlay } = setup(); // `overlay` is an older client
    const spotter = peer(1, 'Ben');
    const viewer = Object.assign(peer(2, 'Anna'), { messages: true });
    room.addRecorder(spotter);
    room.addOverlay(viewer);
    expect(room.message(spotter, '  Box   diese Runde ', 'red')).toMatchObject({ text: 'Box diese Runde', color: 'red', from: 'Ben' });
    expect(messages(viewer.got)).toHaveLength(1);
    expect(messages(overlay.got)).toHaveLength(0);
  });

  it('drops empty texts, unknown colours and repeats within a second; cuts long texts', () => {
    const { room, peer, advance } = setup();
    const s = peer(1, 'Ben');
    expect(room.message(s, '   ', 'red')).toBeNull();
    expect(room.message(s, 'Push', 'pink')).toBeNull();
    expect(room.message(s, 'Push', 'green')).not.toBeNull();
    expect(room.message(s, 'Push', 'green')).toBeNull(); // held hotkey
    advance(1000);
    expect(room.message(s, 'x'.repeat(100), 'white')!.text).toHaveLength(60);
  });

  it('late overlays get the last messages in the snapshot', () => {
    const { room, peer, advance } = setup();
    const s = peer(1, 'Ben');
    for (let i = 0; i < 12; i++) {
      room.message(s, `m${i}`, 'blue');
      advance(1000);
    }
    const late = Object.assign(peer(3, 'Cleo'), { messages: true });
    room.addOverlay(late);
    const snap = late.got.find((m) => m.t === 'snapshot');
    expect(snap?.t === 'snapshot' && snap.messages?.map((m) => m.text)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']);
    const old = peer(4, 'Dan');
    room.addOverlay(old);
    const oldSnap = old.got.find((m) => m.t === 'snapshot');
    expect(oldSnap?.t === 'snapshot' && oldSnap.messages).toBeUndefined();
  });
});

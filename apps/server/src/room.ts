import {
  MESSAGE_COLORS, MESSAGE_MAX_LENGTH,
  type ActiveDriver, type Fuel, type FuelLap, type MessageColor, type ServerMessage, type SessionInfo, type Snapshot,
  type TeamMessage, type Telemetry, type Tyres, type WeatherEvent,
} from '@stintview/protocol';

export interface Peer {
  id: number;
  memberName: string;
  send(msg: ServerMessage): void;
  /** Understands team messages (hello feature 'messages'); older overlays would choke on them. */
  messages?: boolean;
}

/** Team messages kept for overlays that connect later. */
export const MESSAGE_HISTORY = 10;
/** A sender's messages this close together are dropped (held hotkey, double click). */
export const MESSAGE_COOLDOWN_MS = 1000;

/** An active driver silent this long (crash, network loss) can be replaced. */
export const ACTIVE_STALE_MS = 10_000;
/** The last race session stays reserved this long after its last data. */
export const SESSION_STALE_MS = 5 * 60_000;

/**
 * One team. At most one recorder at a time is the active source, and only its
 * telemetry is relayed to overlays.
 *
 * Handover rules (every teammate runs a recorder; several may claim to be driving):
 * - A driver who is still streaming is never displaced. This covers teams running
 *   two cars and a claim that arrives before the previous driver has left the car.
 * - A claim from a different iRacing session (e.g. someone practising elsewhere) is
 *   refused while the team's last session produced data within SESSION_STALE_MS.
 * Refused recorders keep re-claiming every few seconds and take over once allowed.
 *
 * Fuel laps and tyre measurements are merged across drivers so a new driver's
 * overlay history continues seamlessly after a driver change.
 */
export class Room {
  private readonly recorders = new Map<number, Peer>();
  private readonly overlays = new Map<number, Peer>();
  private activeId: number | null = null;
  private active: ActiveDriver;
  private latest = new Map<Telemetry['t'], Telemetry>();
  private fuelLaps = new Map<number, FuelLap>();
  private tankCapacity = 0;
  private tyreMeasurements: Tyres['measurements'] = [];
  private weatherEvents: WeatherEvent[] = [];
  private sessionKey: string | null = null;
  /** iRacing session of the most recent active driver, and when it last sent data. */
  private raceSession: string | null = null;
  private lastDataAt = 0;
  private messages: TeamMessage[] = [];
  private nextMessageId = 1;
  private lastMessageAt = new Map<number, number>();

  constructor(readonly teamId: string, private readonly now: () => number = Date.now) {
    this.active = { t: 'active', driverName: null, memberName: null, since: now() };
  }

  get empty() {
    return this.recorders.size === 0 && this.overlays.size === 0;
  }

  addOverlay(p: Peer) {
    this.overlays.set(p.id, p);
    const snapshot: Snapshot = { t: 'snapshot', active: this.active, telemetry: [...this.latest.values()] };
    if (p.messages) snapshot.messages = this.messages;
    p.send(snapshot);
  }

  addRecorder(p: Peer) {
    this.recorders.set(p.id, p);
  }

  remove(id: number) {
    this.overlays.delete(id);
    this.recorders.delete(id);
    this.lastMessageAt.delete(id);
    if (id === this.activeId) this.setActive(null, null);
  }

  /** Returns whether `p` is the active source afterwards. */
  driving(p: Peer, driving: boolean, driverName: string, session: string): boolean {
    if (!driving) {
      if (this.activeId === p.id) this.setActive(null, null);
      return false;
    }
    if (this.activeId === p.id) {
      this.lastDataAt = this.now();
      return true;
    }

    const now = this.now();
    const dataStale = now - this.lastDataAt > ACTIVE_STALE_MS;
    if (this.activeId !== null && !dataStale) {
      // Another session counts first: that recorder's displays then show their own data.
      p.send({ t: 'standby', reason: session !== this.raceSession ? 'other-session' : 'other-driver' });
      return false;
    }
    if (this.raceSession !== null && session !== this.raceSession && now - this.lastDataAt <= SESSION_STALE_MS) {
      p.send({ t: 'standby', reason: 'other-session' });
      return false;
    }
    if (session !== this.raceSession) this.clearHistory();
    this.raceSession = session;
    this.lastDataAt = now; // the claim itself counts as a sign of life
    this.setActive(p, driverName);
    return true;
  }

  /**
   * Releases an active driver that went silent (iRacing crashed, PC froze, network gone
   * without the socket closing). Called periodically; returns true if released.
   */
  expire(): boolean {
    if (this.activeId === null || this.now() - this.lastDataAt <= ACTIVE_STALE_MS) return false;
    this.setActive(null, null);
    return true;
  }

  telemetry(p: Peer, msg: Telemetry) {
    if (p.id !== this.activeId) return;
    this.lastDataAt = this.now();
    const out = this.merge(msg);
    this.latest.set(out.t, out);
    this.broadcast(out);
  }

  /**
   * A message from any teammate (recorder or overlay connection) to everyone who can show it.
   * Empty texts and unknown colours are dropped, long texts cut. Returns the relayed message.
   */
  message(p: Peer, text: unknown, color: unknown): TeamMessage | null {
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX_LENGTH) : '';
    if (!clean || !MESSAGE_COLORS.includes(color as MessageColor)) return null;
    const now = this.now();
    if (now - (this.lastMessageAt.get(p.id) ?? -Infinity) < MESSAGE_COOLDOWN_MS) return null;
    this.lastMessageAt.set(p.id, now);
    const msg: TeamMessage = { t: 'message', id: this.nextMessageId++, text: clean, color: color as MessageColor, from: p.memberName, at: now };
    this.messages = [...this.messages, msg].slice(-MESSAGE_HISTORY);
    for (const o of this.overlays.values()) if (o.messages) o.send(msg);
    return msg;
  }

  private merge(msg: Telemetry): Telemetry {
    switch (msg.t) {
      case 'session': return this.onSession(msg);
      case 'fuel': {
        for (const l of msg.laps) this.fuelLaps.set(l.lap, l);
        const laps = [...this.fuelLaps.values()].sort((a, b) => a.lap - b.lap).slice(-50);
        this.fuelLaps = new Map(laps.map((l) => [l.lap, l]));
        this.tankCapacity = msg.tankCapacity || this.tankCapacity;
        return { t: 'fuel', laps, tankCapacity: this.tankCapacity } satisfies Fuel;
      }
      case 'tyres': {
        const byTime = new Map(this.tyreMeasurements.map((m) => [m.sessionTime, m]));
        for (const m of msg.measurements) byTime.set(m.sessionTime, m);
        this.tyreMeasurements = [...byTime.values()].sort((a, b) => a.sessionTime - b.sessionTime).slice(-20);
        return { t: 'tyres', measurements: this.tyreMeasurements };
      }
      case 'weather': {
        // Each driver's recorder only knows the changes it saw; keep the team's whole list.
        const key = (e: WeatherEvent) => `${e.sessionTime}|${e.kind}`;
        const byKey = new Map(this.weatherEvents.map((e) => [key(e), e]));
        for (const e of msg.events) byKey.set(key(e), e);
        this.weatherEvents = [...byKey.values()].sort((a, b) => a.sessionTime - b.sessionTime).slice(-30);
        return { t: 'weather', now: msg.now, events: this.weatherEvents };
      }
      default: return msg;
    }
  }

  private onSession(msg: SessionInfo): SessionInfo {
    const key = `${msg.track}|${msg.car}|${msg.sessionType}`;
    // Practice -> qualifying -> race within one event: history no longer applies.
    if (this.sessionKey !== null && key !== this.sessionKey) this.clearHistory();
    this.sessionKey = key;
    return msg;
  }

  private clearHistory() {
    this.fuelLaps.clear();
    this.tyreMeasurements = [];
    this.weatherEvents = [];
    this.latest.clear();
  }

  private setActive(p: Peer | null, driverName: string | null) {
    this.activeId = p?.id ?? null;
    this.active = { t: 'active', driverName, memberName: p?.memberName ?? null, since: this.now() };
    this.latest.delete('inputs');
    this.latest.delete('hazard'); // belongs to the previous driver's view of the track
    this.latest.delete('standings'); // rows are relative to the previous driver's car
    this.latest.delete('pitplan');
    this.broadcast(this.active);
  }

  private broadcast(msg: ServerMessage) {
    for (const o of this.overlays.values()) o.send(msg);
  }
}

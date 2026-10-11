import WebSocket from 'ws';
import {
  PROTOCOL_VERSION, isTelemetry, pack, unpack,
  type ActiveDriver, type ServerMessage, type TeamMessage, type Telemetry,
} from '@stintview/protocol';

/**
 * The team relay's data for this PC's display pages, over one connection in the desktop app's main
 * process (since 0.25). Before, every panel window had its own connection and got everything;
 * the app now hands each page only the message types its panel shows (`forDisplay`).
 */

export type FeedConn = 'no-config' | 'connecting' | 'connected' | 'error';

/** Connection state for the header, sent to the pages as a message of its own. */
export interface FeedState { t: 'feed-conn'; conn: FeedConn; error: string | null; teamName: string }

/** What a page opening later gets first: the state so far, as the relay's snapshot would be. */
export interface FeedSnapshot { state: FeedState; snapshot: Extract<ServerMessage, { t: 'snapshot' }> }

/** Telemetry types every page gets: who drives, which session (resets the rest) – few and small. */
const ALWAYS = new Set<string>(['session', 'driving']);
/** Team messages are kept like the relay keeps them (newest 10). */
const MAX_MESSAGES = 10;

/**
 * `msg` as far as a page that shows `types` needs it (null = not at all); `types` null = everything.
 * Control messages (active driver, team messages, connection state, session) always pass.
 */
export function forDisplay<T extends { t: string }>(msg: T, types: ReadonlySet<string> | null): T | null {
  if (!types) return msg;
  if (msg.t === 'snapshot') {
    const s = msg as unknown as Extract<ServerMessage, { t: 'snapshot' }>;
    return { ...s, telemetry: s.telemetry.filter((m) => ALWAYS.has(m.t) || types.has(m.t)) } as unknown as T;
  }
  if (!isTelemetry(msg) || ALWAYS.has(msg.t)) return msg;
  return types.has(msg.t) ? msg : null;
}

export interface TeamFeedEvents {
  /** Every relay message except welcome/error/standby (those become `onState`). */
  onMessage(msg: ServerMessage): void;
  onState(state: FeedState): void;
}

/** WebSocket link to the relay as display ('overlay' role) with reconnect; keeps the latest state. */
export class TeamFeed {
  private ws: WebSocket | null = null;
  private retry = 1000;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private state: FeedState = { t: 'feed-conn', conn: 'connecting', error: null, teamName: '' };
  private active: ActiveDriver = { t: 'active', driverName: null, memberName: null, since: Date.now() };
  /** Latest telemetry per type (not inputs) – what a page that was open all along would hold. */
  private latest = new Map<string, Telemetry>();
  private messages: TeamMessage[] = [];

  constructor(private readonly serverUrl: string, private readonly token: string, private readonly events: TeamFeedEvents) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }

  snapshot(): FeedSnapshot {
    return {
      state: this.state,
      snapshot: { t: 'snapshot', active: this.active, telemetry: [...this.latest.values()], messages: this.messages },
    };
  }

  private setState(patch: Partial<FeedState>) {
    this.state = { ...this.state, ...patch };
    this.events.onState(this.state);
  }

  private connect() {
    const url = new URL(this.serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, role: 'overlay', features: ['messages'] })));
    ws.on('message', (data: Buffer) => this.onMessage(unpack<ServerMessage>(data)));
    ws.on('close', () => {
      if (this.ws !== ws || this.stopped) return;
      if (this.state.conn !== 'error') this.setState({ conn: 'connecting' });
      this.timer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    });
    ws.on('error', () => {}); // 'close' follows and handles reconnect
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        this.retry = 1000;
        return this.setState({ conn: 'connected', error: null, teamName: m.teamName });
      case 'error': return this.setState({ conn: 'error', error: m.message });
      case 'standby': return; // recorder-only
      case 'active': this.active = m; break;
      case 'snapshot':
        this.active = m.active;
        for (const x of m.telemetry) this.keep(x);
        if (m.messages) this.messages = m.messages.slice(-MAX_MESSAGES);
        break;
      case 'message':
        this.messages = [...this.messages.filter((x) => x.id !== m.id), m].slice(-MAX_MESSAGES);
        break;
      default: if (isTelemetry(m)) this.keep(m);
    }
    this.events.onMessage(m);
  }

  private keep(m: Telemetry) {
    if (m.t !== 'inputs') this.latest.set(m.t, m);
  }
}

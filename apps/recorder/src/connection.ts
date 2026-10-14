import WebSocket from 'ws';
import {
  PROTOCOL_VERSION, pack, unpack, type ClientMessage, type ServerMessage,
} from '@stintview/protocol';
import { isCertError, wsTarget, type Target } from './server-link.ts';

export interface ConnectionEvents {
  onOpen(): ClientMessage[];
  onStatus(status: string): void;
  /** Every standby reply to a driving claim (they repeat every 2 s while it lasts). */
  onStandby?(reason: 'other-driver' | 'other-session'): void;
  /** Team message from the spotter (only asked for when `onMessage` is set). */
  onMessage?(msg: Extract<ServerMessage, { t: 'message' }>): void;
}

/** Status when the server shows another certificate than the one remembered at the first contact. */
export const CERT_CHANGED = 'server error: the team server\'s certificate has changed – join the team again';

/**
 * WebSocket link to the relay with automatic reconnect.
 * While disconnected, messages are dropped; on reconnect the recorder resends its
 * full state via `onOpen` so nothing important is lost.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private retry = 1000;
  private closed = false;
  private ready = false;
  private lastStandby: string | null = null;

  constructor(
    /** Where the server is, asked before every attempt (see `serverTarget`). */
    private readonly target: () => Promise<Target>,
    private readonly token: string,
    private readonly events: ConnectionEvents,
  ) {}

  connect() {
    void this.open();
  }

  private async open() {
    let target: Target;
    try {
      target = await this.target();
    } catch (e) {
      return this.retryLater(`disconnected (${(e as Error).message})`);
    }
    if (this.closed) return;
    const { url, options } = wsTarget(target);
    const ws = new WebSocket(url, options);
    this.ws = ws;
    let certError = false;
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => {
      ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, role: 'recorder', ...(this.events.onMessage ? { features: ['messages'] } : {}) }));
    });
    ws.on('message', (data: Buffer) => {
      const msg = unpack<ServerMessage>(data);
      if (msg.t === 'welcome') {
        this.ready = true;
        this.retry = 1000;
        this.lastStandby = null;
        this.events.onStatus(`connected to team "${msg.teamName}" as ${msg.memberName}`);
        for (const m of this.events.onOpen()) this.send(m);
      } else if (msg.t === 'standby') {
        this.events.onStandby?.(msg.reason);
        // Claims repeat every 2 s; report each reason once.
        if (msg.reason === this.lastStandby) return;
        this.lastStandby = msg.reason;
        this.events.onStatus(msg.reason === 'other-session'
          ? 'standby: the team is streaming another iRacing session – not shown to the team'
          : 'standby: another teammate is still streaming – taking over once they leave the car');
      } else if (msg.t === 'message') {
        this.events.onMessage?.(msg);
      } else if (msg.t === 'error') {
        this.events.onStatus(`server error: ${msg.message}`);
        if (msg.code !== 'protocol') this.closed = true; // retrying won't help
      }
    });
    ws.on('close', (code, reason) => {
      this.ready = false;
      if (this.closed) return this.events.onStatus(`disconnected (${code} ${reason})`);
      // Not the remembered certificate: someone in between, or the server moved to another PC.
      if (certError) return this.retryLater(CERT_CHANGED);
      this.retryLater('disconnected');
    });
    ws.on('error', (e) => { certError ||= isCertError(e); }); // 'close' follows and handles reconnect
  }

  private retryLater(status: string) {
    this.events.onStatus(status === CERT_CHANGED ? status : `${status}, retrying in ${this.retry / 1000}s`);
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 30_000);
  }

  send(msg: ClientMessage) {
    // Drop telemetry under backpressure rather than building latency.
    if (!this.ready || !this.ws || this.ws.bufferedAmount > 64 * 1024) return;
    this.ws.send(pack(msg));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

import { useEffect, useRef, useState } from 'react';
import {
  PROTOCOL_VERSION, pack, unpack,
  type ActiveDriver, type Fuel, type InputSample, type Inputs, type ServerMessage,
  type Hazard, type Pitplan, type SessionInfo, type Standings, type Status, type Telemetry, type Tyres, type Weather,
} from '@stintview/protocol';

export interface LocalConfig { serverUrl: string; token: string; teamName: string; memberName: string }

/** Desktop app state, see electron/app.cjs appState(). */
export interface HotkeyGroup {
  title: string;
  /** Why the group is inactive right now, null if active. */
  note: string | null;
  /** key: the key this function got (null = all candidates taken by other programs). */
  /** taken: preferred keys another program holds; alternatives: spares if this one gets taken. */
  items: { label: string; key: string | null; taken: string[]; alternatives: string[]; active: boolean }[];
}

export type StandingsColumn = 'pos' | 'num' | 'flag' | 'name' | 'best' | 'gap' | 'tyre' | 'delta';
/** Position panel: which columns, and whether lapping cars are shown. */
export interface StandingsOptions { columns: Record<StandingsColumn, boolean>; lapping: boolean; duel: boolean }

export interface PanelSetting {
  shown: boolean;
  size: number;
  /** Panel-specific (only the Position panel has some so far). */
  options?: StandingsOptions;
}

/** Sent to the overlay pages: size factor and options per panel. */
export type PanelConfig = Record<string, { scale: number; options: StandingsOptions | null }>;

export interface AppState {
  version: string;
  configured: boolean;
  team: { teamName: string; memberName: string; serverUrl: string; inviteCode: string } | null;
  settings: {
    /** Panels shown at all, and where: monitor overlay or VR (one at a time). */
    overlay: boolean; output: 'monitor' | 'vr'; autostart: boolean; server: boolean; serverPort: number;
    /** UI language. */
    language: 'de' | 'en';
    /** Per panel: shown, size in percent, panel-specific options. */
    panels: Record<string, PanelSetting>;
    /** Panel background opacity in percent, all panels. */
    opacity: number;
    pitStop: { fillRate: number | null; tyreTime: number | null; regulation: 'auto' | 'standard' | 'imsa' | 'nec' | 'dtm' };
  };
  status: {
    line: string;
    iracing: boolean;
    server: 'offline' | 'connected' | 'standby' | 'error';
    serverText: string;
    inCar: boolean;
    relay: 'off' | 'running' | 'error';
    vr: 'off' | 'waiting' | 'connected';
    overlay: boolean;
    editing: boolean;
    editHotkey: string | null;
  };
  autostartAvailable: boolean;
  cameraHotkeys: { incident: string | null; back: string | null };
  /** Pit lane loss import from the .ibt archive. */
  pitImport: {
    running: boolean; finished: boolean; done: number; total: number; passes: number; tracks: number;
    folder: string | null; error: string | null;
  };
  hotkeys: HotkeyGroup[];
  update: {
    phase: 'unavailable' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error';
    version: string;
    percent: number;
    error: string;
    label: string;
  };
}

declare global {
  interface Window {
    stintview?: {
      getConfig(): Promise<LocalConfig | null>;
      onEditMode(cb: (edit: boolean, hotkey: string | null) => void): void;
      setEditMode(on?: boolean): Promise<AppState>;
      setInteractive(on: boolean): void;
      onPanels?(cb: (ids: string[]) => void): void;
      onOpacity?(cb: (value: number) => void): void;
      onPanelConfig?(cb: (cfg: PanelConfig) => void): void;
      onLanguage?(cb: (lang: 'de' | 'en') => void): void;
      setTeamCar(team: { carIdx: number; carNumber: number; sessionId: string }): void;
      setHazard?(carIdx: number | null): void;
      camera(action: 'incident' | 'back', targetCarIdx?: number): Promise<void>;
      getCameraInfo(): Promise<{ state: unknown; hotkeys: { incident: string | null; back: string | null } }>;
      onCamera(cb: (m: { t: 'camera-state' | 'camera-result' } & Record<string, unknown>) => void): void;
      getState(): Promise<AppState>;
      onState(cb: (state: AppState) => void): void;
      join(data: { serverUrl: string; inviteCode: string; memberName: string }): Promise<AppState>;
      create(data: { serverUrl: string; teamName: string; memberName: string; hostHere: boolean }): Promise<AppState>;
      updateSettings(patch: Partial<AppState['settings']>): Promise<AppState>;
      leave(): Promise<AppState>;
      checkUpdate(): Promise<AppState>;
      installUpdate(): Promise<void>;
      pitImport(choose: boolean): Promise<AppState>;
    };
  }
}

export async function loadLocalConfig(): Promise<LocalConfig | null> {
  if (window.stintview) return window.stintview.getConfig();
  const res = await fetch('/local-config');
  return res.ok ? res.json() : null;
}

/** Input samples in a ring buffer, read by canvas widgets every animation frame. */
export class InputBuffer {
  readonly times: number[] = [];
  readonly samples: InputSample[] = [];
  steerMax = Math.PI * 1.5;
  speed = 0;
  gear = 0;
  /** Local clock (s) when the newest sample arrived, and that sample's session time. */
  private anchorLocal = 0;
  private anchorSession = 0;

  push(m: Inputs) {
    // A jump backwards means a new session/replay – start over.
    if (this.times.length && m.st < this.times.at(-1)! - 1) this.clear();
    m.samples.forEach((s, i) => {
      this.times.push(m.st + i * m.dt);
      this.samples.push(s);
    });
    const drop = this.times.length - 30 * 12;
    if (drop > 0) {
      this.times.splice(0, drop);
      this.samples.splice(0, drop);
    }
    this.steerMax = m.steerMax || this.steerMax;
    this.speed = m.speed;
    this.gear = m.gear;
    this.anchorLocal = performance.now() / 1000;
    this.anchorSession = this.times.at(-1)!;
  }

  clear() {
    this.times.length = 0;
    this.samples.length = 0;
  }

  /**
   * Session time to display now: plays samples back smoothly with a small delay so
   * batches arriving every ~100 ms don't make the trace stutter.
   */
  playhead(delay = 0.15): number | null {
    if (!this.times.length) return null;
    const elapsed = performance.now() / 1000 - this.anchorLocal;
    return this.anchorSession - delay + Math.min(elapsed, delay);
  }

  /** Linearly interpolated sample at session time t. */
  at(t: number): InputSample | null {
    const n = this.times.length;
    if (!n) return null;
    if (t <= this.times[0]!) return this.samples[0]!;
    if (t >= this.times[n - 1]!) return this.samples[n - 1]!;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid]! <= t) lo = mid; else hi = mid;
    }
    const a = this.samples[lo]!, b = this.samples[hi]!;
    const k = (t - this.times[lo]!) / (this.times[hi]! - this.times[lo]!);
    return [0, 1, 2, 3].map((i) => a[i]! + (b[i]! - a[i]!) * k) as InputSample;
  }
}

export type ConnState = 'no-config' | 'connecting' | 'connected' | 'error';

export interface FeedState {
  conn: ConnState;
  error: string | null;
  teamName: string;
  active: ActiveDriver | null;
  session: SessionInfo | null;
  status: Status | null;
  fuel: Fuel | null;
  tyres: Tyres | null;
  weather: Weather | null;
  hazard: Hazard | null;
  standings: Standings | null;
  pitplan: Pitplan | null;
  /** Local time (ms) of the last telemetry message, for the data-age indicator. */
  lastData: number;
}

const initial: FeedState = {
  conn: 'connecting', error: null, teamName: '', active: null,
  session: null, status: null, fuel: null, tyres: null, weather: null, hazard: null, standings: null, pitplan: null, lastData: 0,
};

/** Connects to the team relay and exposes the latest telemetry. */
export function useTeamFeed(): { state: FeedState; inputs: InputBuffer } {
  const [state, setState] = useState<FeedState>(initial);
  const inputs = useRef(new InputBuffer()).current;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout>;

    const applyTelemetry = (s: FeedState, m: Telemetry): FeedState => {
      const now = Date.now();
      switch (m.t) {
        case 'inputs': inputs.push(m); return s; // high rate: no React re-render
        case 'status': return { ...s, status: m, lastData: now };
        case 'fuel': return { ...s, fuel: m, lastData: now };
        case 'tyres': return { ...s, tyres: m, lastData: now };
        case 'weather': return { ...s, weather: m, lastData: now };
        case 'hazard': return { ...s, hazard: m, lastData: now };
        case 'standings': return { ...s, standings: m, lastData: now };
        case 'pitplan': return { ...s, pitplan: m, lastData: now };
        case 'session':
          // Lets the desktop app (hotkeys) know which car to jump back to.
          window.stintview?.setTeamCar?.({ carIdx: m.carIdx, carNumber: m.carNumber, sessionId: m.sessionId });
          return { ...s, session: m, lastData: now };
      }
    };

    const connect = async () => {
      const config = await loadLocalConfig().catch(() => null);
      if (!config) {
        setState((s) => ({ ...s, conn: 'no-config' }));
        return;
      }
      const url = new URL(config.serverUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/ws';
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws!.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: config.token, role: 'overlay' }));
      ws.onmessage = (ev) => {
        const m = unpack<ServerMessage>(ev.data as ArrayBuffer);
        if (m.t === 'inputs') return inputs.push(m);
        setState((s) => {
          switch (m.t) {
            case 'welcome': retry = 1000; return { ...s, conn: 'connected', error: null, teamName: m.teamName };
            case 'error': return { ...s, conn: 'error', error: m.message };
            case 'active':
              if (!m.driverName) inputs.clear();
              return { ...s, active: m };
            case 'snapshot': return m.telemetry.reduce(applyTelemetry, { ...s, active: m.active });
            case 'standby': return s; // recorder-only
            default: return applyTelemetry(s, m);
          }
        });
      };
      ws.onclose = () => {
        if (stopped) return;
        setState((s) => (s.conn === 'error' ? s : { ...s, conn: 'connecting' }));
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [inputs]);

  return { state, inputs };
}

import { useEffect, useRef, useState } from 'react';
import {
  PROTOCOL_VERSION, pack, unpack,
  type ActiveDriver, type ClientMessage, type Fuel, type InputSample, type Inputs, type ServerMessage,
  type Hazard, type MessageColor, type Snapshot, type Pitplan, type SessionInfo, type Standings, type Status, type TeamMessage, type Telemetry, type Tyres, type Weather,
} from '@stintview/protocol';

/** A team message as shown; `rx` = local time it arrived (live messages only, not from the snapshot). */
export type ReceivedMessage = TeamMessage & { rx?: number };

/** A team message to send, from the StintView window; `key` = its hotkey (null = none). */
export interface RadioMessage { id: string; text: string; color: MessageColor; key: string | null }
/** Messages to send and whether this PC's user is driving (then the Radio panel hides). */
export interface RadioState { driving: boolean; messages: RadioMessage[] }

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

export type StandingsColumn = 'pos' | 'class' | 'num' | 'flag' | 'make' | 'name' | 'team' | 'irating' | 'sr' | 'best' | 'gap' | 'tyre' | 'compound' | 'delta';
/** Position panel: which columns, and whether lapping cars are shown. */
export interface StandingsOptions {
  columns: Record<StandingsColumn, boolean>;
  /** Column order, set by drag and drop in the StintView window (since 0.19); missing = default order. */
  order?: StandingsColumn[];
  lapping: boolean;
  duel: boolean;
}
/** Duel panel: whether cars on another lap between us and the class neighbours are shown. */
export interface DuelOptions { traffic: boolean }
export type RelativeColumn = 'class' | 'pos' | 'num' | 'make' | 'flag' | 'team' | 'name' | 'irating' | 'sr' | 'gap';
export type ClassesColumn = 'pos' | 'class' | 'gap' | 'num' | 'make' | 'team' | 'flag' | 'name' | 'irating' | 'sr' | 'fastest' | 'last' | 'tyre' | 'compound';
/** Relative and class standings panels: which columns, in which order (since 0.22.1). */
export interface ColumnOptions<C extends string> {
  columns: Record<C, boolean>;
  order?: C[];
}
export type PanelOptions = StandingsOptions | DuelOptions | ColumnOptions<RelativeColumn> | ColumnOptions<ClassesColumn>;

export type ProfileId = 'driving' | 'watching';
/** One panel set-up: where (monitor or VR, one at a time), which panels, background opacity in percent. */
export interface Profile {
  output: 'monitor' | 'vr';
  /** Per panel: shown, size in percent, panel-specific options. */
  panels: Record<string, PanelSetting>;
  opacity: number;
}

export interface PanelSetting {
  shown: boolean;
  size: number;
  /** Panel-specific: Position panel StandingsOptions, Duel panel DuelOptions. */
  options?: PanelOptions;
}

/** Sent to the overlay pages: size factor and options per panel. */
export type PanelConfig = Record<string, { scale: number; options: PanelOptions | null }>;

export interface AppState {
  version: string;
  /** Started from the sources, not installed: shown as "Testinstanz" instead of the version. */
  testInstance?: boolean;
  configured: boolean;
  team: { teamName: string; memberName: string; serverUrl: string; inviteCode: string } | null;
  settings: {
    /** Panels shown at all. */
    overlay: boolean;
    /** Start the displays only while the iRacing simulator runs. */
    onlyWithIracing: boolean;
    autostart: boolean; server: boolean; serverPort: number;
    /** UI language. */
    language: 'de' | 'en';
    /** Panel set-ups while driving and while watching (since 0.23). */
    profiles: Record<ProfileId, Profile>;
    /** 'auto' = by whether this PC's driver is in the car; or one profile held. */
    profileMode: 'auto' | ProfileId;
    pitStop: { fillRate: number | null; tyreTime: number | null; regulation: 'auto' | 'standard' | 'imsa' | 'nec' | 'dtm' };
    /** Team messages to send; null = defaults in the UI language (see `radio`). */
    messages: { id: string; text: string; color: MessageColor }[] | null;
    /** VR: the key/button that recenters in iRacing (also moves the panels); null = not coupled. */
    vrRecenter: { kind: 'key' | 'button'; name: string } | null;
  };
  status: {
    line: string;
    iracing: boolean;
    server: 'offline' | 'connected' | 'standby' | 'error';
    serverText: string;
    inCar: boolean;
    relay: 'off' | 'running' | 'error';
    /** Displays switched on, but held back until iRacing runs. */
    waitingForIracing: boolean;
    /** The team streams another iRacing session than this PC's: the displays show this PC's own. */
    otherSession: boolean;
    vr: 'off' | 'waiting' | 'connected';
    overlay: boolean;
    editing: boolean;
    editHotkey: string | null;
    /** Profile shown now, and the one 'auto' would choose. */
    profile: ProfileId;
    autoProfile: ProfileId;
    profileHotkey: string | null;
  };
  autostartAvailable: boolean;
  cameraHotkeys: { incident: string | null; back: string | null };
  /** Pit lane loss import from the .ibt archive. */
  pitImport: {
    running: boolean; finished: boolean; done: number; total: number; passes: number; tracks: number;
    folder: string | null; error: string | null;
  };
  /** Lap time import from the .ibt archive (stint planner). */
  lapImport: {
    running: boolean; finished: boolean; done: number; total: number; laps: number; tracks: number;
    folder: string | null; error: string | null;
  };
  /** Lap times on this PC and how many aren't on the team server yet; null until the recorder reported. */
  lapCounts: { total: number; unsent: number } | null;
  hotkeys: HotkeyGroup[];
  radio: RadioState;
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
      /** Main monitor inside the overlay window (CSS px); the window spans all monitors. */
      onOverlayArea?(cb: (main: { x: number; y: number; width: number; height: number }) => void): void;
      /** `profile`: show that profile while moving (from the StintView window). */
      setEditMode(on?: boolean, profile?: ProfileId): Promise<AppState>;
      setInteractive(on: boolean): void;
      /** Monitor overlay panel windows (since 0.24): content size in CSS px; 0 = nothing to show. */
      reportSize?(w: number, h: number): void;
      sendLegacyPositions?(saved: Record<string, string | null>): void;
      onPanels?(cb: (ids: string[]) => void): void;
      onOpacity?(cb: (value: number) => void): void;
      onPanelConfig?(cb: (cfg: PanelConfig) => void): void;
      /** Profile shown on the monitor overlay; panel positions are kept per profile (since 0.23). */
      onProfile?(cb: (profile: ProfileId) => void): void;
      /** Panel size in percent from the corner handle on the monitor overlay (edit mode). */
      setPanelSize?(id: string, size: number): Promise<void>;
      onLanguage?(cb: (lang: 'de' | 'en') => void): void;
      /**
       * Display data from the app (since 0.25 one team connection there): only the telemetry types
       * listed (null = all); resolves with everything so far – the team's (null = no team) and this PC's.
       */
      subscribeFeed?(types: readonly Telemetry['t'][] | null): Promise<{
        team: { state: FeedConnMessage; snapshot: Snapshot } | null; local: ClientMessage[]; prefer: boolean;
      }>;
      /** The team relay's messages (welcome/error come as connection state). */
      onFeed?(cb: (m: ServerMessage | FeedConnMessage) => void): void;
      /** This PC's own recorder (no team server needed): live messages. */
      onLocal?(cb: (m: ClientMessage) => void): void;
      /** true while the team streams another iRacing session: show this PC's own data. */
      onLocalPrefer?(cb: (on: boolean) => void): void;
      /** Team messages through this PC's recorder connection (desktop app, since 0.20). */
      onTeamMessage?(cb: (m: TeamMessage) => void): void;
      setHazard?(carIdx: number | null): void;
      camera(action: 'incident' | 'back', targetCarIdx?: number): Promise<void>;
      getCameraInfo(): Promise<{ state: unknown; hotkeys: { incident: string | null; back: string | null } }>;
      onCamera(cb: (m: { t: 'camera-state' | 'camera-result' } & Record<string, unknown>) => void): void;
      getState(): Promise<AppState>;
      onState(cb: (state: AppState) => void): void;
      join(data: { serverUrl: string; inviteCode: string; memberName: string }): Promise<AppState>;
      create(data: { serverUrl: string; teamName: string; memberName: string; hostHere: boolean }): Promise<AppState>;
      updateSettings(patch: Partial<AppState['settings']>): Promise<AppState>;
      /** Waits for the next key/button pressed anywhere and saves it as VR recenter key. */
      recenterLearn?(): Promise<AppState>;
      recenterCancel?(): Promise<void>;
      leave(): Promise<AppState>;
      checkUpdate(): Promise<AppState>;
      installUpdate(): Promise<void>;
      pitImport(choose: boolean): Promise<AppState>;
      lapImport?(choose: boolean): Promise<AppState>;
      openPlanner?(): Promise<{ error: string | null }>;
      sendMessage?(what: string | { text: string; color: MessageColor }): Promise<boolean>;
      getRadio?(): Promise<RadioState>;
      onRadio?(cb: (state: RadioState) => void): void;
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

/** The app's team connection state (see apps/recorder/src/team-feed.ts). */
export interface FeedConnMessage { t: 'feed-conn'; conn: ConnState; error: string | null; teamName: string }

export interface FeedState {
  /** Connection to the team server (also while showing this PC's own data). */
  conn: ConnState;
  error: string | null;
  teamName: string;
  /**
   * Showing this PC's own sessions, straight from its recorder: without a team, while the
   * team server can't be reached, or while the team is in another session (desktop app only).
   */
  local: boolean;
  /** Showing our own data because the team streams another iRacing session. */
  otherSession: boolean;
  /**
   * Showing our own data while we drive: the team's active driver, if it is someone else
   * (two team members driving independently in the same session).
   */
  teamDriver?: string | null;
  active: ActiveDriver | null;
  session: SessionInfo | null;
  status: Status | null;
  fuel: Fuel | null;
  tyres: Tyres | null;
  weather: Weather | null;
  hazard: Hazard | null;
  /** Local time (ms) the hazard message arrived; an active one is repeated every 2 s. */
  hazardAt: number;
  standings: Standings | null;
  pitplan: Pitplan | null;
  /** Recent team messages, oldest first. */
  messages: ReceivedMessage[];
  /** Local time (ms) of the last telemetry message, for the data-age indicator. */
  lastData: number;
}

/**
 * Practice, qualifying, warmup, testing – everything but a race, from iRacing's session type
 * (as the recorder's standings mode when the session is not known yet).
 */
export function isPracticeOrQuali(s: Pick<FeedState, 'session' | 'standings'>): boolean {
  const type = s.session?.sessionType;
  return type ? !/race/i.test(type) : s.standings?.mode === 'best';
}

const initial: FeedState = {
  conn: 'connecting', error: null, teamName: '', local: false, otherSession: false, active: null,
  session: null, status: null, fuel: null, tyres: null, weather: null, hazard: null, hazardAt: 0, standings: null, pitplan: null, messages: [], lastData: 0,
};

/** Latest telemetry into the state (inputs go to the InputBuffer instead). */
function applyTelemetry(s: FeedState, m: Telemetry): FeedState {
  const now = Date.now();
  switch (m.t) {
    case 'inputs': return s;
    case 'status': return { ...s, status: m, lastData: now };
    case 'fuel': return { ...s, fuel: m, lastData: now };
    case 'tyres': return { ...s, tyres: m, lastData: now };
    case 'weather': return { ...s, weather: m, lastData: now };
    case 'hazard': return { ...s, hazard: m, hazardAt: now, lastData: now };
    case 'standings': return { ...s, standings: m, lastData: now };
    case 'pitplan': return { ...s, pitplan: m, lastData: now };
    case 'session': return { ...s, session: m, lastData: now };
    default: return s; // newer telemetry this version doesn't know
  }
}

/** This PC's own recorder: what it would send the team, and its driving state as the active driver. */
function applyLocal(s: FeedState, m: ClientMessage): FeedState {
  switch (m.t) {
    case 'driving':
      return { ...s, active: { t: 'active', driverName: m.driving ? m.driverName || null : null, memberName: null, since: Date.now() } };
    case 'session': {
      // Another session (the server does the same for the team): laps, standings etc. start over.
      const fresh = s.session && (s.session.sessionId !== m.sessionId || s.session.sessionType !== m.sessionType);
      const base = fresh ? { ...s, status: null, fuel: null, tyres: null, weather: null, hazard: null, standings: null, pitplan: null } : s;
      return applyTelemetry(base, m);
    }
    case 'hello': case 'send-message': return s;
    default: return applyTelemetry(s, m);
  }
}

/**
 * Connects to the team relay and exposes the latest telemetry. In the desktop app this PC's own
 * recorder data comes along too; it is shown while this PC drives (always our own car, also when a
 * teammate streams to the team from the same session), while the team server isn't connected or
 * the team streams another iRacing session than this PC.
 */
/** This PC's standings count while nobody in the team drives – as long as they keep coming (iRacing open). */
const OWN_STANDINGS_FRESH_MS = 10_000;

/** Messages already received (id + server time: ids start over when the server restarts). */
const seenMessages = new Set<string>();

/**
 * A new team message replaces what is shown (the panel shows the newest for 10 s from now).
 * The same message arriving a second time – the page's own, possibly lagging connection after
 * the recorder's – is ignored, so it can't reappear minutes later.
 */
function addMessage(s: FeedState, m: TeamMessage): FeedState {
  const key = `${m.id}|${m.at}`;
  if (seenMessages.has(key)) return s;
  seenMessages.add(key);
  return { ...s, messages: [...s.messages.filter((x) => x.id !== m.id), { ...m, rx: Date.now() }].slice(-10) };
}

/** A team relay message (or the app's connection state) into the state; inputs go elsewhere. */
function applyTeam(s: FeedState, m: ServerMessage | FeedConnMessage): FeedState {
  switch (m.t) {
    case 'feed-conn': return { ...s, conn: m.conn, error: m.error, teamName: m.teamName };
    case 'welcome': return { ...s, conn: 'connected', error: null, teamName: m.teamName };
    case 'error': return { ...s, conn: 'error', error: m.message };
    case 'active': return { ...s, active: m };
    case 'snapshot': {
      // Reconnected: keep the arrival time of a message already shown (else it would vanish early).
      const messages = (m.messages ?? s.messages).map((x) => s.messages.find((y) => y.id === x.id && y.at === x.at) ?? x);
      return m.telemetry.reduce(applyTelemetry, { ...s, active: m.active, messages });
    }
    case 'message': return addMessage(s, m);
    case 'standby': return s; // recorder-only
    default: return applyTelemetry(s, m);
  }
}

/**
 * `types`: the telemetry types the page shows (null = all). In the desktop app the data comes
 * through the app, which sends only those; in a browser the page connects to the relay itself.
 */
export function useTeamFeed(types: readonly Telemetry['t'][] | null = null): { state: FeedState; inputs: InputBuffer } {
  const [team, setTeam] = useState<FeedState>(initial);
  const [own, setOwn] = useState<FeedState>(initial);
  const [otherSession, setOtherSession] = useState(false);
  const inputs = useRef(new InputBuffer()).current;
  // Our recorder's last "driving" message: this PC's user is in the car.
  const ownDriver = own.active?.driverName ?? null;
  const local = Boolean(window.stintview?.onLocal) && (team.conn !== 'connected' || otherSession || ownDriver !== null);
  // Read by the message handlers: input samples only from the source on display.
  const showLocal = useRef(local);
  showLocal.current = local;

  useEffect(() => {
    inputs.clear(); // switched between team and own data
  }, [local, inputs]);

  /** A team message: input samples only from the source on display. */
  const onTeam = useRef((m: ServerMessage | FeedConnMessage) => {
    if (m.t === 'inputs') return showLocal.current ? undefined : inputs.push(m);
    if (m.t === 'active' && !m.driverName) inputs.clear();
    setTeam((s) => applyTeam(s, m));
  }).current;

  useEffect(() => {
    const api = window.stintview;
    if (!api?.onLocal || !api.subscribeFeed || !api.onFeed) return;
    api.onLocal((m) => {
      if (m.t === 'inputs') {
        if (showLocal.current) inputs.push(m);
        return;
      }
      if (m.t === 'driving' && !m.driving && showLocal.current) inputs.clear();
      setOwn((s) => applyLocal(s, m));
    });
    api.onLocalPrefer?.(setOtherSession);
    api.onTeamMessage?.((m) => setTeam((s) => addMessage(s, m)));
    api.onFeed(onTeam);
    api.subscribeFeed(types).then(({ team, local, prefer }) => {
      setTeam((s) => (team ? applyTeam(applyTeam(s, team.state), team.snapshot) : { ...s, conn: 'no-config' }));
      setOwn((s) => local.reduce(applyLocal, s));
      setOtherSession(prefer);
    }).catch(() => {});
  }, [inputs]); // once per page

  // Browser (OpenKneeboard, development): the page's own connection to the relay.
  useEffect(() => {
    if (window.stintview?.subscribeFeed) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout>;

    const connect = async () => {
      const config = await loadLocalConfig().catch(() => null);
      if (!config) {
        setTeam((s) => ({ ...s, conn: 'no-config' }));
        return;
      }
      const url = new URL(config.serverUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/ws';
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws!.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: config.token, role: 'overlay', features: ['messages'] }));
      ws.onmessage = (ev) => {
        const m = unpack<ServerMessage>(ev.data as ArrayBuffer);
        if (m.t === 'welcome') retry = 1000;
        onTeam(m);
      };
      ws.onclose = () => {
        if (stopped) return;
        setTeam((s) => (s.conn === 'error' ? s : { ...s, conn: 'connecting' }));
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
  }, [onTeam]);

  // Own data with the team connection's state (for the header) and the team messages.
  // Nobody in the team drives (e.g. after qualifying): the standings from this PC's own iRacing,
  // which its recorder keeps working out while watching (since 0.24.1); the team has none then.
  const state = local
    ? {
      ...own, conn: team.conn, error: team.error, teamName: team.teamName, messages: team.messages, local: true, otherSession,
      teamDriver: team.active?.driverName && team.active.driverName !== ownDriver ? team.active.driverName : null,
    }
    // Same for the incident warning, which this PC's recorder also checks while watching.
    : !team.active?.driverName && own.standings && Date.now() - own.lastData < OWN_STANDINGS_FRESH_MS
      ? { ...team, standings: own.standings, hazard: own.hazard, hazardAt: own.hazardAt }
    : team;
  return { state, inputs };
}

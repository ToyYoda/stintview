import { decode, encode } from '@msgpack/msgpack';

export const PROTOCOL_VERSION = 3;

export type Role = 'recorder' | 'overlay';
export type Wheel = 'LF' | 'RF' | 'LR' | 'RR';
export const WHEELS: readonly Wheel[] = ['LF', 'RF', 'LR', 'RR'];

/** Inner / middle / outer triple as reported by iRacing (L/M/R). */
export type Triple = [number, number, number];

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export interface Hello {
  t: 'hello';
  v: number;
  token: string;
  role: Role;
}

/**
 * Recorder tells the server whether its user is currently in the car.
 * Repeated every few seconds while driving so the server can hand over after a
 * driver change even if the first claim arrived too early.
 */
export interface DrivingState {
  t: 'driving';
  driving: boolean;
  driverName: string;
  /** iRacing session identity (SessionID/SubSessionID); claims from other sessions are refused. */
  session: string;
}

// ---------------------------------------------------------------------------
// Recorder -> server -> overlays (telemetry)
// ---------------------------------------------------------------------------

/** One input sample: steering (rad), throttle 0..1, brake 0..1, clutch 0..1 (1 = engaged). */
export type InputSample = [steer: number, throttle: number, brake: number, clutch: number];

/** Batched pedal/steering samples, sent ~10x/s with ~3 samples each (30 Hz). */
export interface Inputs {
  t: 'inputs';
  /** Session time of the first sample, seconds. */
  st: number;
  /** Sample interval, seconds. */
  dt: number;
  samples: InputSample[];
  steerMax: number;
  speed: number;
  gear: number;
}

/** Slowly changing car state, ~2 Hz. */
export interface Status {
  t: 'status';
  sessionTime: number;
  lap: number;
  lapDistPct: number;
  fuelLevel: number;
  onPitRoad: boolean;
  /** Metres travelled on the current tyre set, per wheel. */
  odometer: Record<Wheel, number>;
  /** iRacing SessionFlags as seen by the driver (irsdk_Flags bits, e.g. local yellow). */
  flags: number;
}

/** irsdk_Flags bits that mean "incident ahead" for the driver. */
export const YELLOW_FLAGS = 0x0008 /* yellow */ | 0x0100 /* yellowWaving */ | 0x4000 /* caution */ | 0x8000; /* cautionWaving */

export interface FuelLap {
  lap: number;
  used: number;
  lapTime: number;
  /** Lap contained pit road / refuelling – excluded from averages. */
  pit: boolean;
}

/** Sent after every completed lap. */
export interface Fuel {
  t: 'fuel';
  laps: FuelLap[];
  tankCapacity: number;
}

/** Tyre measurement taken by iRacing when the car stops in the pit stall. */
export interface TyreMeasurement {
  lap: number;
  sessionTime: number;
  /** Odometer of the measured set at the time of measurement, metres. */
  odometer: Record<Wheel, number>;
  carcass: Record<Wheel, Triple>;
  /** Tread remaining 0..1. */
  wear: Record<Wheel, Triple>;
}

export interface Tyres {
  t: 'tyres';
  /** Oldest first. The last entry is the most recent measurement. */
  measurements: TyreMeasurement[];
}

export interface SessionInfo {
  t: 'session';
  track: string;
  car: string;
  driverName: string;
  teamName: string;
  sessionType: string;
  /** Team car in this session – spectators use it to point their camera at it. */
  carIdx: number;
  /** CarNumberRaw of the team car (iRacing camera commands take the car number). */
  carNumber: number;
  /** `${SessionID}/${SubSessionID}`: spectators must watch the same event. */
  sessionId: string;
}

export type WeatherKind = 'skies' | 'precip' | 'wetness' | 'declaredWet' | 'airTemp' | 'trackTemp';

/** A real change of the weather (not the 15-minute grid iRacing shows). */
export interface WeatherEvent {
  sessionTime: number;
  /** In-sim time of day, seconds since midnight. */
  timeOfDay: number;
  kind: WeatherKind;
  /** skies 0–3, precip level 0–3, wetness 0–7 (irsdk_TrackWetness), declaredWet 0/1, temperatures in °C */
  from: number;
  to: number;
}

export interface WeatherNow {
  sessionTime: number;
  timeOfDay: number;
  airTemp: number;
  trackTemp: number;
  /** 0 clear, 1 partly cloudy, 2 mostly cloudy, 3 overcast */
  skies: number;
  /** 0..1 */
  precipitation: number;
  /** irsdk_TrackWetness: 0 unknown, 1 dry … 7 extremely wet */
  wetness: number;
  /** Stewards allow rain tyres. */
  declaredWet: boolean;
  /** −1 falling, 0 steady, 1 rising over ~10 min */
  airTrend: number;
  trackTrend: number;
}

/**
 * Current weather and the changes seen so far, every few seconds.
 * Added without a protocol version bump: older clients ignore it.
 */
export interface Weather {
  t: 'weather';
  now: WeatherNow;
  /** Oldest first. */
  events: WeatherEvent[];
}

/**
 * "Incident ahead" as seen from the driver's car – like the iRacing spotter's call, which the
 * SDK doesn't expose: a car ahead that is stopped/very slow or crawling off track.
 * Sent on change and every 2 s while active. Added without a protocol version bump.
 */
export interface Hazard {
  t: 'hazard';
  active: boolean;
  sessionTime: number;
  carIdx: number;
  carNumber: number;
  driverName: string;
  /** Metres ahead of the team car. */
  distance: number;
  reason: 'offtrack' | 'slow';
  /** m/s, null if unknown */
  speed: number | null;
}

export interface StandingRow {
  /** Running order on track (within the team car's class). */
  pos: number;
  carIdx: number;
  /** Car number as shown in iRacing, e.g. "07". */
  number: string;
  name: string;
  /** Last lap time in seconds, null if none yet. */
  lastLap: number | null;
  isTeam: boolean;
  /** Gap on track to the team car in seconds, positive = ahead of us; null if unknown. Optional: older recorders. */
  gap?: number | null;
  /** Whole laps ahead (+) of or behind (−) the team car. */
  lapsGap?: number;
  /** Tyre age in laps. Team car: exact (tyre odometer). Others: laps since their last pit stop. null = unknown. */
  tyreLaps?: number | null;
  /** Car is on pit road right now. */
  inPit?: boolean;
  /** Driver's country (iRacing flair) as lower-case ISO code for the flag, e.g. "de", "gb-eng". */
  country?: string | null;
  /** Only in `lapping`: we are about to lap them (backmarker) or they are about to lap us (lapper). */
  lap?: 'backmarker' | 'lapper';
  /** Only in `lapping`: other car class than ours. */
  otherClass?: boolean;
}

/** P1–P3 and the cars around the team car, about once per second. Additive, no version bump. */
export interface Standings {
  t: 'standings';
  sessionTime: number;
  rows: StandingRow[];
  /**
   * The car right in front of / behind us on track (all classes) if it is a lap down on us
   * (backmarker, shown above our row) or a lap up (lapper, shown below).
   */
  lapping?: StandingRow[];
}

/** A car around us after the stop (all classes: traffic matters regardless of class). */
export interface RejoinCar {
  carIdx: number;
  number: string;
  name: string;
  country?: string | null;
  sameClass: boolean;
  /** Seconds on track after our stop, + = ahead of us, within one lap. */
  gap: number;
  /** On pit road right now (will probably not be where predicted). */
  inPit: boolean;
}

/** "If we pit now": stop duration from the pit settings in the car, and where we rejoin. */
export interface Pitplan {
  t: 'pitplan';
  sessionTime: number;
  /** Litres that go in, and how long that takes. */
  fuel: number;
  fuelTime: number;
  /** Tyres to change and their time. */
  tyres: number;
  tyreTime: number;
  /** Mandatory repair seconds; optional repair is only done if the driver waits. */
  repair: number;
  optRepair: number;
  /** Fuel and tyres at the same time (IMSA, NEC, DTM) or fuel first, then tyres (standard). */
  simultaneous: boolean;
  /** iRacing sporting regulation: "Standard", "IMSA", "NEC", "DTM". */
  regulation: string;
  /** class = from the class name ("NECGT3 2026"), series = SeriesID table, manual = chosen in the app, default = unknown. */
  regulationFrom: 'class' | 'series' | 'manual' | 'default';
  fillRate: number;
  stationary: number;
  /** Time lost driving through the pit lane (measured on stopping cars), null until measured at this track. */
  laneLoss: number | null;
  laneSamples: number;
  /** measured = live at this track on this PC, archive = team's .ibt archive table. */
  laneFrom: 'measured' | 'archive' | null;
  /** laneLoss + stationary. */
  total: number | null;
  /** Where the fuel rate comes from: iRacing's rule table, measured at own stops, estimate, manual. */
  source: 'rules' | 'measured' | 'default' | 'manual';
  /** Own stops measured for this series/car. */
  stops: number;
  inPit: boolean;
  rejoin: { classPos: number | null; ahead: RejoinCar[]; behind: RejoinCar[] } | null;
}

export type Telemetry = Inputs | Status | Fuel | Tyres | SessionInfo | Weather | Hazard | Standings | Pitplan;
export type TelemetryType = Telemetry['t'];

// ---------------------------------------------------------------------------
// Server -> clients
// ---------------------------------------------------------------------------

export interface Welcome {
  t: 'welcome';
  teamId: string;
  teamName: string;
  memberName: string;
}

export interface ErrorMsg {
  t: 'error';
  code: 'auth' | 'protocol' | 'version';
  message: string;
}

/** To a recorder whose driving claim was refused (another driver is streaming or another session is running). */
export interface Standby {
  t: 'standby';
  reason: 'other-driver' | 'other-session';
}

export interface ActiveDriver {
  t: 'active';
  driverName: string | null;
  memberName: string | null;
  since: number;
}

/** Latest known telemetry of the team, sent to overlays when they connect. */
export interface Snapshot {
  t: 'snapshot';
  active: ActiveDriver;
  telemetry: Telemetry[];
}

export type ClientMessage = Hello | DrivingState | Telemetry;
export type ServerMessage = Welcome | ErrorMsg | Standby | ActiveDriver | Snapshot | Telemetry;

const TELEMETRY_TYPES = new Set<string>(['inputs', 'status', 'fuel', 'tyres', 'session', 'weather', 'hazard', 'standings', 'pitplan']);

export function isTelemetry(msg: { t: string }): msg is Telemetry {
  return TELEMETRY_TYPES.has(msg.t);
}

export function pack(msg: ClientMessage | ServerMessage): Uint8Array {
  return encode(msg);
}

export function unpack<T extends { t: string }>(data: ArrayBuffer | Uint8Array): T {
  const msg = decode(data instanceof Uint8Array ? data : new Uint8Array(data));
  if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') {
    throw new Error('invalid message');
  }
  return msg as T;
}

// ---------------------------------------------------------------------------
// HTTP API (team management)
// ---------------------------------------------------------------------------

export interface CreateTeamRequest { teamName: string; memberName: string }
export interface JoinTeamRequest { inviteCode: string; memberName: string }
export interface TeamCredentials {
  teamId: string;
  teamName: string;
  memberName: string;
  inviteCode: string;
  token: string;
}

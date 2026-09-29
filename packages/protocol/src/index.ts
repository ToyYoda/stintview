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

export type Telemetry = Inputs | Status | Fuel | Tyres | SessionInfo;
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

const TELEMETRY_TYPES = new Set<string>(['inputs', 'status', 'fuel', 'tyres', 'session']);

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

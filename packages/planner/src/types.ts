/**
 * Stint planner (SPEC A22): lap times collected by the recorders, races with availabilities
 * and the stint plan. Shared by recorder (laps), team server (storage, API) and the planner page.
 */

export type LapSession = 'race' | 'practice' | 'qualify';

/** One completed lap of a team member, recorded live or read from an old .ibt file. */
export interface LapRecord {
  /** Random, given once by the recorder; the server ignores ids it already has. */
  id: string;
  /** iRacing TrackID (layout) and its name with configuration, e.g. "Suzuka – Grand Prix". */
  track: number;
  trackName: string;
  /** iRacing CarID and the car's name. */
  car: number;
  carName: string;
  /** Lap time in seconds. */
  time: number;
  /** Fuel used on the lap in litres (0 = unknown). */
  fuel: number;
  /** Litres the car may carry in that session (tank × series limit), 0 = unknown. */
  tank: number;
  /** Wall clock at the end of the lap, ms since 1970. */
  at: number;
  session: LapSession;
  /** Track wet (irsdk_TrackWetness ≥ 3): not used for planning dry races. */
  wet: boolean;
  src: 'live' | 'ibt';
}

/** Typical values of one driver on a track/car combination. */
export interface DriverStats {
  /** Laps that count (dry, not qualifying, newest 100). */
  laps: number;
  best: number | null;
  /** Race pace: median of the laps within 3 % of the best one. */
  pace: number | null;
  /** Median fuel per lap of those laps. */
  fuel: number | null;
  /** Largest usable tank seen there. */
  tank: number | null;
}

/** [from, to] in ms since 1970. */
export type Interval = [number, number];

/** What a participant entered for a race (and what the race admin set for them). */
export interface Participant {
  avail: Interval[];
  /** Stints in a row at most. */
  maxStints: number;
  /** false = only spotting. */
  drives: boolean;
  /** Manual lap time in s instead of the measured pace (race admin). */
  lapTime: number | null;
  /** Manual fuel per lap in litres (race admin). */
  fuel: number | null;
}

export interface PlanStint {
  driver: string | null;
  spotter: string | null;
  laps: number;
}

export interface Race {
  id: string;
  name: string;
  /** iRacing TrackID / CarID of the lap data to use; null = entered by name, no data yet. */
  track: number | null;
  trackName: string;
  car: number | null;
  carName: string;
  /** Start, ms since 1970. */
  start: number;
  /** Length in seconds. */
  duration: number;
  /** Time a pit stop with driver change costs, seconds. */
  pitTime: number;
  /** Usable litres per stint; null = from the lap data. */
  tank: number | null;
  createdBy: string;
  /** Invited team members (names). */
  invited: string[];
  participants: Record<string, Participant>;
  plan: PlanStint[] | null;
  updatedAt: number;
}

/** Track/car combination the team has lap data for. */
export interface Combo {
  track: number;
  trackName: string;
  car: number;
  carName: string;
  drivers: number;
  laps: number;
}

export const DEFAULT_PARTICIPANT: Participant = { avail: [], maxStints: 2, drives: true, lapTime: null, fuel: null };

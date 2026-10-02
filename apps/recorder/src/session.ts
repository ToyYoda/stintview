import { parse } from 'yaml';

export interface SessionMeta {
  track: string;
  car: string;
  driverName: string;
  teamName: string;
  userId: number;
  carIdx: number;
  tankCapacity: number;
  /** Litres the car may carry: tank × DriverCarMaxFuelPct (series fuel limit). */
  usableTank: number;
  sessionTypes: string[];
  /** Identifies the iRacing event: `${SessionID}/${SubSessionID}`. */
  sessionId: string;
  /** CarNumberRaw of the player's car (camera commands use car numbers). */
  carNumber: number;
  /**
   * The local user is the current driver of their car. In team races iRacing reports
   * IsOnTrack for teammates following the team car too – they are not driving.
   */
  isCurrentDriver: boolean;
}

interface Yaml {
  WeekendInfo?: { TrackDisplayName?: string; SessionID?: number; SubSessionID?: number };
  SessionInfo?: { Sessions?: { SessionType?: string }[] };
  DriverInfo?: {
    DriverCarIdx?: number;
    DriverUserID?: number;
    DriverCarFuelMaxLtr?: number;
    DriverCarMaxFuelPct?: number;
    Drivers?: { CarIdx?: number; UserID?: number; UserName?: string; TeamName?: string; CarScreenName?: string; CarNumberRaw?: number }[];
  };
}

/** Extracts what the recorder needs from iRacing's session info YAML. */
export function parseSession(text: string): SessionMeta {
  let y: Yaml = {};
  try {
    // iRacing YAML is occasionally not strictly valid (e.g. unquoted special characters in names).
    y = parse(text, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {};
  } catch {
    y = {};
  }
  const di = y.DriverInfo ?? {};
  const carIdx = di.DriverCarIdx ?? -1;
  const me = di.Drivers?.find((d) => d.UserID === di.DriverUserID);
  const car = di.Drivers?.find((d) => d.CarIdx === carIdx);
  return {
    track: y.WeekendInfo?.TrackDisplayName ?? '',
    car: car?.CarScreenName ?? '',
    driverName: me?.UserName ?? car?.UserName ?? '',
    teamName: car?.TeamName ?? '',
    userId: di.DriverUserID ?? 0,
    carIdx,
    tankCapacity: di.DriverCarFuelMaxLtr ?? 0,
    usableTank: (di.DriverCarFuelMaxLtr ?? 0) * (di.DriverCarMaxFuelPct ?? 1),
    sessionTypes: (y.SessionInfo?.Sessions ?? []).map((s) => s.SessionType ?? ''),
    sessionId: `${y.WeekendInfo?.SessionID ?? 0}/${y.WeekendInfo?.SubSessionID ?? 0}`,
    carNumber: car?.CarNumberRaw ?? -1,
    // The car's entry names its current driver; unknown → don't block (single-driver sessions).
    isCurrentDriver: car?.UserID === undefined || di.DriverUserID === undefined || car.UserID === di.DriverUserID,
  };
}

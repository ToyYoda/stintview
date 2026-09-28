import { parse } from 'yaml';

export interface SessionMeta {
  track: string;
  car: string;
  driverName: string;
  teamName: string;
  userId: number;
  carIdx: number;
  tankCapacity: number;
  sessionTypes: string[];
  /** Identifies the iRacing event: `${SessionID}/${SubSessionID}`. */
  sessionId: string;
}

interface Yaml {
  WeekendInfo?: { TrackDisplayName?: string; SessionID?: number; SubSessionID?: number };
  SessionInfo?: { Sessions?: { SessionType?: string }[] };
  DriverInfo?: {
    DriverCarIdx?: number;
    DriverUserID?: number;
    DriverCarFuelMaxLtr?: number;
    Drivers?: { CarIdx?: number; UserID?: number; UserName?: string; TeamName?: string; CarScreenName?: string }[];
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
    sessionTypes: (y.SessionInfo?.Sessions ?? []).map((s) => s.SessionType ?? ''),
    sessionId: `${y.WeekendInfo?.SessionID ?? 0}/${y.WeekendInfo?.SubSessionID ?? 0}`,
  };
}

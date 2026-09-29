import { parse } from 'yaml';
import type { Frame } from './irsdk/layout.ts';
import { CamFocus, switchCamera } from './irsdk/broadcast.ts';

/** irsdk_TrkLoc */
const TrkLoc = { NotInWorld: -1, OffTrack: 0, InPitStall: 1, ApproachingPits: 2, OnTrack: 3 } as const;

/** How far ahead of the team car an incident is looked for. Yellows cover the next sector(s). */
export const MAX_AHEAD_M = 3000;
/** Slower than this on track counts as "involved" (stopped, spun, crawling back). */
export const SLOW_MPS = 30 / 3.6;
const PREFERRED_GROUP = /^far chase$/i;

export interface CarSnapshot {
  pct: number;
  surface: number;
  onPitRoad: boolean;
}

export interface IncidentCandidate {
  carIdx: number;
  distanceAhead: number;
  reason: 'offtrack' | 'slow';
  speed: number | null;
}

/**
 * Finds the car closest ahead of the team car that looks involved in an incident:
 * off track, or on track but (almost) stopped. `prev` is the snapshot ~1 s earlier.
 */
export function findIncidentCar(
  now: CarSnapshot[], prev: CarSnapshot[] | null, dt: number,
  teamIdx: number, trackLength: number, maxAhead = MAX_AHEAD_M,
): IncidentCandidate | null {
  const team = now[teamIdx];
  if (!team || team.pct < 0 || trackLength <= 0) return null;
  let best: IncidentCandidate | null = null;
  now.forEach((c, idx) => {
    if (idx === teamIdx || c.pct < 0 || c.onPitRoad) return;
    if (c.surface === TrkLoc.NotInWorld || c.surface === TrkLoc.InPitStall || c.surface === TrkLoc.ApproachingPits) return;
    const distanceAhead = (((c.pct - team.pct) % 1) + 1) % 1 * trackLength;
    if (distanceAhead <= 0 || distanceAhead > maxAhead) return;
    const p = prev?.[idx];
    const speed = p && p.pct >= 0 && dt > 0 ? (((((c.pct - p.pct) % 1) + 1.5) % 1) - 0.5) * trackLength / dt : null;
    const reason = c.surface === TrkLoc.OffTrack ? 'offtrack' : speed !== null && Math.abs(speed) < SLOW_MPS ? 'slow' : null;
    if (!reason) return;
    if (!best || distanceAhead < best.distanceAhead) best = { carIdx: idx, distanceAhead, reason, speed };
  });
  return best;
}

export interface TeamCar { carIdx: number; carNumber: number; sessionId: string }
export type CameraCommand = { t: 'camera'; action: 'incident' | 'back'; team: TeamCar };

export interface CameraState {
  t: 'camera-state';
  available: boolean; // iRacing running, spectating (not driving)
  sessionId: string;
  camCarIdx: number;
  camCarNumber: number;
  camCarName: string;
}

export interface CameraResult { t: 'camera-result'; ok: boolean; text: string }

interface DriverRow { CarIdx?: number; CarNumberRaw?: number; UserName?: string; TeamName?: string }
interface Yaml {
  WeekendInfo?: { TrackLength?: string; SessionID?: number; SubSessionID?: number };
  DriverInfo?: { Drivers?: DriverRow[] };
  CameraInfo?: { Groups?: { GroupNum?: number; GroupName?: string }[] };
}

/**
 * Local camera control for teammates watching the team car in iRacing.
 * Runs next to the recorder on the same shared memory; never acts while driving.
 */
export class Spectator {
  private drivers = new Map<number, { number: number; name: string }>();
  private farChaseGroup = 0;
  private trackLength = 0;
  private sessionId = '';
  private snapshots: { t: number; cars: CarSnapshot[] }[] = [];
  private cam = { idx: -1, group: 0, camera: 0 };
  /** Camera before the jump, restored by "back". */
  private before: { group: number; camera: number } | null = null;
  private lastState = '';
  private inCar = false;
  private connected = false;

  constructor(private readonly report: (m: CameraState) => void) {}

  onSessionInfo(text: string) {
    let y: Yaml = {};
    try {
      y = parse(text, { strict: false, uniqueKeys: false }) ?? {};
    } catch { /* keep defaults */ }
    this.drivers.clear();
    for (const d of y.DriverInfo?.Drivers ?? []) {
      if (d.CarIdx === undefined) continue;
      this.drivers.set(d.CarIdx, { number: d.CarNumberRaw ?? -1, name: d.UserName ?? d.TeamName ?? '' });
    }
    this.farChaseGroup = y.CameraInfo?.Groups?.find((g) => PREFERRED_GROUP.test(g.GroupName ?? ''))?.GroupNum ?? 0;
    this.trackLength = parseTrackLength(y.WeekendInfo?.TrackLength);
    this.sessionId = `${y.WeekendInfo?.SessionID ?? 0}/${y.WeekendInfo?.SubSessionID ?? 0}`;
    this.snapshots = [];
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    if (!connected) this.snapshots = [];
    this.publish();
  }

  onFrame(f: Frame, inCar: boolean) {
    this.inCar = inCar;
    const t = f.num('SessionTime');
    this.cam = { idx: f.num('CamCarIdx'), group: f.num('CamGroupNumber'), camera: f.num('CamCameraNumber') };
    // ~4 snapshots per second are plenty for speed estimates.
    const last = this.snapshots.at(-1);
    if (!last || t - last.t >= 0.25 || t < last.t) {
      if (last && t < last.t) this.snapshots = [];
      this.snapshots.push({ t, cars: readCars(f) });
      if (this.snapshots.length > 12) this.snapshots.shift();
    }
    this.publish();
  }

  command(cmd: CameraCommand): CameraResult {
    if (!this.connected) return { t: 'camera-result', ok: false, text: 'iRacing läuft nicht' };
    if (this.inCar) return { t: 'camera-result', ok: false, text: 'Du fährst gerade – Kamera wird nicht umgeschaltet' };
    if (cmd.team.sessionId !== this.sessionId) {
      return { t: 'camera-result', ok: false, text: 'Du schaust in iRacing nicht dieselbe Session wie dein Team' };
    }
    if (cmd.action === 'back') {
      const group = this.before?.group ?? this.cam.group;
      const camera = this.before?.camera ?? this.cam.camera;
      this.before = null;
      switchCamera(cmd.team.carNumber, group, camera);
      return { t: 'camera-result', ok: true, text: 'Kamera zurück beim Team-Auto' };
    }

    const now = this.snapshots.at(-1);
    const prev = this.snapshots.find((s) => now && now.t - s.t >= 0.9 && now.t - s.t <= 3) ?? null;
    const hit = now ? findIncidentCar(now.cars, prev?.cars ?? null, now && prev ? now.t - prev.t : 0, cmd.team.carIdx, this.trackLength) : null;
    if (this.cam.idx === cmd.team.carIdx || !this.before) this.before = { group: this.cam.group, camera: this.cam.camera };
    if (hit) {
      const d = this.drivers.get(hit.carIdx);
      switchCamera(d?.number ?? -1, this.farChaseGroup, 0);
      const what = hit.reason === 'offtrack' ? 'neben der Strecke' : 'steht/langsam';
      return { t: 'camera-result', ok: true, text: `#${d?.number ?? '?'} ${d?.name ?? ''} – ${what}, ${Math.round(hit.distanceAhead)} m voraus` };
    }
    // Nothing found near the team car: fall back to iRacing's own incident focus.
    switchCamera(CamFocus.AtIncident, this.farChaseGroup, 0);
    return { t: 'camera-result', ok: true, text: 'Kein stehendes Auto vor deinem Fahrer gefunden – iRacing zeigt den letzten Unfall' };
  }

  private publish() {
    const d = this.drivers.get(this.cam.idx);
    const state: CameraState = {
      t: 'camera-state',
      available: this.connected && !this.inCar,
      sessionId: this.sessionId,
      camCarIdx: this.cam.idx,
      camCarNumber: d?.number ?? -1,
      camCarName: d?.name ?? '',
    };
    const key = JSON.stringify(state);
    if (key === this.lastState) return;
    this.lastState = key;
    this.report(state);
  }
}

function readCars(f: Frame): CarSnapshot[] {
  const n = Math.min(f.count('CarIdxLapDistPct'), f.count('CarIdxTrackSurface'));
  const cars: CarSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    cars.push({
      pct: f.num('CarIdxLapDistPct', i),
      surface: f.num('CarIdxTrackSurface', i),
      onPitRoad: f.has('CarIdxOnPitRoad') ? f.num('CarIdxOnPitRoad', i) === 1 : false,
    });
  }
  return cars;
}

/** "24.1544 km" -> 24154.4 m */
export function parseTrackLength(s: string | undefined): number {
  const m = /([\d.]+)\s*(km|mi)?/.exec(s ?? '');
  if (!m) return 0;
  const v = Number(m[1]);
  return m[2] === 'mi' ? v * 1609.344 : v * 1000;
}

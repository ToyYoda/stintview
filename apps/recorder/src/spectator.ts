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
/** iRacing must show the target car within this time, else the switch counts as refused. */
export const VERIFY_MS = 1500;
export const NOT_ACCEPTED =
  'iRacing hat den Kamerawechsel nicht angenommen. Läuft iRacing als Administrator? Dann blockiert Windows ' +
  'die Steuerung – iRacing normal starten oder StintView ebenfalls als Administrator starten.';

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

export interface IncidentOptions {
  /** Only look this far ahead (m). */
  maxAhead?: number;
  /** Slower than this (m/s) counts as stopped/slow. */
  slowMps?: number;
  /** If set, an off-track car only counts when also slower than this (m/s) – filters track-limit excursions. */
  offtrackMaxMps?: number | null;
}

/**
 * Finds the car closest ahead of the team car that looks involved in an incident:
 * off track, or on track but (almost) stopped. `prev` is the snapshot ~1 s earlier.
 */
export function findIncidentCar(
  now: CarSnapshot[], prev: CarSnapshot[] | null, dt: number,
  teamIdx: number, trackLength: number, opts: IncidentOptions = {},
): IncidentCandidate | null {
  const maxAhead = opts.maxAhead ?? MAX_AHEAD_M;
  const slowMps = opts.slowMps ?? SLOW_MPS;
  const offtrackMax = opts.offtrackMaxMps ?? null;
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
    const slow = speed !== null && Math.abs(speed) < slowMps;
    const offtrack = c.surface === TrkLoc.OffTrack && (offtrackMax === null || (speed !== null && Math.abs(speed) < offtrackMax));
    const reason = offtrack ? 'offtrack' : slow ? 'slow' : null;
    if (!reason) return;
    if (!best || distanceAhead < best.distanceAhead) best = { carIdx: idx, distanceAhead, reason, speed };
  });
  return best;
}

/** Rolling snapshots of all cars (~4/s) for speed estimates. */
export class CarTracker {
  private snapshots: { t: number; cars: CarSnapshot[] }[] = [];

  reset() {
    this.snapshots = [];
  }

  update(f: Frame) {
    const t = f.num('SessionTime');
    const last = this.snapshots.at(-1);
    if (last && t < last.t) this.snapshots = [];
    if (last && t >= last.t && t - last.t < 0.25) return false;
    this.snapshots.push({ t, cars: readCars(f) });
    if (this.snapshots.length > 12) this.snapshots.shift();
    return true;
  }

  /** Newest snapshot and one ~1 s older (for speeds). */
  pair() {
    const now = this.snapshots.at(-1) ?? null;
    const prev = now ? this.snapshots.find((s) => now.t - s.t >= 0.9 && now.t - s.t <= 3) ?? null : null;
    return { now, prev, dt: now && prev ? now.t - prev.t : 0 };
  }

  find(teamIdx: number, trackLength: number, opts?: IncidentOptions) {
    const { now, prev, dt } = this.pair();
    return now ? findIncidentCar(now.cars, prev?.cars ?? null, dt, teamIdx, trackLength, opts) : null;
  }
}

export interface SessionCars {
  /** number = CarNumberRaw (camera commands), label = CarNumber as displayed ("07"). */
  drivers: Map<number, { number: number; label: string; name: string; flair?: string }>;
  farChaseGroup: number;
  trackLength: number;
  sessionId: string;
}

/** Car numbers/names, camera group and track length from the session YAML. */
export function parseSessionCars(text: string): SessionCars {
  let y: Yaml = {};
  try {
    y = parse(text, { strict: false, uniqueKeys: false }) ?? {};
  } catch { /* keep defaults */ }
  const drivers = new Map<number, { number: number; label: string; name: string; flair?: string }>();
  for (const d of y.DriverInfo?.Drivers ?? []) {
    if (d.CarIdx === undefined) continue;
    const number = d.CarNumberRaw ?? -1;
    drivers.set(d.CarIdx, { number, label: String(d.CarNumber ?? number), name: d.UserName ?? d.TeamName ?? '', flair: d.FlairName });
  }
  return {
    drivers,
    farChaseGroup: y.CameraInfo?.Groups?.find((g) => PREFERRED_GROUP.test(g.GroupName ?? ''))?.GroupNum ?? 0,
    trackLength: parseTrackLength(y.WeekendInfo?.TrackLength),
    sessionId: `${y.WeekendInfo?.SessionID ?? 0}/${y.WeekendInfo?.SubSessionID ?? 0}`,
  };
}

export interface TeamCar { carIdx: number; carNumber: number; sessionId: string }
/** `targetCarIdx`: jump straight to this car (reported by the driver), else search. */
export type CameraCommand = { t: 'camera'; action: 'incident' | 'back'; team: TeamCar; targetCarIdx?: number };

export interface CameraState {
  t: 'camera-state';
  available: boolean; // iRacing running, spectating (not driving)
  sessionId: string;
  camCarIdx: number;
  camCarNumber: number;
  camCarName: string;
}

export interface CameraResult { t: 'camera-result'; ok: boolean; text: string }

interface DriverRow { CarIdx?: number; CarNumberRaw?: number; CarNumber?: string | number; UserName?: string; TeamName?: string; FlairName?: string }
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
  private session: SessionCars = { drivers: new Map(), farChaseGroup: 0, trackLength: 0, sessionId: '' };
  private cars = new CarTracker();
  private cam = { idx: -1, group: 0, camera: 0 };
  /** Camera before the jump, restored by "back". */
  private before: { group: number; camera: number } | null = null;
  private lastState = '';
  private inCar = false;
  private connected = false;

  /** A sent camera switch waiting for iRacing to show the expected car. */
  private pending: { expectIdx: number; text: string; deadline: number } | null = null;

  constructor(
    private readonly report: (m: CameraState | CameraResult) => void,
    private readonly switchTo: (carNumber: number, group: number, camera: number) => void = switchCamera,
    private readonly log: (line: string) => void = () => {},
    private readonly clock: () => number = Date.now,
  ) {}

  onSessionInfo(text: string) {
    this.session = parseSessionCars(text);
    this.cars.reset();
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    if (!connected) this.cars.reset();
    this.publish();
  }

  onFrame(f: Frame, inCar: boolean) {
    this.inCar = inCar;
    this.cam = { idx: f.num('CamCarIdx'), group: f.num('CamGroupNumber'), camera: f.num('CamCameraNumber') };
    this.cars.update(f);
    this.publish();
    this.verify();
  }

  /**
   * Handles a camera command. Refusals are reported at once; a sent switch is only reported
   * as done once iRacing's camera (CamCarIdx) actually shows the car – the broadcast message
   * itself gives no feedback, and Windows silently drops it when iRacing runs elevated.
   */
  command(cmd: CameraCommand) {
    const result = this.execute(cmd);
    if (result) this.finish(result);
  }

  private finish(result: CameraResult) {
    this.log(`[camera] ${result.ok ? 'ok' : 'failed'}: ${result.text}`);
    this.report(result);
  }

  /** Reports the pending switch once the camera is there, or as refused after VERIFY_MS. */
  private verify() {
    const p = this.pending;
    if (!p) return;
    if (this.cam.idx === p.expectIdx) {
      this.pending = null;
      this.finish({ t: 'camera-result', ok: true, text: p.text });
    } else if (this.clock() > p.deadline) {
      this.pending = null;
      this.finish({ t: 'camera-result', ok: false, text: NOT_ACCEPTED });
    }
  }

  private send(carIdx: number, carNumber: number, group: number, camera: number, text: string): null {
    this.switchTo(carNumber, group, camera);
    this.pending = { expectIdx: carIdx, text, deadline: this.clock() + VERIFY_MS };
    this.log(`[camera] switch to car ${carIdx} (#${carNumber}), group ${group}, camera ${camera}`);
    return null;
  }

  private execute(cmd: CameraCommand): CameraResult | null {
    if (!this.connected) return { t: 'camera-result', ok: false, text: 'iRacing läuft nicht' };
    if (this.inCar) return { t: 'camera-result', ok: false, text: 'Du fährst gerade – Kamera wird nicht umgeschaltet' };
    if (cmd.team.sessionId !== this.session.sessionId) {
      return { t: 'camera-result', ok: false, text: 'Du schaust in iRacing nicht dieselbe Session wie dein Team' };
    }
    if (cmd.action === 'back') {
      const group = this.before?.group ?? this.cam.group;
      const camera = this.before?.camera ?? this.cam.camera;
      this.before = null;
      return this.send(cmd.team.carIdx, cmd.team.carNumber, group, camera, 'Kamera zurück beim Team-Auto');
    }

    if (this.cam.idx === cmd.team.carIdx || !this.before) this.before = { group: this.cam.group, camera: this.cam.camera };
    // The driver's recorder already named the car ("Unfall voraus"): go straight there.
    const target = cmd.targetCarIdx !== undefined ? this.session.drivers.get(cmd.targetCarIdx) : undefined;
    if (target && target.number >= 0) {
      return this.send(cmd.targetCarIdx!, target.number, this.session.farChaseGroup, 0, `#${target.number} ${target.name}`);
    }
    const hit = this.cars.find(cmd.team.carIdx, this.session.trackLength);
    if (hit) {
      const d = this.session.drivers.get(hit.carIdx);
      const what = hit.reason === 'offtrack' ? 'neben der Strecke' : 'steht/langsam';
      return this.send(hit.carIdx, d?.number ?? -1, this.session.farChaseGroup, 0,
        `#${d?.number ?? '?'} ${d?.name ?? ''} – ${what}, ${Math.round(hit.distanceAhead)} m voraus`);
    }
    // Nothing found near the team car: fall back to iRacing's own incident focus.
    // iRacing picks the car itself here, so there is nothing to verify against.
    this.switchTo(CamFocus.AtIncident, this.session.farChaseGroup, 0);
    return { t: 'camera-result', ok: true, text: 'Kein stehendes Auto vor deinem Fahrer gefunden – iRacing zeigt den letzten Unfall' };
  }

  private publish() {
    const d = this.session.drivers.get(this.cam.idx);
    const state: CameraState = {
      t: 'camera-state',
      available: this.connected && !this.inCar,
      sessionId: this.session.sessionId,
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

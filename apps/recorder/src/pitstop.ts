import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import type { Pitplan, RejoinCar } from '@stintview/protocol';
import type { Frame } from './irsdk/layout.ts';
import { configPath } from './config.ts';
import { readProgress, trackGap, type CarInfo, type CarProgress } from './standings.ts';

// ---------------------------------------------------------------------------
// Stop duration
// ---------------------------------------------------------------------------

/** How the crew works in this car/series: fuel rate, tyre time, fuel and tyres at once or not. */
export interface StopModel {
  /** Litres per second. */
  fillRate: number;
  /** Seconds for all four tyres. */
  tyreTime: number;
  simultaneous: boolean;
}

/** Estimates until measured: NEC race 06.06.2026 (Porsche 911 GT3 R), 2.5 l/s and 4 tyres in 16 s. */
export const DEFAULT_RATES = { fillRate: 2.5, tyreTime: 16 };

/**
 * iRacing's series-specific sporting regulations (support article 31000179080): by default
 * fuel is completed before tyre service begins; IMSA, NEC and DTM do both at once (NEC with
 * slower fuel pumps, DTM with faster tyre changes – rates are measured per series anyway).
 */
export type Regulation = 'standard' | 'imsa' | 'nec' | 'dtm';
export const REGULATIONS: Record<Regulation, { label: string; simultaneous: boolean }> = {
  standard: { label: 'Standard', simultaneous: false },
  imsa: { label: 'IMSA', simultaneous: true },
  nec: { label: 'NEC', simultaneous: true },
  dtm: { label: 'DTM', simultaneous: true },
};
/** The session info names the series, not its regulation: SeriesID -> regulation, as far as known. */
export const SERIES_REGULATION: Record<number, Regulation> = {
  275: 'nec', // Nürburgring Endurance Championship (race 06.06.2026, setup "26S2-NEC-…")
};

export const PIT_FLAGS = { tyres: 0x0f, fuel: 0x10, fastRepair: 0x40 } as const;

export interface StopRequest {
  /** Litres that will actually go in. */
  fuel: number;
  tyres: number;
  /** Mandatory repair seconds (0 with fast repair). */
  repair: number;
}

/**
 * Stationary time. Repairs run after the service (seen in the 06.06. race: the optional
 * repair clock only started once fuel and tyres were done).
 */
export function stationaryTime(req: StopRequest, m: StopModel) {
  const fuelTime = req.fuel > 0 ? req.fuel / m.fillRate : 0;
  const tyreTime = req.tyres > 0 ? (m.tyreTime * req.tyres) / 4 : 0;
  const service = m.simultaneous ? Math.max(fuelTime, tyreTime) : fuelTime + tyreTime;
  return { fuelTime, tyreTime, stationary: service + req.repair };
}

/** What the next stop will do, from the pit service settings in the car. */
export function stopRequest(flags: number, svFuel: number, fuelLevel: number, usableTank: number, repair: number): StopRequest {
  const fuel = flags & PIT_FLAGS.fuel ? Math.max(0, Math.min(svFuel, usableTank - fuelLevel)) : 0;
  let tyres = 0;
  for (let b = 0; b < 4; b++) if (flags & (1 << b)) tyres++;
  return { fuel, tyres, repair: flags & PIT_FLAGS.fastRepair ? 0 : Math.max(0, repair) };
}

// ---------------------------------------------------------------------------
// Learning the crew from our own stops
// ---------------------------------------------------------------------------

export interface StopSample {
  fillRate?: number;
  tyreTime?: number;
  simultaneous?: boolean;
}

/**
 * Watches the player car's service: iRacing clears each PitSvFlags bit when that job is done,
 * so fuel end, every tyre and the order of the work can be read off.
 */
export class OwnStopLearner {
  private stop: {
    t0: number; flags: number; fuel0: number; fuelStart: number | null; fuelEnd: number | null;
    fuelMax: number; lastRise: number | null; tyreClears: number[]; lastFlags: number;
  } | null = null;

  /** Returns a sample when a stop has just ended. */
  onFrame(t: number, active: boolean, flags: number, fuel: number): StopSample | null {
    if (active && !this.stop) {
      this.stop = { t0: t, flags, fuel0: fuel, fuelStart: null, fuelEnd: null, fuelMax: fuel, lastRise: null, tyreClears: [], lastFlags: flags };
      return null;
    }
    const s = this.stop;
    if (!s) return null;
    if (active) {
      if (fuel > s.fuelMax + 0.01) {
        if (s.fuelStart === null) s.fuelStart = t;
        s.fuelMax = fuel;
        s.lastRise = t;
      }
      const cleared = s.lastFlags & ~flags;
      if (cleared & PIT_FLAGS.fuel && s.fuelStart !== null) s.fuelEnd = t;
      for (let b = 0; b < 4; b++) if (cleared & (1 << b) && s.flags & (1 << b)) s.tyreClears.push(t);
      s.lastFlags = flags;
      return null;
    }
    this.stop = null;
    return learnFromStop(s);
  }
}

function learnFromStop(s: { t0: number; fuel0: number; fuelStart: number | null; fuelEnd: number | null; fuelMax: number; lastRise: number | null; tyreClears: number[] }): StopSample {
  const out: StopSample = {};
  const added = s.fuelMax - s.fuel0;
  // The fuel bit is cleared when fuelling ends; without it, the last time the level rose.
  const fuelEnd = s.fuelEnd ?? s.lastRise;
  if (added > 5 && s.fuelStart !== null && fuelEnd !== null && fuelEnd - s.fuelStart > 1) {
    out.fillRate = added / (fuelEnd - s.fuelStart);
  }
  const tyres = s.tyreClears.length;
  if (tyres > 0) {
    const first = Math.min(...s.tyreClears), last = Math.max(...s.tyreClears);
    let start = s.t0;
    if (s.fuelStart !== null && fuelEnd !== null) {
      // Tyres done while fuelling -> at the same time. Otherwise one after the other.
      out.simultaneous = first < fuelEnd - 0.5 && s.fuelStart - s.t0 < 3;
      if (!out.simultaneous && first >= fuelEnd - 0.5) start = fuelEnd; // fuel first, then tyres
    }
    const duration = last - start;
    if (duration > 1) out.tyreTime = (duration * 4) / tyres;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time lost driving through the pit lane, measured on every car that stops
// ---------------------------------------------------------------------------

export interface LaneSample { carIdx: number; loss: number }

/**
 * For each car on pit road: time between the cones minus standing still minus the time the
 * same stretch takes on track (iRacing's per-car time estimate). What is left is the pit
 * lane loss – the same for every stop at this track.
 */
export class LaneLossLearner {
  private cars = new Map<number, { t0: number; est0: number; stationary: number; lastT: number; lastPct: number }>();

  /** `lapEst(carIdx)`: that car's class lap time estimate (to bridge the start/finish line). */
  onFrame(t: number, cars: CarProgress[], lapEst: (carIdx: number) => number | null): LaneSample[] {
    const done: LaneSample[] = [];
    const seen = new Set<number>();
    for (const c of cars) {
      seen.add(c.carIdx);
      const pct = c.progress - Math.floor(c.progress);
      const s = this.cars.get(c.carIdx);
      if (c.onPitRoad) {
        if (!s) {
          if (c.estTime != null) this.cars.set(c.carIdx, { t0: t, est0: c.estTime, stationary: 0, lastT: t, lastPct: pct });
          continue;
        }
        const dt = t - s.lastT;
        if (dt > 0 && dt < 1 && Math.abs(pct - s.lastPct) < 1e-6) s.stationary += dt;
        s.lastT = t;
        s.lastPct = pct;
      } else if (s) {
        this.cars.delete(c.carIdx);
        const lap = lapEst(c.carIdx);
        if (c.estTime == null || !lap) continue;
        let normal = c.estTime - s.est0;
        if (normal < 0) normal += lap;
        const loss = t - s.t0 - s.stationary - normal;
        // Towed cars, garage visits, session changes: implausible values are dropped.
        if (t - s.t0 < 400 && loss > 3 && loss < 90) done.push({ carIdx: c.carIdx, loss });
      }
    }
    for (const idx of this.cars.keys()) if (!seen.has(idx)) this.cars.delete(idx);
    return done;
  }
}

// ---------------------------------------------------------------------------
// Where we come back out
// ---------------------------------------------------------------------------

/** Wraps a time gap into one lap around us: (-lap/2, lap/2]. */
export function wrapGap(gap: number, lap: number) {
  let g = gap % lap;
  if (g > lap / 2) g -= lap;
  if (g <= -lap / 2) g += lap;
  return g;
}

/**
 * Cars around us on track after a stop costing `loss` seconds, if nobody else stops:
 * each car's gap grows by `loss`; traffic is about the physical gap on track (within one
 * lap), the class position about the race gap.
 */
export function computeRejoin(
  cars: CarProgress[], teamIdx: number, loss: number, lapRef: number, info: Map<number, CarInfo>, near = 2,
): { classPos: number | null; ahead: RejoinCar[]; behind: RejoinCar[] } {
  const team = cars.find((c) => c.carIdx === teamIdx);
  if (!team) return { classPos: null, ahead: [], behind: [] };
  const rows: (RejoinCar & { raceGap: number })[] = [];
  for (const c of cars) {
    if (c.carIdx === teamIdx) continue;
    const g = trackGap(c, team, lapRef);
    if (g === null) continue;
    const d = info.get(c.carIdx);
    rows.push({
      carIdx: c.carIdx, number: d?.number ?? '?', name: d?.name ?? '', country: d?.country ?? null,
      sameClass: c.classId === team.classId, gap: wrapGap(g + loss, lapRef), inPit: c.onPitRoad ?? false,
      raceGap: g + loss,
    });
  }
  const strip = ({ raceGap: _r, ...r }: RejoinCar & { raceGap: number }): RejoinCar => r;
  const classPos = 1 + rows.filter((r) => r.sameClass && r.raceGap > 0).length;
  return {
    classPos,
    ahead: rows.filter((r) => r.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, near).map(strip),
    behind: rows.filter((r) => r.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, near).map(strip),
  };
}

// ---------------------------------------------------------------------------
// Persistence: learned values per track and per series/car, on this PC
// ---------------------------------------------------------------------------

interface ModelFile {
  tracks: Record<string, number[]>;
  cars: Record<string, { fillRates: number[]; tyreTimes: number[] }>;
}

const KEEP = 12;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null;
};

export class PitModelStore {
  private data: ModelFile = { tracks: {}, cars: {} };

  constructor(private readonly file: string | null = join(dirname(configPath()), 'pit-model.json')) {
    if (!file) return;
    try {
      const d = JSON.parse(readFileSync(file, 'utf8')) as Partial<ModelFile>;
      this.data = { tracks: d.tracks ?? {}, cars: d.cars ?? {} };
    } catch { /* first run */ }
  }

  laneLoss(track: string) {
    const xs = this.data.tracks[track] ?? [];
    return { loss: median(xs), samples: xs.length };
  }

  addLaneLoss(track: string, loss: number) {
    this.data.tracks[track] = [...(this.data.tracks[track] ?? []), Math.round(loss * 10) / 10].slice(-KEEP);
    this.save();
  }

  /** Measured fuel rate and tyre time for a series/car (defaults until measured). */
  car(key: string): { fillRate: number; tyreTime: number; stops: number } {
    const c = this.data.cars[key];
    return {
      fillRate: median(c?.fillRates ?? []) ?? DEFAULT_RATES.fillRate,
      tyreTime: median(c?.tyreTimes ?? []) ?? DEFAULT_RATES.tyreTime,
      stops: Math.max(c?.fillRates.length ?? 0, c?.tyreTimes.length ?? 0),
    };
  }

  addStop(key: string, s: StopSample) {
    const c = this.data.cars[key] ?? { fillRates: [], tyreTimes: [] };
    if (s.fillRate) c.fillRates = [...c.fillRates, Math.round(s.fillRate * 100) / 100].slice(-KEEP);
    if (s.tyreTime) c.tyreTimes = [...c.tyreTimes, Math.round(s.tyreTime * 10) / 10].slice(-KEEP);
    this.data.cars[key] = c;
    this.save();
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch { /* not fatal */ }
  }
}

// ---------------------------------------------------------------------------
// Session info and the planner that ties it together
// ---------------------------------------------------------------------------

export interface PitSession {
  track: string;
  seriesId: number;
  /** Series and car: crews work differently per series (fuel rate, fuel and tyres at once). */
  carKey: string;
  usableTank: number;
  /** Class lap time estimate per carIdx. */
  lapEst: Map<number, number>;
}

interface Yaml {
  WeekendInfo?: { TrackID?: number; SeriesID?: number };
  DriverInfo?: {
    DriverCarIdx?: number; DriverCarFuelMaxLtr?: number; DriverCarMaxFuelPct?: number;
    Drivers?: { CarIdx?: number; CarPath?: string; CarClassEstLapTime?: number }[];
  };
}

export function parsePitSession(text: string): PitSession {
  let y: Yaml = {};
  try {
    y = parse(text, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {};
  } catch { /* defaults */ }
  const di = y.DriverInfo ?? {};
  const me = di.Drivers?.find((d) => d.CarIdx === di.DriverCarIdx);
  const lapEst = new Map<number, number>();
  for (const d of di.Drivers ?? []) if (d.CarIdx !== undefined && d.CarClassEstLapTime) lapEst.set(d.CarIdx, Number(d.CarClassEstLapTime));
  return {
    track: String(y.WeekendInfo?.TrackID ?? ''),
    seriesId: y.WeekendInfo?.SeriesID ?? 0,
    carKey: `${y.WeekendInfo?.SeriesID ?? 0}/${me?.CarPath ?? ''}`,
    usableTank: (di.DriverCarFuelMaxLtr ?? 0) * (di.DriverCarMaxFuelPct ?? 1),
    lapEst,
  };
}

/** Manual values from the StintView window; null = use what was measured. */
export interface PitOverride {
  fillRate: number | null;
  tyreTime: number | null;
  /** 'auto' = from the SeriesID table, standard rules if the series is unknown. */
  regulation: 'auto' | Regulation;
}

const SEND_EVERY_S = 1;

export class PitPlanner {
  private session: PitSession | null = null;
  private info = new Map<number, CarInfo>();
  private own = new OwnStopLearner();
  private lane = new LaneLossLearner();
  private lastSent = -Infinity;
  private override: PitOverride = { fillRate: null, tyreTime: null, regulation: 'auto' };

  constructor(private readonly store = new PitModelStore(), private readonly log: (s: string) => void = () => {}) {}

  setSession(yaml: string, info: Map<number, CarInfo>) {
    const s = parsePitSession(yaml);
    if (s.seriesId !== this.session?.seriesId) {
      const known = SERIES_REGULATION[s.seriesId];
      this.log(`[pit] SeriesID ${s.seriesId}: ${known ? `${REGULATIONS[known].label} rules` : 'not in the table, standard rules (fuel, then tyres)'}`);
    }
    this.session = s;
    this.info = info;
  }

  setOverride(o: PitOverride) {
    this.override = o;
  }

  /** Regulation: chosen in the app, else from the SeriesID table, else standard. */
  regulation(): { regulation: Regulation; from: Pitplan['regulationFrom'] } {
    if (this.override.regulation !== 'auto') return { regulation: this.override.regulation, from: 'manual' };
    const known = SERIES_REGULATION[this.session?.seriesId ?? 0];
    return known ? { regulation: known, from: 'series' } : { regulation: 'standard', from: 'default' };
  }

  /** Current model: manual rates win, then measured ones, then the estimates. */
  model(): { model: StopModel; source: Pitplan['source']; stops: number } {
    const measured = this.store.car(this.session?.carKey ?? '');
    const o = this.override;
    return {
      model: {
        fillRate: o.fillRate ?? measured.fillRate,
        tyreTime: o.tyreTime ?? measured.tyreTime,
        simultaneous: REGULATIONS[this.regulation().regulation].simultaneous,
      },
      source: o.fillRate !== null || o.tyreTime !== null ? 'manual' : measured.stops > 0 ? 'measured' : 'default',
      stops: measured.stops,
    };
  }

  onFrame(f: Frame, driving: boolean): Pitplan | null {
    const s = this.session;
    if (!s) return null;
    const t = f.num('SessionTime');
    const cars = readProgress(f);

    for (const sample of this.lane.onFrame(t, cars, (idx) => s.lapEst.get(idx) ?? null)) {
      this.store.addLaneLoss(s.track, sample.loss);
      this.log(`[pit] lane loss ${sample.loss.toFixed(1)} s measured on car ${sample.carIdx}`);
    }
    if (f.has('PitstopActive')) {
      const stop = this.own.onFrame(t, f.num('PitstopActive') === 1, f.num('PitSvFlags') >>> 0, f.num('FuelLevel'));
      if (stop && (stop.fillRate || stop.tyreTime)) {
        this.store.addStop(s.carKey, stop);
        this.log(`[pit] own stop: ${JSON.stringify(stop)}`);
      }
    }

    if (!driving) return null;
    if (t - this.lastSent < SEND_EVERY_S && t >= this.lastSent) return null;
    this.lastSent = t;

    const teamIdx = f.num('PlayerCarIdx');
    const req = stopRequest(f.num('PitSvFlags') >>> 0, f.num('PitSvFuel'), f.num('FuelLevel'), s.usableTank, f.num('PitRepairLeft'));
    const { model, source, stops } = this.model();
    const reg = this.regulation();
    const { fuelTime, tyreTime, stationary } = stationaryTime(req, model);
    const lane = this.store.laneLoss(s.track);
    const total = lane.loss !== null ? lane.loss + stationary : null;
    const team = cars.find((c) => c.carIdx === teamIdx);
    const lapRef = team?.lastLap ?? s.lapEst.get(teamIdx) ?? null;
    const rejoin = total !== null && lapRef ? computeRejoin(cars, teamIdx, total, lapRef, this.info) : null;
    const opt = f.num('PitOptRepairLeft');
    return {
      t: 'pitplan', sessionTime: t,
      fuel: round1(req.fuel), fuelTime: round1(fuelTime), tyres: req.tyres, tyreTime: round1(tyreTime),
      repair: round1(req.repair), optRepair: round1(Number.isFinite(opt) ? opt : 0),
      simultaneous: model.simultaneous, regulation: REGULATIONS[reg.regulation].label, regulationFrom: reg.from,
      fillRate: Math.round(model.fillRate * 100) / 100,
      stationary: round1(stationary), laneLoss: lane.loss !== null ? round1(lane.loss) : null, laneSamples: lane.samples,
      total: total !== null ? round1(total) : null, source, stops,
      inPit: f.num('OnPitRoad') === 1,
      rejoin: rejoin && { ...rejoin, ahead: rejoin.ahead.map(roundGap), behind: rejoin.behind.map(roundGap) },
    };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const roundGap = (c: RejoinCar): RejoinCar => ({ ...c, gap: round1(c.gap) });

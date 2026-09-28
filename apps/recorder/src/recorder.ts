import {
  WHEELS, type ClientMessage, type Fuel, type SessionInfo, type Triple, type Tyres, type Wheel,
} from '@stintview/protocol';
import { FuelTracker, InputBatcher, TyreTracker } from '@stintview/telemetry';
import type { Frame } from './irsdk/layout.ts';
import { parseSession, type SessionMeta } from './session.ts';

const STATUS_INTERVAL = 0.5; // seconds of session time
/** Re-send the driving claim this often so the server can hand over after a driver change. */
const CLAIM_INTERVAL = 2;
/** IsOnTrack must stay false this long before we report leaving the car (blips on resets). */
const LEAVE_DEBOUNCE = 3;

/**
 * Turns raw telemetry frames into protocol messages.
 * Only emits telemetry while the local user is in the car.
 */
export class Recorder {
  private meta: SessionMeta | null = null;
  private driving = false;
  private offTrackSince: number | null = null;
  private lastStatus = -Infinity;
  private lastClaim = -Infinity;
  private lastSessionNum = -1;
  private fuel = new FuelTracker();
  private tyres = new TyreTracker();
  private inputs = new InputBatcher();

  constructor(private readonly emit: (msg: ClientMessage) => void) {}

  get isDriving() {
    return this.driving;
  }

  onSessionInfo(yaml: string) {
    const prev = this.meta;
    this.meta = parseSession(yaml);
    if (prev && (prev.track !== this.meta.track || prev.car !== this.meta.car)) this.resetTrackers();
    if (this.driving) this.emit(this.sessionMsg());
  }

  onFrame(f: Frame) {
    const t = f.num('SessionTime');
    const sessionNum = f.num('SessionNum');
    if (sessionNum !== this.lastSessionNum) {
      if (this.lastSessionNum !== -1) this.resetTrackers();
      this.lastSessionNum = sessionNum;
      if (this.driving) this.emit(this.sessionMsg());
    }

    this.updateDriving(f, t);
    if (!this.driving) return;
    if (t - this.lastClaim >= CLAIM_INTERVAL || t < this.lastClaim) {
      this.lastClaim = t;
      this.emit(this.drivingMsg());
    }

    const batch = this.inputs.feed(t, [
      f.num('SteeringWheelAngle'), f.num('Throttle'), f.num('Brake'), f.num('Clutch'),
    ]);
    if (batch) {
      this.emit({
        t: 'inputs', ...batch,
        steerMax: f.num('SteeringWheelAngleMax'), speed: f.num('Speed'), gear: f.num('Gear'),
      });
    }

    const fuelSample = {
      sessionTime: t, lap: f.num('Lap'), lapDistPct: f.num('LapDistPct'),
      fuelLevel: f.num('FuelLevel'), onPitRoad: f.bool('OnPitRoad'),
    };
    if (this.fuel.feed(fuelSample)) this.emit(this.fuelMsg());

    const odometer = perWheel((w) => f.num(`${w}odometer`));
    const measurement = this.tyres.feed({
      sessionTime: t, lap: fuelSample.lap, odometer,
      carcass: perWheel((w) => triple(f, `${w}tempC`)),
      wear: perWheel((w) => triple(f, `${w}wear`)),
    });
    if (measurement) this.emit(this.tyresMsg());

    if (t - this.lastStatus >= STATUS_INTERVAL || t < this.lastStatus) {
      this.lastStatus = t;
      this.emit({ t: 'status', ...fuelSample, odometer });
    }
  }

  /** Full state for (re)connects and driver changes. */
  stateMessages(): ClientMessage[] {
    const msgs: ClientMessage[] = [this.drivingMsg()];
    if (this.driving) {
      msgs.push(this.sessionMsg());
      if (this.fuel.laps.length) msgs.push(this.fuelMsg());
      if (this.tyres.measurements.length) msgs.push(this.tyresMsg());
    }
    return msgs;
  }

  private updateDriving(f: Frame, t: number) {
    const inCar = f.bool('IsOnTrack');
    if (inCar) {
      this.offTrackSince = null;
      if (!this.driving) {
        this.driving = true;
        this.inputs.reset();
        for (const m of this.stateMessages()) this.emit(m);
      }
    } else if (this.driving) {
      this.offTrackSince ??= t;
      if (t - this.offTrackSince >= LEAVE_DEBOUNCE || t < this.offTrackSince) {
        this.driving = false;
        this.emit(this.drivingMsg());
      }
    }
  }

  private drivingMsg(): ClientMessage {
    return {
      t: 'driving', driving: this.driving,
      driverName: this.meta?.driverName ?? '', session: this.meta?.sessionId ?? '',
    };
  }

  private resetTrackers() {
    this.fuel = new FuelTracker();
    this.tyres = new TyreTracker();
    this.inputs.reset();
  }

  private sessionMsg(): SessionInfo {
    const m = this.meta;
    const idx = Math.max(0, this.lastSessionNum);
    return {
      t: 'session',
      track: m?.track ?? '', car: m?.car ?? '', driverName: m?.driverName ?? '', teamName: m?.teamName ?? '',
      sessionType: m?.sessionTypes[idx] ?? '',
    };
  }

  private fuelMsg(): Fuel {
    return { t: 'fuel', laps: this.fuel.laps.slice(-10), tankCapacity: this.meta?.tankCapacity ?? 0 };
  }

  private tyresMsg(): Tyres {
    return { t: 'tyres', measurements: [...this.tyres.measurements] };
  }
}

function perWheel<T>(fn: (w: Wheel) => T): Record<Wheel, T> {
  return Object.fromEntries(WHEELS.map((w) => [w, fn(w)])) as Record<Wheel, T>;
}

function triple(f: Frame, prefix: string): Triple {
  return [f.num(`${prefix}L`), f.num(`${prefix}M`), f.num(`${prefix}R`)];
}

import type { Hazard } from '@stintview/protocol';
import type { Frame } from './irsdk/layout.ts';
import { CarTracker, parseSessionCars, type IncidentCandidate, type IncidentOptions, type SessionCars } from './spectator.ts';

/**
 * Stricter than the camera search: this raises "Unfall voraus" for the whole team, so
 * ordinary track-limit excursions must not trigger it.
 */
export const HAZARD_OPTIONS: Required<IncidentOptions> = {
  maxAhead: 700, // ~10 s at racing speed; 1500 m warned far too early (race 08.10.2026)
  slowMps: 30 / 3.6, // stopped or crawling
  offtrackMaxMps: 50 / 3.6, // off track *and* slow; at 80 km/h wide runs in slow corners counted
};
/** Must be seen in this many consecutive checks (~4/s) before it is reported. */
export const CONFIRM_CHECKS = 2;
/** Stays active this long after the last sighting (s), so flicker doesn't toggle it. */
export const CLEAR_AFTER_S = 5;
const RESEND_S = 2;

/**
 * Runs on the driver's PC while they are in the car: watches all cars ahead and reports
 * "incident ahead". Our own replacement for the iRacing spotter call (not in the SDK).
 */
export class HazardDetector {
  private cars = new CarTracker();
  private session: SessionCars = { drivers: new Map(), tires: [], farChaseGroup: 0, trackLength: 0, sessionId: '' };
  private streak: { carIdx: number; count: number } | null = null;
  private current: (IncidentCandidate & { lastSeen: number }) | null = null;
  private lastSent = -Infinity;
  private lastSentTime = 0;

  constructor(private readonly log: (line: string) => void = () => {}) {}

  /**
   * iRacing re-sends the session info all the time in a race (results, drivers), so only a new
   * session or track starts over. Returns the "clear" to send if a warning was active – before,
   * every update dropped the warning silently and the displays kept it for minutes.
   */
  onSessionInfo(text: string): Hazard | null {
    const next = parseSessionCars(text);
    const changed = next.sessionId !== this.session.sessionId || next.trackLength !== this.session.trackLength;
    this.session = next;
    if (!changed) return null;
    const wasActive = this.current !== null;
    this.reset();
    if (!wasActive) return null;
    this.log('[hazard] clear (new session)');
    return this.message(this.lastSentTime, false);
  }

  reset() {
    this.cars.reset();
    this.streak = null;
    this.current = null;
    this.lastSent = -Infinity;
  }

  /** Returns a message to send, or null. `driving` = the local user is in the car. */
  onFrame(f: Frame, driving: boolean): Hazard | null {
    if (!driving) {
      const wasActive = this.current !== null;
      this.reset();
      return wasActive ? this.message(f.num('SessionTime'), false) : null;
    }
    if (!this.cars.update(f)) return this.resend(f.num('SessionTime'));
    const t = f.num('SessionTime');
    const teamIdx = f.num('PlayerCarIdx');
    // In the pit lane there's nothing to warn about.
    const hit = f.bool('OnPitRoad') ? null : this.cars.find(teamIdx, this.session.trackLength, HAZARD_OPTIONS);

    if (hit) {
      this.streak = this.streak?.carIdx === hit.carIdx ? { carIdx: hit.carIdx, count: this.streak.count + 1 } : { carIdx: hit.carIdx, count: 1 };
      if (this.streak.count >= CONFIRM_CHECKS) {
        const isNew = this.current?.carIdx !== hit.carIdx;
        this.current = { ...hit, lastSeen: t };
        if (isNew) {
          const d = this.session.drivers.get(hit.carIdx);
          this.log(`[hazard] #${d?.number ?? '?'} ${d?.name ?? ''}: ${hit.reason}, ${Math.round(hit.distanceAhead)} m ahead, ${hit.speed === null ? '?' : Math.round(hit.speed * 3.6)} km/h`);
          return this.message(t, true);
        }
      }
    } else {
      this.streak = null;
    }

    if (this.current && t - this.current.lastSeen > CLEAR_AFTER_S) {
      this.log('[hazard] clear');
      this.current = null;
      return this.message(t, false);
    }
    return this.resend(t);
  }

  private resend(t: number): Hazard | null {
    if (!this.current || t - this.lastSent < RESEND_S) return null;
    return this.message(t, true);
  }

  private message(t: number, active: boolean): Hazard {
    this.lastSent = t;
    this.lastSentTime = t;
    const c = this.current;
    const d = c ? this.session.drivers.get(c.carIdx) : undefined;
    return {
      t: 'hazard',
      active: active && c !== null,
      sessionTime: t,
      carIdx: c?.carIdx ?? -1,
      carNumber: d?.number ?? -1,
      driverName: d?.name ?? '',
      distance: c ? Math.round(c.distanceAhead) : 0,
      reason: c?.reason ?? 'slow',
      speed: c?.speed ?? null,
    };
  }
}

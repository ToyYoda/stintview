import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LapRecord, Race } from '@stintview/planner';
import type { Identity } from './store.ts';

/** Newest laps kept per member and track/car combination. */
const KEEP_PER_COMBO = 300;
const SAVE_DELAY_MS = 2000;

interface Data {
  /** teamId → member name → laps */
  laps: Record<string, Record<string, LapRecord[]>>;
  /** teamId → races */
  races: Record<string, Race[]>;
  /** sha256(planner key) → who; keys are handed to the planner page after a login code. */
  sessions: Record<string, Identity & { created: number }>;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Stint planner data of all teams (lap times, races, page logins), one JSON file next to teams.json. */
export class PlannerStore {
  private data: Data = { laps: {}, races: {}, sessions: {} };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null) {
    if (!file) return;
    try {
      this.data = { ...this.data, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  // --- laps -----------------------------------------------------------------

  /** Adds laps not seen before (by id); returns how many were new. */
  addLaps(teamId: string, member: string, laps: LapRecord[]): number {
    const team = (this.data.laps[teamId] ??= {});
    const mine = (team[member] ??= []);
    const known = new Set(mine.map((l) => l.id));
    const fresh = laps.filter((l) => !known.has(l.id) && (known.add(l.id), true));
    if (!fresh.length) return 0;
    mine.push(...fresh);
    // Keep the newest per combination.
    const byCombo = new Map<string, LapRecord[]>();
    for (const l of mine) {
      const k = `${l.track}/${l.car}`;
      byCombo.set(k, [...(byCombo.get(k) ?? []), l]);
    }
    team[member] = [...byCombo.values()].flatMap((ls) => ls.sort((a, b) => b.at - a.at).slice(0, KEEP_PER_COMBO));
    this.save();
    return fresh.length;
  }

  lapsOf(teamId: string): Record<string, LapRecord[]> {
    return this.data.laps[teamId] ?? {};
  }

  // --- races ----------------------------------------------------------------

  races(teamId: string): Race[] {
    return this.data.races[teamId] ?? [];
  }

  race(teamId: string, id: string): Race | null {
    return this.races(teamId).find((r) => r.id === id) ?? null;
  }

  addRace(teamId: string, race: Omit<Race, 'id' | 'updatedAt'>): Race {
    const r: Race = { ...race, id: randomUUID().slice(0, 8), updatedAt: Date.now() };
    (this.data.races[teamId] ??= []).push(r);
    this.flush();
    return r;
  }

  /** Applies `change` to the race and saves; null if it doesn't exist. */
  updateRace(teamId: string, id: string, change: (r: Race) => void): Race | null {
    const r = this.race(teamId, id);
    if (!r) return null;
    change(r);
    r.updatedAt = Date.now();
    this.flush();
    return r;
  }

  deleteRace(teamId: string, id: string): boolean {
    const list = this.races(teamId);
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    this.flush();
    return true;
  }

  // --- planner page logins ----------------------------------------------------

  /** New key for the planner page of `who`. */
  createSession(who: Identity): string {
    const key = randomBytes(24).toString('base64url');
    this.data.sessions[hash(key)] = { ...who, created: Date.now() };
    this.flush();
    return key;
  }

  session(key: string): Identity | null {
    const s = this.data.sessions[hash(key)];
    return s ? { teamId: s.teamId, teamName: s.teamName, memberName: s.memberName } : null;
  }

  /** Writes soon (lap uploads come in bursts); races and logins are written at once (`flush`). */
  private save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}

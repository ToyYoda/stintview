/**
 * Stint planner (SPEC A22) on the team server: lap upload from the recorders, races,
 * availabilities and plans for the planner page, and the page itself under /planner/.
 *
 * Logins: the desktop app asks for a one-time code with its team token (POST /api/planner/login)
 * and opens /planner/#code=…; the page swaps it for its own key (POST /api/planner/session).
 * The team token itself never appears in a URL.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import {
  DEFAULT_PARTICIPANT, combos, lapStats, mergeIntervals,
  type DriverStats, type Interval, type LapRecord, type Participant, type PlanStint, type Race,
} from '@stintview/planner';
import type { PlannerStore } from './planner-store.ts';
import type { Identity, TeamStore } from './store.ts';

export interface PlannerDeps {
  teams: TeamStore;
  planner: PlannerStore;
  /** Built UI (apps/overlay/dist) with planner.html and assets/, null = no page. */
  staticDir: string | null;
  log(msg: string): void;
}

const CODE_TTL_MS = 2 * 60_000;
const MAX_HOURS = 48;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readJson<T>(req: IncomingMessage, limit: number): Promise<T> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new HttpError(413, 'body too large');
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

// --- input checks ------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

function cleanLap(v: unknown): LapRecord | null {
  const l = v as Partial<LapRecord> | null;
  if (!l || typeof l !== 'object') return null;
  const id = str(l.id, 40), track = intOrNull(l.track), car = intOrNull(l.car);
  const time = num(l.time, 10, 1800), at = num(l.at, 1e12, 1e13);
  if (!id || track === null || car === null || time === null || at === null) return null;
  return {
    id, track, car, time, at,
    trackName: str(l.trackName, 120), carName: str(l.carName, 120),
    fuel: num(l.fuel, 0, 100) ?? 0, tank: num(l.tank, 0, 1000) ?? 0,
    session: l.session === 'race' || l.session === 'qualify' ? l.session : 'practice',
    wet: l.wet === true, src: l.src === 'ibt' ? 'ibt' : 'live',
  };
}

type RaceSettings = Omit<Race, 'id' | 'updatedAt' | 'createdBy' | 'participants' | 'plan'>;

function cleanSettings(v: unknown, members: string[]): RaceSettings {
  const b = (v ?? {}) as Partial<Race>;
  const name = str(b.name, 80);
  const start = num(b.start, 1e12, 1e13);
  const duration = num(b.duration, 10 * 60, MAX_HOURS * 3600);
  if (!name) throw new HttpError(400, 'name required');
  if (start === null) throw new HttpError(400, 'start required');
  if (duration === null) throw new HttpError(400, 'duration 10 min … 48 h');
  return {
    name, start, duration: Math.round(duration),
    track: intOrNull(b.track), trackName: str(b.trackName, 120),
    car: intOrNull(b.car), carName: str(b.carName, 120),
    pitTime: num(b.pitTime, 0, 900) ?? 60,
    tank: num(b.tank, 1, 1000),
    invited: [...new Set(Array.isArray(b.invited) ? b.invited.filter((n): n is string => typeof n === 'string' && members.includes(n)) : [])],
  };
}

function cleanParticipant(v: unknown, prev: Participant, race: Race, admin: boolean): Participant {
  const b = (v ?? {}) as Partial<Participant>;
  const end = race.start + race.duration * 1000;
  // Only the race window counts; anything outside is cut off.
  const avail: Interval[] = Array.isArray(b.avail)
    ? mergeIntervals(b.avail.slice(0, 500).filter((i): i is Interval => Array.isArray(i) && i.length === 2)
      .map(([a, z]) => [Math.max(race.start, Number(a)), Math.min(end, Number(z))] as Interval))
    : prev.avail;
  return {
    avail,
    maxStints: num(b.maxStints, 1, 20) !== null ? Math.round(b.maxStints!) : prev.maxStints,
    drives: typeof b.drives === 'boolean' ? b.drives : prev.drives,
    // Manual figures are the race admin's.
    lapTime: admin && 'lapTime' in b ? num(b.lapTime, 10, 1800) : prev.lapTime,
    fuel: admin && 'fuel' in b ? num(b.fuel, 0.01, 100) : prev.fuel,
  };
}

function cleanPlan(v: unknown, invited: string[]): PlanStint[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length > 500) throw new HttpError(400, 'plan must be a list');
  const who = (n: unknown) => (typeof n === 'string' && invited.includes(n) ? n : null);
  return v.map((s: Partial<PlanStint>) => ({
    driver: who(s?.driver), spotter: who(s?.spotter), laps: Math.round(num(s?.laps, 1, 1000) ?? 1),
  }));
}

// --- handler -------------------------------------------------------------------

export function plannerHandler({ teams, planner, staticDir, log }: PlannerDeps) {
  const codes = new Map<string, { who: Identity; expires: number }>();

  const auth = (req: IncomingMessage): Identity => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const who = m ? planner.session(m[1]!) ?? teams.authenticate(m[1]!) : null;
    if (!who) throw new HttpError(401, 'unauthorized');
    return who;
  };

  const team = (who: Identity) => {
    const info = teams.teamInfo(who.teamId);
    if (!info) throw new HttpError(401, 'unknown team');
    return info;
  };

  const canEdit = (race: Race, who: Identity) => race.createdBy === who.memberName || team(who).admin === who.memberName;

  const stats = (race: Race, who: Identity): Record<string, DriverStats> => {
    if (race.track === null || race.car === null) return {};
    const laps = planner.lapsOf(who.teamId);
    return Object.fromEntries(race.invited.map((n) => [n, lapStats(laps[n] ?? [], race.track!, race.car!)]));
  };

  const detail = (race: Race, who: Identity) => ({ race, stats: stats(race, who), canEdit: canEdit(race, who) });

  const findRace = (who: Identity, id: string) => {
    const race = planner.race(who.teamId, id);
    if (!race) throw new HttpError(404, 'unknown race');
    return race;
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method ?? 'GET';

    if (method === 'POST' && path === '/api/laps') {
      const who = auth(req);
      const body = await readJson<{ laps?: unknown[] }>(req, 4_000_000);
      const laps = (Array.isArray(body.laps) ? body.laps.slice(0, 5000) : []).map(cleanLap).filter((l): l is LapRecord => l !== null);
      const added = planner.addLaps(who.teamId, who.memberName, laps);
      if (added) log(`laps from ${who.memberName}: ${added} new`);
      return reply(res, 200, { added, received: laps.length });
    }

    if (method === 'POST' && path === '/api/planner/login') {
      const who = auth(req);
      const now = Date.now();
      for (const [c, v] of codes) if (v.expires < now) codes.delete(c);
      const code = randomBytes(18).toString('base64url');
      codes.set(code, { who, expires: now + CODE_TTL_MS });
      return reply(res, 200, { code });
    }

    if (method === 'POST' && path === '/api/planner/session') {
      const { code } = await readJson<{ code?: string }>(req, 1000);
      const entry = typeof code === 'string' ? codes.get(code) : undefined;
      if (!entry || entry.expires < Date.now()) throw new HttpError(401, 'code expired');
      codes.delete(code!);
      log(`planner opened by ${entry.who.memberName}`);
      return reply(res, 200, { key: planner.createSession(entry.who) });
    }

    const who = auth(req);
    const info = team(who);

    if (method === 'GET' && path === '/api/planner') {
      return reply(res, 200, {
        me: who.memberName, teamName: info.name, admin: info.admin, members: info.members,
        combos: combos(planner.lapsOf(who.teamId)),
        races: planner.races(who.teamId)
          .map(({ participants, plan, ...r }) => ({ ...r, answered: Object.keys(participants), planned: Boolean(plan?.length) }))
          .sort((a, b) => a.start - b.start),
      });
    }

    if (method === 'POST' && path === '/api/planner/races') {
      const s = cleanSettings(await readJson(req, 20_000), info.members);
      const race = planner.addRace(who.teamId, { ...s, createdBy: who.memberName, participants: {}, plan: null });
      log(`race "${race.name}" created by ${who.memberName}`);
      return reply(res, 201, detail(race, who));
    }

    const m = /^\/api\/planner\/races\/([\w-]+)(?:\/(participants)\/([^/]+)|\/(plan))?$/.exec(path);
    if (!m) throw new HttpError(404, 'not found');
    const race = findRace(who, m[1]!);

    if (m[2]) {
      if (method !== 'PUT') throw new HttpError(405, 'method');
      const name = decodeURIComponent(m[3]!);
      if (!race.invited.includes(name)) throw new HttpError(404, 'not invited');
      const admin = canEdit(race, who);
      if (name !== who.memberName && !admin) throw new HttpError(403, 'only your own entry');
      const body = await readJson(req, 100_000);
      planner.updateRace(who.teamId, race.id, (r) => {
        r.participants[name] = cleanParticipant(body, { ...DEFAULT_PARTICIPANT, ...r.participants[name] }, r, admin);
      });
      return reply(res, 200, detail(race, who));
    }

    if (m[4]) {
      if (method !== 'PUT') throw new HttpError(405, 'method');
      if (!canEdit(race, who)) throw new HttpError(403, 'only the race admin');
      const { plan } = await readJson<{ plan?: unknown }>(req, 200_000);
      const clean = cleanPlan(plan ?? null, race.invited);
      planner.updateRace(who.teamId, race.id, (r) => { r.plan = clean; });
      return reply(res, 200, detail(race, who));
    }

    if (method === 'GET') return reply(res, 200, detail(race, who));
    if (!canEdit(race, who)) throw new HttpError(403, 'only the race admin');
    if (method === 'PUT') {
      const s = cleanSettings(await readJson(req, 20_000), info.members);
      planner.updateRace(who.teamId, race.id, (r) => {
        Object.assign(r, s);
        // Uninvited members drop out of the plan; the entries of the others stay.
        for (const n of Object.keys(r.participants)) if (!s.invited.includes(n)) delete r.participants[n];
        r.plan = r.plan?.map((st) => ({
          ...st, driver: st.driver && s.invited.includes(st.driver) ? st.driver : null,
          spotter: st.spotter && s.invited.includes(st.spotter) ? st.spotter : null,
        })) ?? null;
      });
      return reply(res, 200, detail(race, who));
    }
    if (method === 'DELETE') {
      planner.deleteRace(who.teamId, race.id);
      log(`race "${race.name}" deleted by ${who.memberName}`);
      return reply(res, 200, { ok: true });
    }
    throw new HttpError(405, 'method');
  }

  const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  };

  /** The page (planner.html) and the shared asset files of the built UI. */
  async function page(res: ServerResponse, path: string) {
    if (path === '/planner') return res.writeHead(302, { location: '/planner/' }).end();
    const asset = /^\/planner\/assets\/([\w.-]+)$/.exec(path)?.[1];
    const file = path === '/planner/' || path === '/planner/index.html' ? 'planner.html' : asset ? join('assets', asset) : null;
    if (!file || !staticDir) return reply(res, 404, { error: 'not found' });
    try {
      const body = await readFile(join(staticDir, file));
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        // Asset names carry a content hash; the page itself must always be fresh after an update.
        'cache-control': asset ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      }).end(body);
    } catch {
      reply(res, 404, { error: 'not found' });
    }
  }

  /** Handles planner URLs; false = not ours. */
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/planner' || path.startsWith('/planner/')) {
      if (req.method !== 'GET') reply(res, 405, { error: 'method' });
      else await page(res, path);
      return true;
    }
    if (path !== '/api/laps' && !path.startsWith('/api/planner')) return false;
    try {
      await api(req, res, path);
    } catch (e) {
      if (e instanceof HttpError) reply(res, e.status, { error: e.message });
      else {
        log(`planner error: ${(e as Error).stack ?? e}`);
        reply(res, 500, { error: 'server error' });
      }
    }
    return true;
  };
}

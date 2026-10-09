import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlannerStore } from './planner-store.ts';
import { plannerHandler } from './planner-api.ts';
import { TeamStore } from './store.ts';

const teams = new TeamStore(null);
const planner = new PlannerStore(null);
const route = plannerHandler({ teams, planner, staticDir: null, log: () => {} });
let server: Server;
let base = '';

const chef = teams.createTeam('Outcast', 'Philipp');
const anna = teams.join(chef.inviteCode, 'Anna')!;
const ben = teams.join(chef.inviteCode, 'Ben')!;
const other = teams.createTeam('Other', 'Zoe');

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (!(await route(req, res))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const lap = (id: string, time: number) => ({
  id, track: 168, trackName: 'Suzuka – Grand Prix', car: 169, carName: 'Porsche 911 GT3 R', time, fuel: 3.1,
  tank: 100, at: Date.UTC(2026, 9, 1), session: 'race', wet: false, src: 'live',
});

describe('planner API', () => {
  it('needs a team token or planner key', async () => {
    expect((await call('GET', '/api/planner')).status).toBe(401);
    expect((await call('GET', '/api/planner', 'nonsense')).status).toBe(401);
  });

  it('stores uploaded laps once and lists the combination', async () => {
    const laps = [lap('a1', 120.5), lap('a2', 121), { ...lap('bad', 3) }];
    expect((await call('POST', '/api/laps', anna.token, { laps })).json).toEqual({ added: 2, received: 2 });
    expect((await call('POST', '/api/laps', anna.token, { laps })).json.added).toBe(0);
    const o = (await call('GET', '/api/planner', chef.token)).json;
    expect(o.members).toEqual(['Philipp', 'Anna', 'Ben']);
    expect(o.admin).toBe('Philipp');
    expect(o.combos).toEqual([expect.objectContaining({ track: 168, car: 169, drivers: 1, laps: 2 })]);
    // Other teams don't see them.
    expect((await call('GET', '/api/planner', other.token)).json.combos).toEqual([]);
  });

  it('swaps a one-time login code for a planner key', async () => {
    const { code } = (await call('POST', '/api/planner/login', ben.token)).json;
    const s = await call('POST', '/api/planner/session', undefined, { code });
    expect(s.status).toBe(200);
    expect((await call('GET', '/api/planner', s.json.key)).json.me).toBe('Ben');
    expect((await call('POST', '/api/planner/session', undefined, { code })).status).toBe(401); // used up
  });

  it('runs a race: settings by its creator, own availability by everyone, plan by the admins', async () => {
    const start = Date.UTC(2026, 9, 20, 18);
    const created = await call('POST', '/api/planner/races', ben.token, {
      name: '6h Suzuka', track: 168, trackName: 'Suzuka', car: 169, carName: 'Porsche', start, duration: 6 * 3600,
      pitTime: 70, invited: ['Philipp', 'Anna', 'Ben', 'Stranger'],
    });
    expect(created.status).toBe(201);
    const id = created.json.race.id;
    expect(created.json.race.invited).toEqual(['Philipp', 'Anna', 'Ben']);
    expect(created.json.stats.Anna).toMatchObject({ laps: 2, best: 120.5 });

    // Anna enters her own time, not Ben's, and can't set her own lap time.
    const mine = await call('PUT', `/api/planner/races/${id}/participants/Anna`, anna.token,
      { avail: [[start - 3_600_000, start + 7_200_000]], maxStints: 3, lapTime: 100 });
    expect(mine.json.race.participants.Anna).toMatchObject({ avail: [[start, start + 7_200_000]], maxStints: 3, lapTime: null });
    expect((await call('PUT', `/api/planner/races/${id}/participants/Ben`, anna.token, { maxStints: 1 })).status).toBe(403);
    expect((await call('PUT', `/api/planner/races/${id}`, anna.token, { name: 'x', start, duration: 3600 })).status).toBe(403);

    // The team creator may edit every race.
    const plan = await call('PUT', `/api/planner/races/${id}/plan`, chef.token, { plan: [{ driver: 'Anna', spotter: 'Zoe', laps: 30 }] });
    expect(plan.json.race.plan).toEqual([{ driver: 'Anna', spotter: null, laps: 30 }]);
    expect((await call('PUT', `/api/planner/races/${id}/plan`, anna.token, { plan: [] })).status).toBe(403);

    // Uninviting removes the member from entries and plan.
    const upd = await call('PUT', `/api/planner/races/${id}`, ben.token,
      { name: '6h Suzuka', start, duration: 6 * 3600, track: 168, car: 169, invited: ['Philipp', 'Ben'] });
    expect(upd.json.race.participants.Anna).toBeUndefined();
    expect(upd.json.race.plan).toEqual([{ driver: null, spotter: null, laps: 30 }]);
    expect((await call('GET', `/api/planner/races/${id}`, other.token)).status).toBe(404);
    expect((await call('DELETE', `/api/planner/races/${id}`, ben.token)).status).toBe(200);
  });

  it('has no page without a built UI', async () => {
    expect((await call('GET', '/planner/')).status).toBe(404);
  });
});

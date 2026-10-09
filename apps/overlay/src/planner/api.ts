/**
 * Planner page ↔ team server (apps/server/src/planner-api.ts). The page is served by the team
 * server itself, so all calls are same-origin. Its key comes from a one-time code the desktop
 * app puts into the URL hash (#code=…) and stays in this browser's localStorage.
 */
import type { Combo, DriverStats, Participant, PlanStint, Race } from '@stintview/planner';

const KEY = 'stintview.planner.key';

export interface Overview {
  me: string;
  teamName: string;
  admin: string | null;
  members: string[];
  combos: Combo[];
  races: (Omit<Race, 'participants' | 'plan'> & { answered: string[]; planned: boolean })[];
}

export interface RaceDetail {
  race: Race;
  stats: Record<string, DriverStats>;
  canEdit: boolean;
}

export type RaceSettings = Pick<Race, 'name' | 'track' | 'trackName' | 'car' | 'carName' | 'start' | 'duration' | 'pitTime' | 'tank' | 'invited'>;

export class AuthError extends Error {}

function storedKey(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Swaps a one-time code from the URL for a key; true if a key is available afterwards. */
export async function login(): Promise<boolean> {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('code');
  if (code) {
    params.delete('code');
    history.replaceState(null, '', `${location.pathname}${location.search}${params.size ? `#${params}` : ''}`);
    const res = await fetch('/api/planner/session', { method: 'POST', body: JSON.stringify({ code }) });
    if (res.ok) {
      const { key } = await res.json() as { key: string };
      try { localStorage.setItem(KEY, key); } catch { /* only for this visit */ }
      sessionKey = key;
      return true;
    }
  }
  sessionKey = storedKey();
  return sessionKey !== null;
}

let sessionKey: string | null = null;

export function logout() {
  sessionKey = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/planner${path}`, {
    method,
    headers: { authorization: `Bearer ${sessionKey ?? ''}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError('unauthorized');
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const api = {
  overview: () => call<Overview>('GET', ''),
  race: (id: string) => call<RaceDetail>('GET', `/races/${id}`),
  createRace: (s: RaceSettings) => call<RaceDetail>('POST', '/races', s),
  updateRace: (id: string, s: RaceSettings) => call<RaceDetail>('PUT', `/races/${id}`, s),
  deleteRace: (id: string) => call<{ ok: true }>('DELETE', `/races/${id}`),
  participant: (id: string, name: string, p: Partial<Participant>) =>
    call<RaceDetail>('PUT', `/races/${id}/participants/${encodeURIComponent(name)}`, p),
  plan: (id: string, plan: PlanStint[] | null) => call<RaceDetail>('PUT', `/races/${id}/plan`, { plan }),
};

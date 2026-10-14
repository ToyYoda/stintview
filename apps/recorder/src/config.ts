import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TeamCredentials } from '@stintview/protocol';
import { resolveServer, type ServerAccess, type Target } from './server-link.ts';

/**
 * Shared by recorder and overlay: %APPDATA%\StintView\config.json. `serverCert`: the team
 * server's certificate, remembered at the first contact (since 0.26).
 */
export interface Config extends TeamCredentials, ServerAccess {}

export const configPath = () =>
  process.env.STINTVIEW_CONFIG ??
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'StintView', 'config.json');

export function loadConfig(): Config | null {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(c: Config) {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2));
}

/**
 * Where to reach the team server for the next connection (newest config.json; `fallback` if there is
 * none). A certificate learnt on the way (first connection after the update) is stored.
 */
export function serverTarget(fallback?: Config | null): Promise<Target> {
  const c = loadConfig() ?? fallback;
  if (!c) return Promise.reject(new Error('no team'));
  return resolveServer(c, (access) => {
    const now = loadConfig();
    if (now?.token === c.token) saveConfig({ ...now, ...access });
  });
}

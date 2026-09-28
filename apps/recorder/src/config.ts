import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TeamCredentials } from '@stintview/protocol';

/** Shared by recorder and overlay: %APPDATA%\StintView\config.json */
export interface Config extends TeamCredentials {
  serverUrl: string;
}

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

/** http(s)://host -> ws(s)://host/ws */
export function wsUrl(serverUrl: string) {
  const u = new URL(serverUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  return u.toString();
}

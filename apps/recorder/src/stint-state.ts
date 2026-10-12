/**
 * Pit stop state of the current session (Stint column of other cars) in stint-state.json next
 * to config.json: after a restart of StintView mid-race the laps since each car's last stop are
 * known again (iRacing does not tell, 12.10.2026). Only one session is kept – the latest.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from './config.ts';
import type { PitState, PitStateStore } from './standings.ts';

interface StintStateFile { key: string; savedAt: number; state: PitState }

export class StintStateStore implements PitStateStore {
  constructor(private readonly file = join(dirname(configPath()), 'stint-state.json')) {}

  load(key: string): PitState | null {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StintStateFile>;
      const s = d.state;
      if (d.key !== key || !s || !Array.isArray(s.sinceLap) || !Array.isArray(s.onPit)) return null;
      return {
        sinceLap: s.sinceLap.filter((e) => Number.isInteger(e?.[0]) && Number.isFinite(e?.[1])),
        onPit: s.onPit.filter((e) => Number.isInteger(e?.[0]) && typeof e?.[1] === 'boolean'),
      };
    } catch {
      return null; // none yet or unreadable: start empty
    }
  }

  save(key: string, state: PitState) {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ key, savedAt: Date.now(), state } satisfies StintStateFile));
    } catch { /* not fatal */ }
  }
}

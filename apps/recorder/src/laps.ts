/**
 * Lap times for the stint planner (SPEC A22): every lap this PC's user drives is kept in
 * laps.json next to config.json (also without a team) and uploaded to the team server.
 * Two processes write it (live recorder, .ibt import), so it is read again before every change.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LapRecord, LapSession } from '@stintview/planner';
import { configPath, type Config } from './config.ts';

export const lapsPath = () => join(dirname(configPath()), 'laps.json');

type LocalLap = LapRecord & { sent?: boolean };
interface LapFile { laps: LocalLap[]; importedFiles: string[] }

/** Laps kept on this PC; beyond that the oldest uploaded ones go. */
const KEEP = 30_000;
const UPLOAD_BATCH = 2000;
const SYNC_INTERVAL_MS = 60_000;
/** Team server without the planner (older version): ask again after this long. */
const OLD_SERVER_PAUSE_MS = 30 * 60_000;

export const newLapId = () => randomUUID().replace(/-/g, '').slice(0, 16);

/** iRacing SessionType → planner session kind. */
export function sessionKind(type: string | undefined): LapSession {
  if (/race/i.test(type ?? '')) return 'race';
  if (/qualify/i.test(type ?? '')) return 'qualify';
  return 'practice';
}

export interface LapCounts { total: number; unsent: number }

export class LapLog {
  constructor(private readonly file = lapsPath()) {}

  read(): LapFile {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<LapFile>;
      return { laps: Array.isArray(d.laps) ? d.laps : [], importedFiles: Array.isArray(d.importedFiles) ? d.importedFiles : [] };
    } catch {
      return { laps: [], importedFiles: [] };
    }
  }

  add(laps: LapRecord[], importedFiles: string[] = []) {
    if (!laps.length && !importedFiles.length) return;
    this.change((d) => {
      d.laps.push(...laps);
      d.importedFiles.push(...importedFiles);
      if (d.laps.length > KEEP) {
        // Oldest uploaded laps first; unsent ones stay until they are on the server.
        const drop = new Set(d.laps.filter((l) => l.sent).sort((a, b) => a.at - b.at).slice(0, d.laps.length - KEEP).map((l) => l.id));
        d.laps = d.laps.filter((l) => !drop.has(l.id));
      }
    });
  }

  unsent(max = UPLOAD_BATCH): LapRecord[] {
    return this.read().laps.filter((l) => !l.sent).slice(0, max).map(({ sent: _sent, ...l }) => l);
  }

  markSent(ids: string[]) {
    const set = new Set(ids);
    this.change((d) => { for (const l of d.laps) if (set.has(l.id)) l.sent = true; });
  }

  counts(): LapCounts {
    const laps = this.read().laps;
    return { total: laps.length, unsent: laps.filter((l) => !l.sent).length };
  }

  private change(fn: (d: LapFile) => void) {
    const d = this.read();
    fn(d);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(d));
    renameSync(tmp, this.file);
  }
}

/** Uploads unsent laps to the team server: at start, after laps, and every minute. */
export class LapUploader {
  private busy = false;
  private pausedUntil = 0;
  private lastError = '';

  constructor(
    private readonly log: LapLog,
    private readonly config: () => Config | null,
    private readonly print: (line: string) => void,
    private readonly onCounts: (c: LapCounts) => void = () => {},
  ) {}

  start() {
    setInterval(() => void this.sync(), SYNC_INTERVAL_MS).unref?.();
    void this.sync();
  }

  async sync() {
    const cfg = this.config();
    if (this.busy || !cfg || Date.now() < this.pausedUntil) return this.onCounts(this.log.counts());
    this.busy = true;
    try {
      for (let laps = this.log.unsent(); laps.length; laps = this.log.unsent()) {
        const res = await fetch(new URL('/api/laps', cfg.serverUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
          body: JSON.stringify({ laps }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404) {
          this.pausedUntil = Date.now() + OLD_SERVER_PAUSE_MS;
          this.report('team server has no stint planner yet (update it) – keeping laps on this PC');
          break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { added } = await res.json() as { added: number };
        this.log.markSent(laps.map((l) => l.id));
        this.print(`[laps] uploaded ${laps.length} (${added} new on the server)`);
        this.lastError = '';
      }
    } catch (e) {
      this.report(`upload failed: ${(e as Error).message} – trying again later`);
    } finally {
      this.busy = false;
      this.onCounts(this.log.counts());
    }
  }

  /** Same problem once, not every minute. */
  private report(text: string) {
    if (text !== this.lastError) this.print(`[laps] ${text}`);
    this.lastError = text;
  }
}

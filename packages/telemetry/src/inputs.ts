import type { InputSample } from '@stintview/protocol';

export interface InputBatch {
  st: number;
  dt: number;
  samples: InputSample[];
}

/**
 * Downsamples a ~60 Hz tick stream to `rate` Hz and emits batches of `perBatch`
 * samples (default 30 Hz in batches of 3 = 10 messages/s).
 */
export class InputBatcher {
  private buf: InputSample[] = [];
  private st = 0;
  private nextAt = -Infinity;

  constructor(private readonly rate = 30, private readonly perBatch = 3) {}

  feed(sessionTime: number, sample: InputSample): InputBatch | null {
    // Session time jumped backwards (replay seek / new session): restart.
    if (sessionTime < this.nextAt - 1) this.reset();
    if (sessionTime + 1e-6 < this.nextAt) return null;
    const dt = 1 / this.rate;
    // Keep a fixed grid; after a gap, restart the grid at the current sample.
    this.nextAt = (this.nextAt > sessionTime - dt ? this.nextAt : sessionTime) + dt;
    if (this.buf.length === 0) this.st = sessionTime;
    this.buf.push(sample);
    if (this.buf.length < this.perBatch) return null;
    const batch = { st: this.st, dt, samples: this.buf };
    this.buf = [];
    return batch;
  }

  reset() {
    this.buf = [];
    this.nextAt = -Infinity;
  }
}

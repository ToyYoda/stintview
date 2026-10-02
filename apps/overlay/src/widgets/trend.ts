/**
 * Duel panel: how fast the gap to a class neighbour shrinks or grows, from the gaps that
 * arrive with every standings message (about once per second). Linear fit over the last
 * `window` seconds; starts over when the neighbour changes, someone is on pit road or the
 * session time jumps back.
 */
export class GapTrend {
  private carIdx: number | null = null;
  private samples: { t: number; gap: number }[] = [];

  constructor(private window = 90, private minSpan = 15) {}

  /** gap: seconds on track, sign ignored. `null` (unknown, pit road, other lap) starts over. */
  push(carIdx: number | null, t: number, gap: number | null) {
    const last = this.samples[this.samples.length - 1];
    if (carIdx !== this.carIdx || gap === null || (last && t < last.t)) {
      this.carIdx = carIdx;
      this.samples = [];
    }
    if (gap === null || (last && t === last.t)) return;
    this.samples.push({ t, gap: Math.abs(gap) });
    while (this.samples.length && this.samples[0]!.t < t - this.window) this.samples.shift();
  }

  /** Change of the gap in seconds per second (− = getting closer), null until enough data. */
  rate(): number | null {
    const s = this.samples;
    if (s.length < 5 || s[s.length - 1]!.t - s[0]!.t < this.minSpan) return null;
    const mt = s.reduce((a, p) => a + p.t, 0) / s.length;
    const mg = s.reduce((a, p) => a + p.gap, 0) / s.length;
    let num = 0, den = 0;
    for (const p of s) {
      num += (p.t - mt) * (p.gap - mg);
      den += (p.t - mt) ** 2;
    }
    return den > 0 ? num / den : null;
  }
}

export type Outlook =
  | { kind: 'close' } // within half a second
  | { kind: 'closing'; laps: number }
  | { kind: 'steady' }
  | { kind: 'opening' };

/**
 * What the gap is doing: `rate` from GapTrend (s per s), `lapTime` our last lap. Closing by
 * less than 0.05 s per lap, or more than 20 laps away from catching, counts as steady.
 */
export function outlook(gap: number, rate: number | null, lapTime: number | null): Outlook | null {
  if (Math.abs(gap) < 0.5) return { kind: 'close' };
  if (rate === null || !lapTime) return null;
  const perLap = rate * lapTime;
  if (perLap > 0.05) return { kind: 'opening' };
  if (perLap > -0.05) return { kind: 'steady' };
  const laps = Math.ceil(Math.abs(gap) / -perLap);
  return laps > 20 ? { kind: 'steady' } : { kind: 'closing', laps };
}

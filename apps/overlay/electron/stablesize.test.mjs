import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { stableSize } = createRequire(import.meta.url)('./stablesize.cjs');

describe('stableSize', () => {
  it('sizes in steps and leaves small changes alone', () => {
    const s = stableSize({ step: 16, shrinkMs: 5000 });
    expect(s.next(301.4, 199.2, 0)).toEqual({ w: 304, h: 208 });
    expect(s.next(303.9, 200.6, 100)).toBeNull();
    expect(s.pending(100)).toBeNull();
  });

  it('grows at once, also one side only', () => {
    const s = stableSize({ step: 16, shrinkMs: 5000 });
    s.next(300, 200, 0);
    expect(s.next(330, 150, 10)).toEqual({ w: 336, h: 208 });
  });

  it('shrinks only after the content stayed smaller for shrinkMs', () => {
    const s = stableSize({ step: 16, shrinkMs: 5000 });
    s.next(300, 200, 0);
    expect(s.next(250, 200, 1000)).toBeNull();
    expect(s.pending(1000)).toBe(5000);
    expect(s.next(250, 200, 5999)).toBeNull();
    expect(s.next(250, 200, 6000)).toEqual({ w: 256, h: 208 });
    expect(s.pending(6000)).toBeNull();
  });

  it('content back to its size in between: no shrinking', () => {
    const s = stableSize({ step: 16, shrinkMs: 5000 });
    s.next(300, 200, 0);
    s.next(250, 200, 1000);
    expect(s.next(300, 200, 2000)).toBeNull();
    expect(s.next(250, 200, 6500)).toBeNull(); // the wait starts again
    expect(s.next(250, 200, 11500)).toEqual({ w: 256, h: 208 });
  });
});

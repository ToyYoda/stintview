import { describe, expect, it } from 'vitest';
import { isBlankFrame, type Frame } from './layout.ts';

const frame = (vars: Record<string, number>) => ({
  num: (n: string) => vars[n] ?? NaN, has: (n: string) => n in vars,
}) as unknown as Frame;

describe('isBlankFrame', () => {
  it('everything at zero, as seen live about once a minute (22./23.11.2026)', () => {
    expect(isBlankFrame(frame({ SessionNum: 0, SessionTime: 0, SessionState: 0, SessionUniqueID: 0 }))).toBe(true);
  });

  it('real frames, also the very first of a session', () => {
    expect(isBlankFrame(frame({ SessionNum: 2, SessionTime: 1520.4, SessionState: 4, SessionUniqueID: 3 }))).toBe(false);
    expect(isBlankFrame(frame({ SessionNum: 1, SessionTime: 0, SessionState: 1, SessionUniqueID: 2 }))).toBe(false);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StintStateStore } from './stint-state.ts';

describe('StintStateStore', () => {
  it('gives back the state of the same session only; a broken file counts as none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-state-'));
    try {
      const store = new StintStateStore(join(dir, 'stint-state.json'));
      expect(store.load('1/2#2')).toBeNull();
      store.save('1/2#2', { sinceLap: [[3, 12]], onPit: [[3, false]] });
      expect(store.load('1/2#2')).toEqual({ sinceLap: [[3, 12]], onPit: [[3, false]] });
      expect(store.load('1/2#1')).toBeNull();
      writeFileSync(join(dir, 'stint-state.json'), '{nope');
      expect(store.load('1/2#2')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { cleanPanels } = createRequire(import.meta.url)('./config.cjs');

describe('panel columns', () => {
  it('default order: class colour right after the position', () => {
    expect(cleanPanels({}).standings.options.order.slice(0, 3)).toEqual(['pos', 'class', 'num']);
  });

  it('a new column goes after the column it follows by default, also in a saved order', () => {
    // saved before 0.22.1 (no class column), driver name moved to the front
    const order = ['name', 'pos', 'num', 'flag', 'make', 'team', 'irating', 'sr', 'best', 'gap', 'tyre', 'compound', 'delta'];
    expect(cleanPanels({ standings: { options: { order } } }).standings.options.order.slice(0, 4)).toEqual(['name', 'pos', 'class', 'num']);
  });

  it('unknown columns are dropped, switched-off ones stay off', () => {
    const p = cleanPanels({ relative: { options: { columns: { gap: false }, order: ['gap', 'bogus', 'name'] } } }).relative.options;
    expect(p.order).not.toContain('bogus');
    expect(p.order).toHaveLength(10);
    expect(p.columns.gap).toBe(false);
  });
});

describe('profiles (driving / watching)', () => {
  const { cleanProfile, cleanProfileMode } = createRequire(import.meta.url)('./config.cjs');
  const old = { output: 'vr', panels: cleanPanels({ fuel: { shown: false, size: 120 } }), opacity: 60 };

  it('a missing profile takes the set-up from before (one for everything)', () => {
    const p = cleanProfile(undefined, old);
    expect(p.output).toBe('vr');
    expect(p.opacity).toBe(60);
    expect(p.panels.fuel).toMatchObject({ shown: false, size: 120 });
  });

  it('a saved profile keeps its own values and gets defaults for missing panels', () => {
    const p = cleanProfile({ output: 'monitor', panels: { inputs: { shown: false, size: 80 } }, opacity: 150 }, old);
    expect(p.output).toBe('monitor');
    expect(p.opacity).toBe(100); // clamped
    expect(p.panels.inputs).toMatchObject({ shown: false, size: 80 });
    expect(p.panels.relative.options.order[0]).toBe('class');
  });

  it('mode: auto unless one profile is held', () => {
    expect(cleanProfileMode('driving')).toBe('driving');
    expect(cleanProfileMode('nonsense')).toBe('auto');
  });
});

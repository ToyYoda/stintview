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

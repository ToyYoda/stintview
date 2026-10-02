import { describe, expect, it } from 'vitest';
import { GapTrend, outlook } from './trend.ts';

describe('GapTrend', () => {
  it('fits the change of the gap per second', () => {
    const tr = new GapTrend();
    for (let t = 0; t <= 30; t++) tr.push(7, 1000 + t, 3 - t * 0.02); // closing 0.02 s per s
    expect(tr.rate()).toBeCloseTo(-0.02);
  });

  it('uses the size of the gap, also for the car behind', () => {
    const tr = new GapTrend();
    for (let t = 0; t <= 30; t++) tr.push(7, t, -2 + t * 0.01); // car behind coming closer
    expect(tr.rate()).toBeCloseTo(-0.01);
  });

  it('needs some data first and starts over for another car or a pit stop', () => {
    const tr = new GapTrend();
    for (let t = 0; t < 10; t++) tr.push(7, t, 2);
    expect(tr.rate()).toBeNull(); // only 9 s
    for (let t = 10; t < 30; t++) tr.push(7, t, 2);
    expect(tr.rate()).toBeCloseTo(0);
    tr.push(8, 30, 1.5);
    expect(tr.rate()).toBeNull();
    for (let t = 31; t < 60; t++) tr.push(8, t, 1.5);
    tr.push(8, 60, null);
    expect(tr.rate()).toBeNull();
  });

  it('forgets samples older than the window', () => {
    const tr = new GapTrend(30);
    for (let t = 0; t < 60; t++) tr.push(7, t, 5); // steady
    for (let t = 60; t <= 100; t++) tr.push(7, t, 5 - (t - 60) * 0.03); // then closing
    expect(tr.rate()).toBeCloseTo(-0.03);
  });
});

describe('outlook', () => {
  it('catching in whole laps, rounded up', () => {
    expect(outlook(2.9, -0.01, 100)).toEqual({ kind: 'closing', laps: 3 }); // 1 s per lap
  });

  it('close, steady and opening', () => {
    expect(outlook(-0.4, null, null)).toEqual({ kind: 'close' });
    expect(outlook(2, 0.0002, 100)).toEqual({ kind: 'steady' });
    expect(outlook(2, -0.0001, 100)).toEqual({ kind: 'steady' }); // 100 laps away
    expect(outlook(2, 0.002, 100)).toEqual({ kind: 'opening' });
    expect(outlook(2, null, 100)).toBeNull();
  });
});

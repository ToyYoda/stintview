import { describe, expect, it } from 'vitest';
import { STABLE_S, WeatherTracker, precipLevel, type WeatherSample } from './weather.ts';

const base: WeatherSample = {
  sessionTime: 0, timeOfDay: 13 * 3600, airTemp: 18.6, trackTemp: 25,
  skies: 3, precipitation: 0, wetness: 1, declaredWet: false,
};
const at = (t: number, patch: Partial<WeatherSample> = {}): WeatherSample =>
  ({ ...base, sessionTime: t, timeOfDay: base.timeOfDay + t, ...patch });

describe('WeatherTracker', () => {
  it('reports nothing for steady weather and small temperature noise', () => {
    const w = new WeatherTracker();
    for (let t = 0; t < 600; t += 1) w.feed(at(t, { trackTemp: 25 + Math.sin(t) * 0.8 }));
    expect(w.events).toEqual([]);
    expect(w.current()?.trackTrend).toBe(0);
  });

  it('reports a cloud change only after it held for STABLE_S', () => {
    const w = new WeatherTracker();
    w.feed(at(0));
    w.feed(at(10, { skies: 2 }));
    w.feed(at(15, { skies: 3 })); // flicker back: no event
    w.feed(at(20, { skies: 2 }));
    expect(w.feed(at(20 + STABLE_S - 1, { skies: 2 }))).toEqual([]);
    const ev = w.feed(at(20 + STABLE_S, { skies: 2 }));
    expect(ev).toEqual([{ sessionTime: 20, timeOfDay: base.timeOfDay + 20, kind: 'skies', from: 3, to: 2 }]);
  });

  it('reports rain starting, the track getting wet and rain tyres allowed', () => {
    const w = new WeatherTracker();
    w.feed(at(0));
    for (let t = 100; t <= 100 + STABLE_S; t++) w.feed(at(t, { precipitation: 0.2 }));
    for (let t = 300; t <= 300 + STABLE_S; t++) w.feed(at(t, { precipitation: 0.2, wetness: 4, declaredWet: true }));
    expect(w.events.map((e) => [e.kind, e.from, e.to])).toEqual([
      ['precip', 0, 1],
      ['wetness', 1, 4],
      ['declaredWet', 0, 1],
    ]);
  });

  it('reports temperature swings in steps and shows the trend', () => {
    const w = new WeatherTracker();
    for (let t = 0; t <= 900; t += 10) w.feed(at(t, { trackTemp: 31 - t / 100 })); // 31 -> 22 °C
    expect(w.events.map((e) => [e.kind, e.from, e.to])).toEqual([
      ['trackTemp', 31, 28],
      ['trackTemp', 28, 25],
      ['trackTemp', 25, 22],
    ]);
    expect(w.current()?.trackTrend).toBe(-1);
    expect(w.current()?.airTrend).toBe(0);
  });

  it('starts over when the session time jumps back', () => {
    const w = new WeatherTracker();
    w.feed(at(0));
    for (let t = 1; t <= 1 + STABLE_S; t++) w.feed(at(t, { skies: 0 }));
    expect(w.events).toHaveLength(1);
    w.feed(at(5));
    expect(w.events).toHaveLength(0);
  });

  it('buckets precipitation', () => {
    expect([0, 0.005, 0.1, 0.4, 0.9].map(precipLevel)).toEqual([0, 0, 1, 2, 3]);
  });
});

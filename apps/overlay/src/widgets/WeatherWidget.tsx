import type { Weather, WeatherEvent } from '@stintview/protocol';

const SKIES = ['klar', 'leicht bewölkt', 'stark bewölkt', 'bedeckt'];
const PRECIP = ['kein Regen', 'leichter Regen', 'Regen', 'starker Regen'];
const WETNESS = ['unbekannt', 'trocken', 'fast trocken', 'minimal feucht', 'leicht nass', 'nass', 'sehr nass', 'extrem nass'];
const MAX_EVENTS = 6;

const clock = (s: number) => {
  const m = Math.floor(((s % 86400) + 86400) % 86400 / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const temp = (c: number) => `${c.toFixed(1)} °C`;
const arrow = (trend: number) => (trend > 0 ? '↑' : trend < 0 ? '↓' : '');
const pick = (list: string[], i: number) => list[i] ?? `? (${i})`;

function describe(e: WeatherEvent): string {
  switch (e.kind) {
    case 'skies': return `Wolken: ${pick(SKIES, e.from)} → ${pick(SKIES, e.to)}`;
    case 'precip': return e.to > e.from ? `${pick(PRECIP, e.to)} setzt ein` : `${pick(PRECIP, e.from)} lässt nach → ${pick(PRECIP, e.to)}`;
    case 'wetness': return `Strecke: ${pick(WETNESS, e.from)} → ${pick(WETNESS, e.to)}`;
    case 'declaredWet': return e.to ? 'Regenreifen freigegeben' : 'Regenreifen-Freigabe aufgehoben';
    case 'airTemp': return `Luft ${Math.round(e.from)} → ${Math.round(e.to)} °C`;
    case 'trackTemp': return `Strecke ${Math.round(e.from)} → ${Math.round(e.to)} °C`;
  }
}

/**
 * Current weather and the changes seen so far (newest first) – instead of iRacing's
 * 15-minute grid. A real forecast is not available from the telemetry (see issue #1).
 */
export function WeatherWidget({ weather }: { weather: Weather | null }) {
  const now = weather?.now;
  const events = [...(weather?.events ?? [])].reverse().slice(0, MAX_EVENTS);
  const wet = now ? now.wetness >= 3 : false;

  return (
    <div className="panel weather">
      <div className="title">
        Wetter
        <span className="hint">{now ? `${clock(now.timeOfDay)} Uhr` : ''}</span>
      </div>
      {now ? (
        <>
          <div className="wx-grid">
            <div><span className="label">Luft</span><span className="mid">{temp(now.airTemp)} <i>{arrow(now.airTrend)}</i></span></div>
            <div><span className="label">Strecke</span><span className="mid">{temp(now.trackTemp)} <i>{arrow(now.trackTrend)}</i></span></div>
            <div><span className="label">Wolken</span><span>{pick(SKIES, now.skies)}</span></div>
            <div><span className="label">Niederschlag</span><span>{now.precipitation < 0.01 ? 'kein' : `${Math.round(now.precipitation * 100)} %`}</span></div>
            <div className="wx-wide">
              <span className="label">Streckenzustand</span>
              <span className={wet ? 'wx-wet' : ''}>{pick(WETNESS, now.wetness)}</span>
              {now.declaredWet && <span className="wx-badge">Regenreifen frei</span>}
            </div>
          </div>
          <div className="wx-events">
            <div className="label">Änderungen</div>
            {events.length === 0 && <div className="label">bisher keine</div>}
            {events.map((e) => (
              <div key={`${e.sessionTime}|${e.kind}`} className="wx-event">
                <span className="wx-time">{clock(e.timeOfDay)}</span>
                <span>{describe(e)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="label">Noch keine Wetterdaten</div>
      )}
    </div>
  );
}

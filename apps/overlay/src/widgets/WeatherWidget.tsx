import type { Weather, WeatherEvent } from '@stintview/protocol';
import { t, tList } from '../i18n.ts';

const SKIES = () => tList('wx.skies');
const PRECIP = () => tList('wx.precipLevels');
const WETNESS = () => tList('wx.wetness');
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
    case 'skies': return t('wx.ev.skies', { from: pick(SKIES(), e.from), to: pick(SKIES(), e.to) });
    case 'precip': return e.to > e.from ? t('wx.ev.precipStart', { to: pick(PRECIP(), e.to) }) : t('wx.ev.precipEase', { from: pick(PRECIP(), e.from), to: pick(PRECIP(), e.to) });
    case 'wetness': return t('wx.ev.wetness', { from: pick(WETNESS(), e.from), to: pick(WETNESS(), e.to) });
    case 'declaredWet': return e.to ? t('wx.ev.wetOn') : t('wx.ev.wetOff');
    case 'airTemp': return t('wx.ev.air', { from: Math.round(e.from), to: Math.round(e.to) });
    case 'trackTemp': return t('wx.ev.track', { from: Math.round(e.from), to: Math.round(e.to) });
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
        {t('wx.title')}
        <span className="hint">{now ? t('wx.clock', { time: clock(now.timeOfDay) }) : ''}</span>
      </div>
      {now ? (
        <>
          <div className="wx-grid">
            <div><span className="label">{t('wx.air')}</span><span className="mid">{temp(now.airTemp)} <i>{arrow(now.airTrend)}</i></span></div>
            <div><span className="label">{t('wx.track')}</span><span className="mid">{temp(now.trackTemp)} <i>{arrow(now.trackTrend)}</i></span></div>
            <div><span className="label">{t('wx.clouds')}</span><span>{pick(SKIES(), now.skies)}</span></div>
            <div><span className="label">{t('wx.precip')}</span><span>{now.precipitation < 0.01 ? t('wx.none') : `${Math.round(now.precipitation * 100)} %`}</span></div>
            <div className="wx-wide">
              <span className="label">{t('wx.state')}</span>
              <span className={wet ? 'wx-wet' : ''}>{pick(WETNESS(), now.wetness)}</span>
              {now.declaredWet && <span className="wx-badge">{t('wx.rainTyres')}</span>}
            </div>
          </div>
          <div className="wx-events">
            <div className="label">{t('wx.changes')}</div>
            {events.length === 0 && <div className="label">{t('wx.noChanges')}</div>}
            {events.map((e) => (
              <div key={`${e.sessionTime}|${e.kind}`} className="wx-event">
                <span className="wx-time">{clock(e.timeOfDay)}</span>
                <span>{describe(e)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="label">{t('wx.noData')}</div>
      )}
    </div>
  );
}

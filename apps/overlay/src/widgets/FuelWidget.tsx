import { fuelStats } from '@stintview/telemetry';
import { t } from '../i18n.ts';
import type { Fuel, Status } from '@stintview/protocol';

const fmt = (v: number | null, digits = 2) => (v === null ? '–' : v.toFixed(digits));

/** Fuel used per lap (last / avg of 3 / avg of 5) and laps remaining. */
export function FuelWidget({ fuel, status }: { fuel: Fuel | null; status: Status | null }) {
  const level = status?.fuelLevel ?? null;
  const laps = fuel?.laps ?? [];
  const s = level !== null ? fuelStats(laps, level) : null;
  const recent = laps.slice(-8);
  const max = Math.max(...recent.map((l) => l.used), 0.001);

  return (
    <div className="panel fuel">
      <div className="title">{t('fuel.title')}</div>
      <div className="big-row">
        <div>
          <div className="big">{fmt(level, 1)}<span className="unit"> l</span></div>
          <div className="label">{t('fuel.inTank')}</div>
        </div>
        <div>
          <div className="big accent">{s?.lapsRemaining?.toFixed(1) ?? '–'}</div>
          <div className="label">{t('fuel.lapsLeft')}</div>
        </div>
      </div>
      <div className="grid3">
        <Stat label={t('fuel.last')} value={fmt(s?.lastLap ?? null)} />
        <Stat label={t('fuel.avg', { n: 3 })} value={fmt(s?.avg3 ?? null)} />
        <Stat label={t('fuel.avg', { n: 5 })} value={fmt(s?.avg5 ?? null)} />
      </div>
      <div className="lapbars" aria-label={t('fuel.barsLabel')}>
        {recent.map((l, i) => {
          // Change to the lap before (only between two normal laps: pit laps are not comparable).
          const prev = laps[laps.length - recent.length + i - 1];
          const raw = prev && !prev.pit && !l.pit ? l.used - prev.used : null;
          const diff = raw !== null && Math.abs(raw) < 0.005 ? 0 : raw;
          return (
            <div key={l.lap} className="lapbar" title={`${t('fuel.lapTitle', { lap: l.lap, used: l.used.toFixed(2) })}${l.pit ? t('fuel.pit') : ''}`}>
              <span className={diff === null ? 'lap-diff' : diff < 0 ? 'lap-diff less' : diff > 0 ? 'lap-diff more' : 'lap-diff'}>
                {diff === null ? '' : diff === 0 ? '±0.00' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}`}
              </span>
              <div className="bar-area">
                <div className={l.pit ? 'fill pit' : 'fill'} style={{ height: `${Math.max(30, (l.used / max) * 100)}%` }}>
                  <span className="lap-used">{l.used >= 10 ? l.used.toFixed(1) : l.used.toFixed(2)}</span>
                </div>
              </div>
              <span className="lap-no">{l.lap}</span>
            </div>
          );
        })}
        {!recent.length && <div className="label">{t('fuel.noLap')}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mid">{value}<span className="unit"> l</span></div>
      <div className="label">{label}</div>
    </div>
  );
}

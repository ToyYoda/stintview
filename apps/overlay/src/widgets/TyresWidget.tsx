import { estimateWear } from '@stintview/telemetry';
import { t } from '../i18n.ts';
import type { Status, Tyres, Wheel } from '@stintview/protocol';

const LAYOUT: Wheel[] = ['LF', 'RF', 'LR', 'RR'];

/** Rough GT colour bands for carcass temperature, °C. */
function tempClass(c: number) {
  if (c < 65) return 'cold';
  if (c <= 95) return 'ok';
  return 'hot';
}

/**
 * iRacing only measures carcass temperature and wear in the pit stall, so this
 * shows the last measurement plus an estimate of the current tread from km driven.
 */
export function TyresWidget({ tyres, status }: { tyres: Tyres | null; status: Status | null }) {
  const last = tyres?.measurements.at(-1) ?? null;
  const est = status && tyres ? estimateWear(tyres.measurements, status.odometer) : null;

  return (
    <div className="panel tyres">
      <div className="title">
        {t('tyres.title')}
        <span className="hint">{last ? t('tyres.measured', { lap: last.lap }) : t('tyres.noStop')}</span>
      </div>
      <div className="wheels">
        {LAYOUT.map((w) => {
          const e = est?.[w];
          return (
            <div key={w} className="wheel">
              <div className="wheel-head">
                <span>{t(`tyres.${w}`)}</span>
                <span className="label">{status ? `${(status.odometer[w] / 1000).toFixed(1)} km` : ''}</span>
              </div>
              <div className="temps">
                {(last?.carcass[w] ?? [NaN, NaN, NaN]).map((c, i) => (
                  <span key={i} className={Number.isNaN(c) ? 'temp' : `temp ${tempClass(c)}`}>
                    {Number.isNaN(c) ? '–' : Math.round(c)}
                  </span>
                ))}
              </div>
              <div className="wear">
                <span title={t('tyres.treadNow')} className="mid">
                  {e?.remaining != null ? `${Math.round(e.remaining * 100)}%` : '–'}
                </span>
                <span className="label">
                  {last ? t('tyres.atStop', { pct: Math.round(Math.min(...last.wear[w]) * 100) }) : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {!last && <div className="label note">{t('tyres.onlyInPit')}</div>}
    </div>
  );
}

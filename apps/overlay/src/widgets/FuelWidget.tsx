import { fuelPlan, fuelStats, type FuelPlan } from '@stintview/telemetry';
import { t } from '../i18n.ts';
import type { Fuel, SessionInfo, Status } from '@stintview/protocol';

/** A saving above this share of the consumption is not realistic: not shown. */
const MAX_SAVE_PCT = 0.15;

const fmt = (v: number | null, digits = 2) => (v === null ? '–' : v.toFixed(digits));

/**
 * Fuel used per lap (last / avg of 3 / avg of 5) and laps remaining; in the race also fuel
 * to the finish: stops still needed, latest in-lap, the saving per lap that cuts a stop and
 * the litres for the last stop.
 */
export function FuelWidget({ fuel, status, session }: { fuel: Fuel | null; status: Status | null; session?: SessionInfo | null }) {
  const level = status?.fuelLevel ?? null;
  const laps = fuel?.laps ?? [];
  const s = level !== null ? fuelStats(laps, level) : null;
  const recent = laps.slice(-8);
  const max = Math.max(...recent.map((l) => l.used), 0.001);
  // Only in races; practice/qualifying (and an unknown session) show the upper part only.
  const plan = status && s && /race/i.test(session?.sessionType ?? '') ? planFor(laps, status, s.avg5 ?? s.avg3 ?? s.lastLap) : null;

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
      {plan && <PlanBlock plan={plan} />}
    </div>
  );
}

/** Plan from the recent green laps (consumption, lap time) and the race length in `status`. */
function planFor(laps: Fuel['laps'], status: Status, perLap: number | null): FuelPlan | null {
  const green = laps.filter((l) => !l.pit && l.used > 0 && l.lapTime > 0).slice(-5);
  if (!perLap || !green.length || !status.usableTank) return null;
  return fuelPlan({
    fuelLevel: status.fuelLevel, lap: status.lap, lapDistPct: status.lapDistPct, perLap,
    lapTime: green.reduce((a, l) => a + l.lapTime, 0) / green.length,
    timeRemain: status.timeRemain ?? null, lapsRemain: status.lapsRemain ?? null, usableTank: status.usableTank,
  });
}

function PlanBlock({ plan }: { plan: FuelPlan }) {
  const save = plan.saveTarget && plan.saveTarget.pct > 0 && plan.saveTarget.pct <= MAX_SAVE_PCT ? plan.saveTarget : null;
  return (
    <div className="fuel-plan">
      <div className="fuel-plan-head">
        <span>{t('fuel.toFinish')}</span>
        <span className="mono">{t('fuel.lapsToGo', { n: plan.lapsToGo.toFixed(1) })} · {plan.needed.toFixed(1)} l</span>
      </div>
      {plan.stops === 0 ? (
        <div className={plan.reserve! < 1 ? 'fuel-plan-main warn' : 'fuel-plan-main ok'}>
          {t('fuel.enough')} · {t('fuel.reserve', { l: plan.reserve!.toFixed(1) })}
        </div>
      ) : (
        <>
          <div className="fuel-plan-main">
            {plan.stops === 1 ? t('fuel.stop1') : t('fuel.stopsN', { n: plan.stops })}
            {plan.pitByLap !== null && <span className="fuel-plan-pit"> · {t('fuel.pitBy', { lap: plan.pitByLap })}</span>}
          </div>
          {save && <div className="fuel-plan-line save">{t('fuel.save', { target: save.perLap.toFixed(2), save: save.save.toFixed(2), pct: save.pct < 0.1 ? (save.pct * 100).toFixed(1) : Math.round(save.pct * 100) })}</div>}
          {plan.lastStopFuel !== null && <div className="fuel-plan-line">{t('fuel.lastStop', { l: Math.ceil(plan.lastStopFuel) })}</div>}
        </>
      )}
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

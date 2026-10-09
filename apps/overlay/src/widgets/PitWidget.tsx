import type { Pitplan, RejoinCar } from '@stintview/protocol';
import { t } from '../i18n.ts';
import 'flag-icons/css/flag-icons.min.css';

/** Closer than this to a car when we rejoin: traffic. */
const TRAFFIC_S = 1.5;
const TIGHT_S = 3;

/**
 * "If we pit now": how long the stop takes with the pit settings in the car, and which
 * cars (all classes) are around us when we come back out – assuming nobody else stops.
 */
export function PitWidget({ plan }: { plan: Pitplan | null }) {
  if (!plan) {
    return (
      <div className="panel pitstop">
        <div className="title">{t('pit.title')}</div>
        <div className="label">{t('pit.noData')}</div>
      </div>
    );
  }
  const ahead = plan.rejoin?.ahead ?? [];
  const behind = plan.rejoin?.behind ?? [];
  const nearest = Math.min(ahead[0]?.gap ?? Infinity, -(behind[0]?.gap ?? -Infinity));
  const room = ahead[0] && behind[0] ? ahead[0].gap - behind[0].gap : null;
  const verdict = nearest < TRAFFIC_S ? 'traffic' : nearest < TIGHT_S ? 'tight' : 'free';

  return (
    <div className="panel pitstop">
      <div className="title">
        {plan.inPit ? t('pit.titleInPit') : t('pit.title')}
        <span className="hint">{t(`pit.src.${plan.source}`)}{plan.source === 'measured' ? ` ${plan.stops === 1 ? t('pit.stop1') : t('pit.stops', { n: plan.stops })}` : ''}</span>
      </div>

      <div className="pit-total">
        <span className="big">{plan.total !== null ? `${plan.total.toFixed(0)} s` : '–'}</span>
        <span className="pit-parts">
          {t('pit.parts', { lane: plan.laneLoss !== null ? `${plan.laneLoss.toFixed(0)} s${plan.laneFrom === 'archive' ? t('pit.archive') : ''}` : '?', stand: plan.stationary.toFixed(0) })}
        </span>
      </div>

      <div className="pit-service">
        <span>{plan.fuel > 0 ? t('pit.fuel', { l: plan.fuel.toFixed(0), s: plan.fuelTime.toFixed(0) }) : t('pit.noFuel')}</span>
        <span>{plan.tyres > 0 ? t('pit.tyres', { n: plan.tyres, s: plan.tyreTime.toFixed(0) }) : t('pit.noTyres')}</span>
        {plan.fuel > 0 && plan.tyres > 0 && (
          <span className="muted" title={plan.regulationFrom === 'default' ? t('pit.unknownSeries') : undefined}>
            {plan.simultaneous ? t('pit.simultaneous') : t('pit.sequential')} ({plan.regulation}{plan.regulationFrom === 'default' ? '?' : ''})
          </span>
        )}
        {plan.repair > 0 && <span className="warn">{t('pit.repair', { s: plan.repair.toFixed(0) })}</span>}
        {plan.optRepair > 0 && <span className="muted">{t('pit.optional', { s: plan.optRepair.toFixed(0) })}</span>}
      </div>

      {plan.laneLoss === null ? (
        <div className="label">{t('pit.laneUnknown')}</div>
      ) : plan.rejoin && (
        <>
          <div className={`pit-verdict ${verdict}`}>
            {plan.rejoin.classPos ? t('pit.rejoinPos', { pos: plan.rejoin.classPos }) : t('pit.rejoin')}
            {' · '}
            {verdict === 'traffic' ? t('pit.traffic') : verdict === 'tight' ? t('pit.tight') : t('pit.free')}
            {room !== null && <span className="muted"> · {t('pit.room', { s: room.toFixed(1) })}</span>}
          </div>
          <table className="pit-cars">
            <tbody>
              {[...ahead].reverse().map((c) => <Row key={c.carIdx} car={c} />)}
              <tr className="us"><td colSpan={4}>{t('pit.us')}</td></tr>
              {behind.map((c) => <Row key={c.carIdx} car={c} />)}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Current position in front; cars on another lap after the stop: blue = backmarker, red = lapping us. */
function Row({ car }: { car: RejoinCar }) {
  const near = Math.abs(car.gap) < TRAFFIC_S ? 'traffic' : Math.abs(car.gap) < TIGHT_S ? 'tight' : '';
  const lap = !car.laps ? '' : car.laps < 0 ? ' lap-down' : ' lap-up';
  return (
    <tr className={`${car.sameClass ? '' : 'other-class'}${lap}`}>
      <td className="pc-pos">{car.pos ? `P${car.pos}` : ''}</td>
      <td className="pc-num">#{car.number}</td>
      <td className="pc-name">
        {car.country && /^[a-z]{2}(-[a-z]{3})?$/.test(car.country) && <span className={`fi fi-${car.country} st-flag`} />}
        {car.name}
        {!car.sameClass && <span className="pc-tag">{t('pit.otherClass')}</span>}
        {car.inPit && <span className="pc-tag">{t('pit.box')}</span>}
      </td>
      <td className={`pc-gap ${near}`}>{car.gap > 0 ? '+' : '−'}{Math.abs(car.gap).toFixed(1)}</td>
    </tr>
  );
}

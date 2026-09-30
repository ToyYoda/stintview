import type { Pitplan, RejoinCar } from '@stintview/protocol';
import 'flag-icons/css/flag-icons.min.css';

const SOURCE: Record<Pitplan['source'], string> = {
  rules: 'iRacing-Regeln',
  measured: 'gemessen',
  default: 'Schätzwerte',
  manual: 'manuell',
};

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
        <div className="title">Boxenstopp</div>
        <div className="label">Noch keine Daten – erscheint, sobald jemand fährt</div>
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
        {plan.inPit ? 'Boxenstopp – in der Box' : 'Boxenstopp, wenn jetzt'}
        <span className="hint">{SOURCE[plan.source]}{plan.source === 'measured' ? ` (${plan.stops} Stopp${plan.stops === 1 ? '' : 's'})` : ''}</span>
      </div>

      <div className="pit-total">
        <span className="big">{plan.total !== null ? `${plan.total.toFixed(0)} s` : '–'}</span>
        <span className="pit-parts">
          Boxengasse {plan.laneLoss !== null ? `${plan.laneLoss.toFixed(0)} s` : '?'} + Stand {plan.stationary.toFixed(0)} s
        </span>
      </div>

      <div className="pit-service">
        <span>{plan.fuel > 0 ? `Tanken ${plan.fuel.toFixed(0)} l · ${plan.fuelTime.toFixed(0)} s` : 'Kein Sprit'}</span>
        <span>{plan.tyres > 0 ? `${plan.tyres} Reifen · ${plan.tyreTime.toFixed(0)} s` : 'Keine Reifen'}</span>
        {plan.fuel > 0 && plan.tyres > 0 && (
          <span className="muted" title={plan.regulationFrom === 'default' ? 'Serie unbekannt – im StintView-Fenster unter Boxenstopp wählbar' : undefined}>
            {plan.simultaneous ? 'gleichzeitig' : 'nacheinander'} ({plan.regulation}{plan.regulationFrom === 'default' ? '?' : ''})
          </span>
        )}
        {plan.repair > 0 && <span className="warn">Reparatur {plan.repair.toFixed(0)} s</span>}
        {plan.optRepair > 0 && <span className="muted">+{plan.optRepair.toFixed(0)} s optional</span>}
      </div>

      {plan.laneLoss === null ? (
        <div className="label">Boxengasse an dieser Strecke noch nicht gemessen – das passiert automatisch, sobald ein Auto an die Box fährt.</div>
      ) : plan.rejoin && (
        <>
          <div className={`pit-verdict ${verdict}`}>
            Rückkehr{plan.rejoin.classPos ? ` als P${plan.rejoin.classPos}` : ''}
            {' · '}
            {verdict === 'traffic' ? 'im Verkehr' : verdict === 'tight' ? 'knapp' : 'freie Strecke'}
            {room !== null && <span className="muted"> · Lücke {room.toFixed(1)} s</span>}
          </div>
          <table className="pit-cars">
            <tbody>
              {[...ahead].reverse().map((c) => <Row key={c.carIdx} car={c} />)}
              <tr className="us"><td colSpan={3}>▶ wir nach dem Stopp</td></tr>
              {behind.map((c) => <Row key={c.carIdx} car={c} />)}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Row({ car }: { car: RejoinCar }) {
  const near = Math.abs(car.gap) < TRAFFIC_S ? 'traffic' : Math.abs(car.gap) < TIGHT_S ? 'tight' : '';
  return (
    <tr className={car.sameClass ? '' : 'other-class'}>
      <td className="pc-num">#{car.number}</td>
      <td className="pc-name">
        {car.country && /^[a-z]{2}(-[a-z]{3})?$/.test(car.country) && <span className={`fi fi-${car.country} st-flag`} />}
        {car.name}
        {!car.sameClass && <span className="pc-tag">andere Klasse</span>}
        {car.inPit && <span className="pc-tag">Box</span>}
      </td>
      <td className={`pc-gap ${near}`}>{car.gap > 0 ? '+' : '−'}{Math.abs(car.gap).toFixed(1)}</td>
    </tr>
  );
}

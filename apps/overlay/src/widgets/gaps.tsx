import type { StandingRow } from '@stintview/protocol';
import { t } from '../i18n.ts';
import 'flag-icons/css/flag-icons.min.css';

/** Flag of the driver's country, if iRacing gave a usable code. */
export function Flag({ country }: { country?: string | null }) {
  return country && /^[a-z]{2}(-[a-z]{3})?$/.test(country) ? <span className={`fi fi-${country} st-flag`} /> : null;
}

/** Big line: the class neighbour in front (▲) or behind (▼) and the gap to it. */
export function Duel({ car, arrow }: { car: StandingRow | undefined; arrow: string }) {
  if (!car) return <div className="duel empty" />;
  return (
    <div className="duel">
      <span className="duel-arrow">{arrow}</span>
      <span className="duel-name">
        <Flag country={car.country} />
        #{car.number} {car.name}
      </span>
      <span className={`gap-tile big ${gapClass(car.gap, car.lapsGap)}`}>{gapText(car.gap, car.lapsGap)}</span>
    </div>
  );
}

/** Within 1 s: attack (ahead, amber) / defend (behind, red); 1–3 s normal; further away dimmed; other lap blue. */
export function gapClass(gap: number | null | undefined, laps: number | undefined) {
  if (laps) return 'lap';
  if (gap == null) return '';
  const a = Math.abs(gap);
  if (a < 1) return gap >= 0 ? 'attack' : 'defend';
  return a < 3 ? 'near' : 'far';
}

export function gapText(gap: number | null | undefined, laps: number | undefined) {
  if (laps) return `${laps > 0 ? '+' : '−'}${t('st.laps', { n: Math.abs(laps) })}`;
  if (gap == null) return '–';
  return `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}`;
}

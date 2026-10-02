import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import type { DuelOptions } from '../feed.ts';
import { Flag, bestClass, bestGapText, gapClass, gapText } from './gaps.tsx';

/**
 * One line in driving direction: class neighbour behind (left) – gap – us – gap – class
 * neighbour in front (right). Optionally the cars on another lap physically between us and
 * them as small chips (number only): blue = we are lapping them, red = they are lapping us,
 * outlined = other class. Practice/qualifying: neighbours by best lap, no chips.
 */
export function DuelWidget({ standings, options }: { standings: Standings | null; options?: DuelOptions | null }) {
  const rows = standings?.rows ?? [];
  const best = standings?.mode === 'best';
  const team = rows.find((r) => r.isTeam);
  const front = team ? rows.find((r) => r.pos === team.pos - 1) : undefined;
  const back = team ? rows.find((r) => r.pos === team.pos + 1) : undefined;
  const traffic = options?.traffic === false || best ? null : standings?.between;

  if (!team) return <div className="panel duel-panel"><div className="label">{t('st.noData')}</div></div>;
  return (
    <div className="panel duel-panel">
      {back ? <Rival car={back} arrow="▼" /> : <div className="duel-edge">{t('duel.last')}</div>}
      {/* Behind: nearest car next to us, i.e. on the right. */}
      <Gap car={back} best={best} chips={[...(traffic?.behind ?? [])].reverse()} />
      <div className="duel-us">
        <span className="duel-us-pos">P{team.pos}</span>#{team.number}
      </div>
      <Gap car={front} best={best} chips={traffic?.ahead ?? []} />
      {front ? <Rival car={front} arrow="▲" /> : <div className="duel-edge">{t('duel.leader')}</div>}
    </div>
  );
}

/** Class neighbour: flag, number and short name. */
function Rival({ car, arrow }: { car: StandingRow; arrow: string }) {
  return (
    <div className="duel-rival">
      {arrow === '▼' && <span className="duel-arrow">{arrow}</span>}
      <span className="duel-name">
        <Flag country={car.country} />
        #{car.number} {shortName(car.name)}
      </span>
      {arrow === '▲' && <span className="duel-arrow">{arrow}</span>}
    </div>
  );
}

/** Between us and a neighbour: the gap, and under it the cars on another lap in that stretch. */
function Gap({ car, best, chips }: { car: StandingRow | undefined; best: boolean; chips: StandingRow[] }) {
  if (!car) return <div className="duel-gap" />;
  const tile = best
    ? <span className={`gap-tile big ${car.gap == null ? 'far' : bestClass(car.gap)}`}>{car.gap == null ? '–' : bestGapText(car.gap)}</span>
    : <span className={`gap-tile big ${gapClass(car.gap, car.lapsGap)}`}>{gapText(car.gap, car.lapsGap)}</span>;
  return (
    <div className="duel-gap">
      {tile}
      {chips.length > 0 && (
        <div className="duel-chips">
          {chips.map((c) => (
            <span key={c.carIdx} className={`duel-chip ${(c.lapsGap ?? 0) < 0 ? 'down' : 'up'}${c.otherClass ? ' other' : ''}`}>
              #{c.number}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Marco Rossi" -> "M. Rossi"; single names stay. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0]![0]}. ${parts[parts.length - 1]}`;
}

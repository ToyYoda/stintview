import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import type { DuelOptions } from '../feed.ts';
import { Duel, Flag, gapText } from './gaps.tsx';

/**
 * The class neighbours in front (▲) and behind (▼) us with the gap, large. Optionally the
 * cars on another lap physically between us and them (traffic): blue = we are lapping them,
 * red = they are lapping us; gap = physical gap on track. Practice/qualifying: best-lap gap.
 */
export function DuelWidget({ standings, options }: { standings: Standings | null; options?: DuelOptions | null }) {
  const rows = standings?.rows ?? [];
  const best = standings?.mode === 'best';
  const team = rows.find((r) => r.isTeam);
  const front = team ? rows.find((r) => r.pos === team.pos - 1) : undefined;
  const back = team ? rows.find((r) => r.pos === team.pos + 1) : undefined;
  const traffic = options?.traffic === false || best ? null : standings?.between;

  return (
    <div className="panel duel-panel">
      <div className="title">
        {t('duel.title')}
        {team && <span className="hint">P{team.pos}</span>}
      </div>
      {!team ? (
        <div className="label">{t('st.noData')}</div>
      ) : (
        <>
          {front ? <Duel car={front} arrow="▲" best={best} /> : <div className="duel-edge">{t('duel.leader')}</div>}
          {[...(traffic?.ahead ?? [])].reverse().map((r) => <Traffic key={r.carIdx} car={r} />)}
          <div className="duel-us">
            <Flag country={team.country} />
            #{team.number} {team.name}
          </div>
          {(traffic?.behind ?? []).map((r) => <Traffic key={r.carIdx} car={r} />)}
          {back ? <Duel car={back} arrow="▼" best={best} /> : <div className="duel-edge">{t('duel.last')}</div>}
        </>
      )}
    </div>
  );
}

/** A car on another lap between us and a class neighbour. */
function Traffic({ car }: { car: StandingRow }) {
  const laps = car.lapsGap ?? 0;
  return (
    <div className={`duel-traffic ${laps < 0 ? 'down' : 'up'}`}>
      <span className="duel-name">
        <Flag country={car.country} />
        #{car.number} {car.name}
      </span>
      <span className="duel-tag">{gapText(null, laps)}</span>
      {car.otherClass && <span className="duel-tag">{t('duel.otherClass')}</span>}
      <span className="gap-tile">{gapText(car.gap, 0)}</span>
    </div>
  );
}

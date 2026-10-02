import { useRef } from 'react';
import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import type { DuelOptions } from '../feed.ts';
import { Flag, bestClass, bestGapText, gapClass, gapText } from './gaps.tsx';
import { GapTrend, outlook } from './trend.ts';

type Side = 'behind' | 'ahead';

/** Gap at which the closeness bar is empty; it fills up as the neighbour gets closer. */
const BAR_FULL_RANGE = 3;

/**
 * One line in driving direction: class neighbour behind (left) – gap – our position – gap –
 * class neighbour in front (right). Under each gap a bar that fills as the neighbour gets
 * closer and the outlook ("catch in ~3 L"), fitted over the last 90 s. Optionally the cars on
 * another lap physically between us and them as small chips (number only): blue = we are
 * lapping them, red = they are lapping us, outlined = other class.
 * Practice/qualifying: neighbours by best lap, no bar, outlook or chips.
 */
export function DuelWidget({ standings, options }: { standings: Standings | null; options?: DuelOptions | null }) {
  const trends = useRef({ behind: new GapTrend(), ahead: new GapTrend() });
  const rows = standings?.rows ?? [];
  const best = standings?.mode === 'best';
  const team = rows.find((r) => r.isTeam);
  const front = team ? rows.find((r) => r.pos === team.pos - 1) : undefined;
  const back = team ? rows.find((r) => r.pos === team.pos + 1) : undefined;
  const traffic = options?.traffic === false || best ? null : standings?.between;

  // Feed the trends (same session time twice is ignored, so re-renders don't count).
  if (standings && team) {
    const feed = (trend: GapTrend, car: StandingRow | undefined) => {
      const usable = car && !best && !car.lapsGap && !car.inPit && !team.inPit && car.gap != null;
      trend.push(car?.carIdx ?? null, standings.sessionTime, usable ? car.gap! : null);
    };
    feed(trends.current.behind, back);
    feed(trends.current.ahead, front);
  }

  if (!team) return <div className="panel duel-panel"><div className="label">{t('st.noData')}</div></div>;
  const lapTime = team.lastLap;
  return (
    <div className="panel duel-panel">
      {back ? <Rival car={back} side="behind" /> : <div className="duel-edge">{t('duel.last')}</div>}
      <Gap side="behind" car={back} best={best} trend={trends.current.behind} lapTime={lapTime}
        chips={[...(traffic?.behind ?? [])].reverse()} />
      <div className="duel-us">P{team.pos}</div>
      <Gap side="ahead" car={front} best={best} trend={trends.current.ahead} lapTime={lapTime}
        chips={traffic?.ahead ?? []} />
      {front ? <Rival car={front} side="ahead" /> : <div className="duel-edge">{t('duel.leader')}</div>}
    </div>
  );
}

/** Class neighbour: flag, number and short name. */
function Rival({ car, side }: { car: StandingRow; side: Side }) {
  return (
    <div className="duel-rival">
      {side === 'behind' && <span className="duel-arrow">▼</span>}
      <span className="duel-name">
        <Flag country={car.country} />
        #{car.number} {shortName(car.name)}
      </span>
      {side === 'ahead' && <span className="duel-arrow">▲</span>}
    </div>
  );
}

/** Between us and a neighbour: gap, closeness bar, outlook and the cars on another lap in that stretch. */
function Gap({ side, car, best, trend, lapTime, chips }: {
  side: Side; car: StandingRow | undefined; best: boolean; trend: GapTrend; lapTime: number | null; chips: StandingRow[];
}) {
  if (!car) return <div className={`duel-gap ${side}`} />;
  if (best) {
    return (
      <div className={`duel-gap ${side}`}>
        <span className={`gap-tile big ${car.gap == null ? 'far' : bestClass(car.gap)}`}>{car.gap == null ? '–' : bestGapText(car.gap)}</span>
      </div>
    );
  }
  const cls = gapClass(car.gap, car.lapsGap);
  const sameLap = !car.lapsGap && car.gap != null;
  const fill = sameLap ? Math.max(0.04, 1 - Math.abs(car.gap!) / BAR_FULL_RANGE) : 0;
  const view = sameLap ? outlook(car.gap!, trend.rate(), lapTime) : null;
  const chipList = chips.length > 0 && (
    <span className="duel-chips">
      {chips.map((c) => (
        <span key={c.carIdx} className={`duel-chip ${(c.lapsGap ?? 0) < 0 ? 'down' : 'up'}${c.otherClass ? ' other' : ''}`}>
          #{c.number}
        </span>
      ))}
    </span>
  );
  return (
    <div className={`duel-gap ${side}`}>
      <span className={`gap-tile big ${cls}`}>{gapText(car.gap, car.lapsGap)}</span>
      <div className="duel-bar"><div className={`duel-bar-fill ${cls}`} style={{ width: `${fill * 100}%` }} /></div>
      <div className="duel-info">
        {side === 'ahead' && chipList}
        <span className={`duel-outlook ${view ? tone(view.kind, side) : ''}`}>{view ? outlookText(view, side) : ''}</span>
        {side === 'behind' && chipList}
      </div>
    </div>
  );
}

/** Getting closer to the car in front is good, the car behind getting closer is not. */
function tone(kind: string, side: Side) {
  if (kind === 'steady') return 'steady';
  const closer = kind === 'close' || kind === 'closing';
  return closer === (side === 'ahead') ? 'good' : 'bad';
}

function outlookText(v: NonNullable<ReturnType<typeof outlook>>, side: Side) {
  switch (v.kind) {
    case 'close': return t(`duel.close.${side}`);
    case 'closing': return t(`duel.closing.${side}`, { n: v.laps });
    case 'steady': return t('duel.steady');
    case 'opening': return t(`duel.opening.${side}`);
  }
}

/** "Marco Rossi" -> "M. Rossi"; single names stay. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0]![0]}. ${parts[parts.length - 1]}`;
}

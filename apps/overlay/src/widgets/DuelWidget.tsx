import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import type { DuelOptions } from '../feed.ts';
import { Flag, gapClass, gapText, lapDelta } from './gaps.tsx';

type Side = 'behind' | 'ahead';
/** Where in the line: everything faces our position in the middle. */
type At = 'left' | 'right';

/** Gap at which the closeness bar is empty; it fills up as the neighbour gets closer. */
const BAR_FULL_RANGE = 3;

/**
 * One line: class neighbour in front, to overtake (left) – gap – our position – gap –
 * class neighbour behind (right). Under each gap a bar that fills as the neighbour gets
 * closer and the last-lap difference (as "Δ lap" in the Position panel; replaced the gap
 * outlook on 09.10.2026 – it changed too often to help). Optionally the cars on
 * another lap physically between us and them as small chips (number only): blue = we are
 * lapping them, red = they are lapping us, outlined = other class.
 * Practice/qualifying: see BestDuel.
 */
export function DuelWidget({ standings, options }: { standings: Standings | null; options?: DuelOptions | null }) {
  const rows = standings?.rows ?? [];
  const best = standings?.mode === 'best';
  const team = rows.find((r) => r.isTeam);
  const front = team ? rows.find((r) => r.pos === team.pos - 1) : undefined;
  const back = team ? rows.find((r) => r.pos === team.pos + 1) : undefined;
  const traffic = options?.traffic === false || best ? null : standings?.between;

  if (!team) return <div className="panel duel-panel"><div className="label">{t('st.noData')}</div></div>;
  if (best) return <BestDuel team={team} front={front} projection={standings?.projection} />;
  return (
    <div className="panel duel-panel">
      {front ? <Rival car={front} side="ahead" at="left" /> : <div className="duel-edge">{t('duel.leader')}</div>}
      {/* Chips nearest to us next to our position. */}
      <Gap at="left" car={front} team={team} chips={[...(traffic?.ahead ?? [])].reverse()} />
      <div className="duel-us">P{team.pos}</div>
      <Gap at="right" car={back} team={team} chips={traffic?.behind ?? []} />
      {back ? <Rival car={back} side="behind" at="right" /> : <div className="duel-edge">{t('duel.last')}</div>}
    </div>
  );
}

/**
 * Practice/qualifying, same size as the race line: our position (large), the position the lap
 * in progress would give us (only if better), the next car to beat from there and the time
 * still to find on it – what we gained or lost so far in this lap included.
 */
function BestDuel({ team, front, projection }: { team: StandingRow; front: StandingRow | undefined; projection: Standings['projection'] }) {
  // Older recorders send no projection: our best against the car in front.
  const p = projection ?? {
    lapTime: null, pos: team.pos, target: team.bestLap != null ? front ?? null : null,
    needed: team.bestLap != null && front?.bestLap != null ? team.bestLap - front.bestLap : null,
  };
  const needed = p.target && p.needed !== null ? Math.max(0, p.needed) : null;
  const cls = needed === null ? 'far' : needed < 0.2 ? 'attack' : needed < 1 ? 'near' : 'far';
  return (
    <div className="panel duel-panel duel-best">
      <div className="duel-us big">P{team.pos}</div>
      {/* Always there (fixed width), so the name doesn't move when the projection changes. */}
      <div className="duel-new">{p.pos < team.pos ? `→ P${p.pos}` : ''}</div>
      {p.target ? (
        <Rival car={p.target} side="ahead" at="right" />
      ) : (
        <div className="duel-edge">{team.bestLap == null && p.lapTime === null ? t('duel.noTime') : t('duel.fastest')}</div>
      )}
      <div className="duel-gap right duel-need">
        {/* Kept invisible without a target, so the panel keeps its height. */}
        <span className={`gap-tile big ${cls}${needed === null ? ' spacer' : ''}`}>{needed?.toFixed(3) ?? '–'}</span>
        <div className="duel-bar spacer" />
        <div className="duel-info">
          {needed !== null && (
            <span className="duel-outlook steady">{t(p.lapTime === null ? 'duel.toFindBest' : 'duel.toFind', { pos: p.target!.pos })}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Class neighbour: flag, number and short name; the arrow (▲ in front, ▼ behind) on the outer side. */
function Rival({ car, side, at }: { car: StandingRow; side: Side; at: At }) {
  const arrow = <span className="duel-arrow">{side === 'ahead' ? '▲' : '▼'}</span>;
  return (
    <div className="duel-rival">
      {at === 'left' && arrow}
      <span className="duel-name">
        <Flag country={car.country} />
        #{car.number} {shortName(car.name)}
      </span>
      {at === 'right' && arrow}
    </div>
  );
}

/** Between us and a neighbour: gap, closeness bar, last-lap difference and the cars on another lap in that stretch. */
function Gap({ at, car, team, chips }: { at: At; car: StandingRow | undefined; team: StandingRow; chips: StandingRow[] }) {
  if (!car) return <div className={`duel-gap ${at}`} />;
  const cls = gapClass(car.gap, car.lapsGap);
  const sameLap = !car.lapsGap && car.gap != null;
  const fill = sameLap ? Math.max(0.04, 1 - Math.abs(car.gap!) / BAR_FULL_RANGE) : 0;
  const delta = lapDelta(team, car);
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
    <div className={`duel-gap ${at}`}>
      <span className={`gap-tile big ${cls}`}>{gapText(car.gap, car.lapsGap)}</span>
      <div className="duel-bar"><div className={`duel-bar-fill ${cls}`} style={{ width: `${fill * 100}%` }} /></div>
      <div className="duel-info">
        {at === 'right' && chipList}
        <span className={`duel-outlook duel-delta ${!delta ? '' : delta.delta > 0 ? 'bad' : delta.delta < 0 ? 'good' : 'steady'}`}>{delta ? t('duel.lapDelta', { d: delta.text }) : ''}</span>
        {at === 'left' && chipList}
      </div>
    </div>
  );
}

/** "Marco Rossi" -> "M. Rossi"; single names stay. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0]![0]}. ${parts[parts.length - 1]}`;
}

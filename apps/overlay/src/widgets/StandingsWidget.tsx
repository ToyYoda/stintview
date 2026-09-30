import type { StandingRow, Standings } from '@stintview/protocol';
import 'flag-icons/css/flag-icons.min.css';
import type { StandingsColumn, StandingsOptions } from '../feed.ts';


const HEAD: [StandingsColumn, string][] = [
  ['pos', 'P'], ['num', '#'], ['flag', ''], ['name', 'Fahrer'], ['gap', 'Abstand'], ['tyre', 'Reifen'], ['delta', 'Δ Runde'],
];

/**
 * Running order on track: P1–P3 and three cars ahead of / behind the team car.
 * Abstand = gap on track in seconds (+ ahead of us, − behind; whole laps as "R").
 * Reifen = tyre age in laps (ours exact, others: laps since their last pit stop).
 * Δ = our last lap minus theirs: red (+) = we were slower, green (−) = we were faster.
 * Lapping: the car right in front of us if we are about to lap it (blue row above ours),
 * the car right behind if it is about to lap us (red row below ours) – any class.
 * Columns can be switched off in the StintView window.
 */
export function StandingsWidget({ standings, options }: { standings: Standings | null; options?: StandingsOptions | null }) {
  const rows = standings?.rows ?? [];
  const ours = rows.find((r) => r.isTeam)?.lastLap ?? null;
  const col = (c: StandingsColumn) => options?.columns[c] ?? true;
  const lapping = options?.lapping === false ? [] : standings?.lapping ?? [];
  const team = rows.find((r) => r.isTeam);
  // Class neighbours: the cars directly in front of and behind us in the running order.
  const front = team ? rows.find((r) => r.pos === team.pos - 1) : undefined;
  const back = team ? rows.find((r) => r.pos === team.pos + 1) : undefined;
  const near = (r: StandingRow) => r.isTeam || r === front || r === back;
  const backmarker = lapping.find((r) => r.lap === 'backmarker');
  const lapper = lapping.find((r) => r.lap === 'lapper');
  // Our row with the lapping cars around it; `gap` marks a jump in positions.
  const list: { r: StandingRow; gap: boolean }[] = [];
  rows.forEach((r, i) => {
    if (r.isTeam && backmarker) list.push({ r: backmarker, gap: false });
    list.push({ r, gap: i > 0 && r.pos !== rows[i - 1]!.pos + 1 });
    if (r.isTeam && lapper) list.push({ r: lapper, gap: false });
  });

  return (
    <div className="panel standings">
      <div className="title">
        Position
        {col('tyre') && <span className="hint">Reifen = Runden seit Boxenstopp</span>}
      </div>
      {options?.duel !== false && team && (front || back) && (
        <div className="st-duel">
          <Duel car={front} arrow="▲" />
          <Duel car={back} arrow="▼" />
        </div>
      )}
      {rows.length === 0 ? (
        <div className="label">Noch keine Daten</div>
      ) : (
        <table>
          <thead>
            <tr>{HEAD.filter(([c]) => col(c)).map(([c, label]) => <th key={c} className={`th-${c}`}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {list.map(({ r, gap }) => {
              // Lap times of another class don't compare.
              const raw = !r.isTeam && !r.otherClass && ours !== null && r.lastLap !== null ? ours - r.lastLap : null;
              // Same lap time (to the hundredth) is neither slower nor faster.
              const delta = raw !== null && Math.abs(raw) < 0.005 ? 0 : raw;
              const cls = [r.isTeam ? 'team' : '', gap ? 'gap' : '', r.lap ? `lap-${r.lap}` : '', near(r) ? 'near' : ''].join(' ');
              return (
                <tr key={`${r.lap ?? 'row'}-${r.carIdx}`} className={cls}>
                  {col('pos') && <td className="st-pos">{r.lap ? '' : r.pos}</td>}
                  {col('num') && <td className="st-num">#{r.number}</td>}
                  {col('flag') && <td className="st-flag-cell">{r.country && /^[a-z]{2}(-[a-z]{3})?$/.test(r.country) && <span className={`fi fi-${r.country} st-flag`} />}</td>}
                  {col('name') && (
                    <td className="st-name">
                      {r.name}
                      {r.lap && <span className="st-lap-tag">{r.lap === 'backmarker' ? 'Nachzügler' : 'Überrunder'}</span>}
                    </td>
                  )}
                  {col('gap') && (
                    <td className="st-gap">
                      {!r.isTeam && (
                        <span className={`gap-tile ${r.lap ? '' : gapClass(r.gap, r.lapsGap)}`}>
                          {r.lap ? gapText(r.gap, 0) : gapText(r.gap, r.lapsGap)}
                        </span>
                      )}
                    </td>
                  )}
                  {col('tyre') && <td className="st-tyre">{r.inPit ? 'Box' : r.tyreLaps ?? '–'}</td>}
                  {col('delta') && (
                    <td className={delta === null || delta === 0 || r.lap ? 'st-delta' : delta > 0 ? 'st-delta slower' : 'st-delta faster'}>
                      {delta === null ? (r.isTeam && ours !== null ? lapTime(ours) : '') : delta === 0 ? '0.00' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Big line above the table: the class neighbour in front (▲) or behind (▼) and the gap to it. */
function Duel({ car, arrow }: { car: StandingRow | undefined; arrow: string }) {
  if (!car) return <div className="duel empty" />;
  return (
    <div className="duel">
      <span className="duel-arrow">{arrow}</span>
      <span className="duel-name">
        {car.country && /^[a-z]{2}(-[a-z]{3})?$/.test(car.country) && <span className={`fi fi-${car.country} st-flag`} />}
        #{car.number} {car.name}
      </span>
      <span className={`gap-tile big ${gapClass(car.gap, car.lapsGap)}`}>{gapText(car.gap, car.lapsGap)}</span>
    </div>
  );
}

/** Within 1 s: attack (ahead, amber) / defend (behind, red); 1–3 s normal; further away dimmed; other lap blue. */
function gapClass(gap: number | null | undefined, laps: number | undefined) {
  if (laps) return 'lap';
  if (gap == null) return '';
  const a = Math.abs(gap);
  if (a < 1) return gap >= 0 ? 'attack' : 'defend';
  return a < 3 ? 'near' : 'far';
}

function gapText(gap: number | null | undefined, laps: number | undefined) {
  if (laps) return `${laps > 0 ? '+' : '−'}${Math.abs(laps)} R`;
  if (gap == null) return '–';
  return `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}`;
}

function lapTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

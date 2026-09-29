import type { Standings } from '@stintview/protocol';

/**
 * Running order on track: P1–P3 and three cars ahead of / behind the team car.
 * Abstand = gap on track in seconds (+ ahead of us, − behind; whole laps as "R").
 * Reifen = tyre age in laps (ours exact, others: laps since their last pit stop).
 * Δ = our last lap minus theirs: red (+) = we were slower, green (−) = we were faster.
 */
export function StandingsWidget({ standings }: { standings: Standings | null }) {
  const rows = standings?.rows ?? [];
  const ours = rows.find((r) => r.isTeam)?.lastLap ?? null;

  return (
    <div className="panel standings">
      <div className="title">
        Position
        <span className="hint">Reifen = Runden seit Boxenstopp</span>
      </div>
      {rows.length === 0 ? (
        <div className="label">Noch keine Daten</div>
      ) : (
        <table>
          <thead>
            <tr><th>P</th><th>#</th><th>Fahrer</th><th>Abstand</th><th>Reifen</th><th>Δ Runde</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const gap = i > 0 && r.pos !== rows[i - 1]!.pos + 1;
              const raw = !r.isTeam && ours !== null && r.lastLap !== null ? ours - r.lastLap : null;
              // Same lap time (to the hundredth) is neither slower nor faster.
              const delta = raw !== null && Math.abs(raw) < 0.005 ? 0 : raw;
              return (
                <tr key={r.carIdx} className={[r.isTeam ? 'team' : '', gap ? 'gap' : ''].join(' ')}>
                  <td className="st-pos">{r.pos}</td>
                  <td className="st-num">#{r.number}</td>
                  <td className="st-name">{r.name}</td>
                  <td className={r.isTeam ? 'st-gap' : `st-gap ${gapClass(r.gap, r.lapsGap)}`}>{r.isTeam ? '' : gapText(r.gap, r.lapsGap)}</td>
                  <td className="st-tyre">{r.inPit ? 'Box' : r.tyreLaps ?? '–'}</td>
                  <td className={delta === null || delta === 0 ? 'st-delta' : delta > 0 ? 'st-delta slower' : 'st-delta faster'}>
                    {delta === null ? (r.isTeam && ours !== null ? lapTime(ours) : '') : delta === 0 ? '0.00' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
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

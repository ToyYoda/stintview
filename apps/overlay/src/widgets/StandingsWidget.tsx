import type { Standings } from '@stintview/protocol';

/**
 * Running order on track: P1–P3 and three cars ahead of / behind the team car.
 * Δ = our last lap minus theirs: red (+) = we were slower, green (−) = we were faster.
 */
export function StandingsWidget({ standings }: { standings: Standings | null }) {
  const rows = standings?.rows ?? [];
  const ours = rows.find((r) => r.isTeam)?.lastLap ?? null;

  return (
    <div className="panel standings">
      <div className="title">
        Position
        <span className="hint">Δ = unsere letzte Runde − seine</span>
      </div>
      {rows.length === 0 ? (
        <div className="label">Noch keine Daten</div>
      ) : (
        <table>
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

function lapTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

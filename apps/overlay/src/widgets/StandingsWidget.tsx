import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import { Duel, Flag, gapClass, gapText } from './gaps.tsx';
import type { StandingsColumn, StandingsOptions } from '../feed.ts';


const HEAD: StandingsColumn[] = ['pos', 'num', 'flag', 'name', 'best', 'gap', 'tyre', 'delta'];

/**
 * Running order on track: P1–P3 and three cars ahead of / behind the team car.
 * Abstand = gap on track in seconds (+ ahead of us, − behind; whole laps as "R").
 * Reifen = tyre age in laps (ours exact, others: laps since their last pit stop).
 * Δ = our last lap minus theirs: red (+) = we were slower, green (−) = we were faster.
 * Lapping: the car right in front of us if we are about to lap it (blue row above ours),
 * the car right behind if it is about to lap us (red row below ours) – any class.
 * Practice/qualifying: iRacing's official ranking (best valid lap) with the best lap instead of
 * gap and tyres, Δ = our best minus theirs; no duel line, no lapping rows.
 * Columns can be switched off in the StintView window.
 */
export function StandingsWidget({ standings, options }: { standings: Standings | null; options?: StandingsOptions | null }) {
  const rows = standings?.rows ?? [];
  const best = standings?.mode === 'best';
  // Δ compares last laps in the race, best laps in practice/qualifying.
  const ours = (best ? rows.find((r) => r.isTeam)?.bestLap : rows.find((r) => r.isTeam)?.lastLap) ?? null;
  // Best lap only outside races; gap and tyre age only in races.
  const col = (c: StandingsColumn) => (best ? c !== 'gap' && c !== 'tyre' : c !== 'best') && (options?.columns[c] ?? true);
  const lapping = options?.lapping === false || best ? [] : standings?.lapping ?? [];
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
        {best ? t('st.bestTitle', { session: t(`st.session.${standings?.session ?? 'Training'}`) }) : t('st.title')}
        {best ? col('delta') && <span className="hint">{t('st.bestHint')}</span> : col('tyre') && <span className="hint">{t('st.tyreHint')}</span>}
      </div>
      {!best && options?.duel !== false && team && (front || back) && (
        <div className="st-duel">
          <Duel car={front} arrow="▲" />
          <Duel car={back} arrow="▼" />
        </div>
      )}
      {rows.length === 0 ? (
        <div className="label">{t('st.noData')}</div>
      ) : (
        <table>
          <thead>
            <tr>{HEAD.filter((c) => col(c)).map((c) => <th key={c} className={`th-${c}`}>{t(`st.col.${c}`)}</th>)}</tr>
          </thead>
          <tbody>
            {list.map(({ r, gap }) => {
              // Lap times of another class don't compare.
              const theirs = best ? r.bestLap ?? null : r.lastLap;
              const raw = !r.isTeam && !r.otherClass && ours !== null && theirs !== null ? ours - theirs : null;
              // Same lap time (to the hundredth / thousandth) is neither slower nor faster.
              const delta = raw !== null && Math.abs(raw) < (best ? 0.0005 : 0.005) ? 0 : raw;
              const digits = best ? 3 : 2;
              const cls = [r.isTeam ? 'team' : '', gap ? 'gap' : '', r.lap ? `lap-${r.lap}` : '', near(r) ? 'near' : ''].join(' ');
              return (
                <tr key={`${r.lap ?? 'row'}-${r.carIdx}`} className={cls}>
                  {col('pos') && <td className="st-pos">{r.lap ? '' : r.pos}</td>}
                  {col('num') && <td className="st-num">#{r.number}</td>}
                  {col('flag') && <td className="st-flag-cell"><Flag country={r.country} /></td>}
                  {col('name') && (
                    <td className="st-name">
                      {r.name}
                      {r.lap && <span className="st-lap-tag">{r.lap === 'backmarker' ? t('st.backmarker') : t('st.lapper')}</span>}
                    </td>
                  )}
                  {col('best') && <td className="st-best">{r.bestLap ? lapTime(r.bestLap) : '–'}</td>}
                  {col('gap') && (
                    <td className="st-gap">
                      {!r.isTeam && (
                        <span className={`gap-tile ${r.lap ? '' : gapClass(r.gap, r.lapsGap)}`}>
                          {r.lap ? gapText(r.gap, 0) : gapText(r.gap, r.lapsGap)}
                        </span>
                      )}
                    </td>
                  )}
                  {col('tyre') && <td className="st-tyre">{r.inPit ? t('st.box') : r.tyreLaps ?? '–'}</td>}
                  {col('delta') && (
                    <td className={delta === null || delta === 0 || r.lap ? 'st-delta' : delta > 0 ? 'st-delta slower' : 'st-delta faster'}>
                      {delta === null
                        ? (r.isTeam && !best && ours !== null ? lapTime(ours) : '')
                        : delta === 0 ? (0).toFixed(digits) : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(digits)}`}
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

function lapTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

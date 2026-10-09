import type { ReactNode } from 'react';
import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import { Duel, Flag, gapClass, gapText } from './gaps.tsx';
import { CarMake } from './carMake.tsx';
import type { StandingsColumn, StandingsOptions } from '../feed.ts';


/** Default column order; the StintView window can change it (options.order). */
export const STANDINGS_COLUMNS: StandingsColumn[] = ['pos', 'num', 'flag', 'make', 'name', 'irating', 'sr', 'best', 'gap', 'tyre', 'compound', 'delta'];

/**
 * Running order on track: P1–P3 and three cars ahead of / behind the team car.
 * Abstand = gap on track in seconds (+ ahead of us, − behind; whole laps as "R").
 * Stint = tyre age in laps (ours exact, others: laps since their last pit stop).
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
  // Chosen order; columns missing from it (newer versions) keep their default place at the end.
  const order = [...(options?.order ?? []), ...STANDINGS_COLUMNS].filter((c, i, a) => STANDINGS_COLUMNS.includes(c) && a.indexOf(c) === i);
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
            <tr>{order.filter((c) => col(c)).map((c) => <th key={c} className={`th-${c}`}>{t(`st.col.${c}`)}</th>)}</tr>
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
              const cells: Record<StandingsColumn, ReactNode> = {
                pos: <td key="pos" className="st-pos">{r.lap ? '' : r.pos}</td>,
                num: <td key="num" className="st-num">#{r.number}</td>,
                flag: <td key="flag" className="st-flag-cell"><Flag country={r.country} /></td>,
                make: <td key="make" className="st-make">{r.car ? <CarMake car={r.car} /> : ''}</td>,
                name: (
                  <td key="name" className="st-name">
                    {r.name}
                    {r.lap && <span className="st-lap-tag">{r.lap === 'backmarker' ? t('st.backmarker') : t('st.lapper')}</span>}
                  </td>
                ),
                irating: <td key="irating" className="st-ir">{rating(r.irating)}</td>,
                sr: <td key="sr" className="st-sr">{r.license ? <License {...r.license} /> : '–'}</td>,
                best: <td key="best" className="st-best">{r.bestLap ? lapTime(r.bestLap) : '–'}</td>,
                gap: (
                  <td key="gap" className="st-gap">
                    {!r.isTeam && (
                      <span className={`gap-tile ${r.lap ? '' : gapClass(r.gap, r.lapsGap)}`}>
                        {r.lap ? gapText(r.gap, 0) : gapText(r.gap, r.lapsGap)}
                      </span>
                    )}
                  </td>
                ),
                tyre: <td key="tyre" className="st-tyre">{r.inPit ? t('st.box') : r.tyreLaps ?? '–'}</td>,
                compound: <td key="compound" className="st-compound">{r.compound ? <Compound name={r.compound} /> : '–'}</td>,
                delta: (
                  <td key="delta" className={delta === null || delta === 0 || r.lap ? 'st-delta' : delta > 0 ? 'st-delta slower' : 'st-delta faster'}>
                    {delta === null
                      ? (r.isTeam && !best && ours !== null ? lapTime(ours) : '')
                      : delta === 0 ? (0).toFixed(digits) : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(digits)}`}
                  </td>
                ),
              };
              return (
                <tr key={`${r.lap ?? 'row'}-${r.carIdx}`} className={cls}>
                  {order.filter((c) => col(c)).map((c) => cells[c])}
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

/** iRating compact: 2431 -> "2.4k". */
function rating(ir: number | null | undefined) {
  if (!ir) return '–';
  return ir >= 1000 ? `${(ir / 1000).toFixed(1)}k` : String(ir);
}

/** Licence class and safety rating ("A 3.45") on iRacing's licence colour. */
function License({ text, color }: { text: string; color: string }) {
  const n = parseInt(color.slice(1), 16);
  const light = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
  return <span className="st-lic" style={{ background: color, color: light ? '#111' : '#fff' }}>{text}</span>;
}

/** Tyre compound as one letter in its usual colour: Soft red, Medium yellow, Hard white, Wet blue. */
function Compound({ name }: { name: string }) {
  const kind = /wet|rain/i.test(name) ? 'wet' : /soft/i.test(name) ? 'soft' : /medium/i.test(name) ? 'medium' : /hard/i.test(name) ? 'hard' : 'other';
  const letter = { wet: 'W', soft: 'S', medium: 'M', hard: 'H', other: name.slice(0, 1).toUpperCase() }[kind];
  return <span className={`st-compound-chip ${kind}`} title={name}>{letter}</span>;
}

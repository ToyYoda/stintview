import type { ReactNode } from 'react';
import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import { Flag } from './gaps.tsx';
import { CarMake } from './carMake.tsx';
import { License, rating, SessionClock } from './StandingsWidget.tsx';
import type { ColumnOptions, RelativeColumn } from '../feed.ts';

/** Default column order; the StintView window can change it and switch columns off. */
export const RELATIVE_COLUMNS: RelativeColumn[] = ['class', 'pos', 'num', 'make', 'flag', 'team', 'name', 'irating', 'sr', 'gap'];

/** Chosen order; columns missing from it (newer versions) keep their default place at the end. */
export function columnOrder<C extends string>(all: C[], options?: ColumnOptions<C> | null): C[] {
  return [...(options?.order ?? []), ...all].filter((c, i, a) => all.includes(c) && a.indexOf(c) === i);
}

/**
 * Relative: the 5 cars nearest in front of and behind us on track, any class, front first.
 * A narrow bar in the class colour starts each row; a lap or more down on us = blue row,
 * a lap or more up = red row. Gap on track in seconds, bold: in front green, behind red.
 * Team column only in team races (as in the Position panel). Columns can be switched off and
 * moved in the StintView window.
 */
export function RelativeWidget({ standings, options }: { standings: Standings | null; options?: ColumnOptions<RelativeColumn> | null }) {
  const rows = standings?.relative ?? [];
  const teamRace = rows.some((r) => r.team);
  const cols = columnOrder(RELATIVE_COLUMNS, options).filter((c) => (options?.columns[c] ?? true) && (c !== 'team' || teamRace));
  return (
    <div className="panel standings relative">
      <div className="title">{t('rel.title')}</div>
      {rows.length === 0 ? (
        <div className="label">{t('st.noData')}</div>
      ) : (
        <table>
          <tbody>
            {rows.map((r) => {
              const cells: Record<RelativeColumn, ReactNode> = {
                class: <ClassBar key="class" color={r.classColor} />,
                pos: <td key="pos" className="st-pos">{r.pos || ''}</td>,
                num: <td key="num" className="st-num">#{r.number}</td>,
                make: <td key="make" className="st-make">{r.car ? <CarMake car={r.car} /> : ''}</td>,
                flag: <td key="flag" className="st-flag-cell"><Flag country={r.country} /></td>,
                team: <td key="team" className="st-team">{r.team ?? ''}</td>,
                name: (
                  <td key="name" className="st-name">
                    {r.name}
                    {r.inPit && <span className="st-lap-tag">{t('st.box')}</span>}
                  </td>
                ),
                irating: <td key="irating" className="st-ir">{rating(r.irating)}</td>,
                sr: <td key="sr" className="st-sr">{r.license ? <License {...r.license} /> : '–'}</td>,
                gap: <td key="gap" className={`rel-gap ${relClass(r)}`}>{r.isTeam ? '' : relGap(r.gap)}</td>,
              };
              return (
                <tr key={r.carIdx} className={[r.isTeam ? 'team' : '', r.lap ? `lap-${r.lap}` : ''].join(' ')}>
                  {cols.map((c) => cells[c])}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <SessionClock clock={standings?.clock} />
    </div>
  );
}

/** Narrow vertical bar in the class colour at the start of a row. */
export function ClassBar({ color }: { color?: string | null }) {
  return <td className="class-bar"><span style={{ background: color ?? 'transparent' }} /></td>;
}

const relClass = (r: StandingRow) => (r.isTeam || r.gap == null ? '' : r.gap > 0 ? 'ahead' : 'behind');

function relGap(gap: number | null | undefined) {
  if (gap == null) return '–';
  return `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${Math.abs(gap).toFixed(1)}`;
}

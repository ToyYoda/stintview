import type { StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import { Flag } from './gaps.tsx';
import { CarMake } from './carMake.tsx';
import { License, rating } from './StandingsWidget.tsx';

/**
 * Relative: the 5 cars nearest in front of and behind us on track, any class, front first.
 * A narrow bar in the class colour starts each row; a lap or more down on us = blue row,
 * a lap or more up = red row. Gap on track in seconds, bold: in front green, behind red.
 * Team column only in team races (as in the Position panel).
 */
export function RelativeWidget({ standings }: { standings: Standings | null }) {
  const rows = standings?.relative ?? [];
  const teamRace = rows.some((r) => r.team);
  return (
    <div className="panel standings relative">
      <div className="title">{t('rel.title')}</div>
      {rows.length === 0 ? (
        <div className="label">{t('st.noData')}</div>
      ) : (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.carIdx} className={[r.isTeam ? 'team' : '', r.lap ? `lap-${r.lap}` : ''].join(' ')}>
                <ClassBar color={r.classColor} />
                <td className="st-pos">{r.pos || ''}</td>
                <td className="st-num">#{r.number}</td>
                <td className="st-make">{r.car ? <CarMake car={r.car} /> : ''}</td>
                <td className="st-flag-cell"><Flag country={r.country} /></td>
                {teamRace && <td className="st-team">{r.team ?? ''}</td>}
                <td className="st-name">
                  {r.name}
                  {r.inPit && <span className="st-lap-tag">{t('st.box')}</span>}
                </td>
                <td className="st-ir">{rating(r.irating)}</td>
                <td className="st-sr">{r.license ? <License {...r.license} /> : '–'}</td>
                <td className={`rel-gap ${relClass(r)}`}>{r.isTeam ? '' : relGap(r.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

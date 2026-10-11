import type { ReactNode } from 'react';
import type { ClassStandings, StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import { Flag } from './gaps.tsx';
import { CarMake } from './carMake.tsx';
import { ClassBar, columnOrder } from './RelativeWidget.tsx';
import { Compound, lapTime, License, rating } from './StandingsWidget.tsx';
import type { ClassesColumn, ColumnOptions } from '../feed.ts';

/** Default column order; the StintView window can change it and switch columns off. */
export const CLASSES_COLUMNS: ClassesColumn[] = ['pos', 'class', 'gap', 'num', 'make', 'team', 'flag', 'name', 'irating', 'sr', 'fastest', 'last', 'tyre', 'compound'];

/** Column headings (empty for the narrow ones). */
const HEAD: Record<ClassesColumn, string> = {
  pos: 'st.col.pos', class: '', gap: 'cls.col.gap', num: 'st.col.num', make: '', team: 'st.col.team', flag: '',
  name: 'st.col.name', irating: 'st.col.irating', sr: 'st.col.sr', fastest: 'cls.col.fastest', last: 'cls.col.last',
  tyre: 'st.col.tyre', compound: 'st.col.compound',
};

/**
 * Standings by class (fastest class first): P1–P3 of every class, in ours also the cars around
 * us. Gap = behind the class leader (seconds on the same lap, else laps). Fastest lap purple
 * when it is the class's best, last lap green when it is that driver's best. Stint = laps
 * since the last pit stop. Practice/qualifying: by best lap, gap = best − the leader's best.
 * Team column only in team races. Columns can be switched off and moved in the StintView window.
 */
export function ClassStandingsWidget({ standings, options }: { standings: Standings | null; options?: ColumnOptions<ClassesColumn> | null }) {
  const classes = standings?.classes ?? [];
  const best = standings?.mode === 'best';
  const teamRace = classes.some((c) => c.rows.some((r) => r.team));
  // Stint only in races; team only in team races.
  const cols = columnOrder(CLASSES_COLUMNS, options)
    .filter((c) => (options?.columns[c] ?? true) && (c !== 'team' || teamRace) && (c !== 'tyre' || !best));
  return (
    <div className="panel standings classes">
      <div className="title">
        {best ? t('cls.bestTitle', { session: t(`st.session.${standings?.session ?? 'Training'}`) }) : t('cls.title')}
        {cols.includes('tyre') && <span className="hint">{t('st.tyreHint')}</span>}
      </div>
      {classes.length === 0 ? (
        <div className="label">{t('st.noData')}</div>
      ) : (
        // One table for all classes, so the columns line up.
        <table>
          {classes.map((c) => <ClassRows key={c.classId} cls={c} best={best} cols={cols} />)}
        </table>
      )}
    </div>
  );
}

function ClassRows({ cls, best, cols }: { cls: ClassStandings; best: boolean; cols: ClassesColumn[] }) {
  return (
    <tbody>
      <tr className="cls-head-row">
        <td colSpan={cols.length} style={{ borderColor: cls.color }}>
          <span className="cls-name" style={{ background: cls.color, color: textOn(cls.color) }}>{cls.name}</span>
        </td>
      </tr>
      <tr className="cls-cols">
        {cols.map((c) => <th key={c} className={`th-${c}`}>{HEAD[c] ? t(HEAD[c]) : ''}</th>)}
      </tr>
      {cls.rows.map((r, i) => {
        const cells: Record<ClassesColumn, ReactNode> = {
          pos: <td key="pos" className="st-pos">{r.pos}</td>,
          class: <ClassBar key="class" color={r.classColor ?? cls.color} />,
          gap: <td key="gap" className="cls-gap">{gapToLeader(r, best)}</td>,
          num: <td key="num" className="st-num">#{r.number}</td>,
          make: <td key="make" className="st-make">{r.car ? <CarMake car={r.car} /> : ''}</td>,
          team: <td key="team" className="st-team">{r.team ?? ''}</td>,
          flag: <td key="flag" className="st-flag-cell"><Flag country={r.country} /></td>,
          name: (
            <td key="name" className="st-name">
              {r.name}
              {r.inPit && <span className="st-lap-tag">{t('st.box')}</span>}
            </td>
          ),
          irating: <td key="irating" className="st-ir">{rating(r.irating)}</td>,
          sr: <td key="sr" className="st-sr">{r.license ? <License {...r.license} /> : '–'}</td>,
          fastest: <td key="fastest" className={`cls-lap${r.bestLap && r.bestLap === cls.best ? ' class-best' : ''}`}>{r.bestLap ? lapTime(r.bestLap) : '–'}</td>,
          last: <td key="last" className={`cls-lap${r.lastLap && r.lastLap === r.bestLap ? ' personal-best' : ''}`}>{r.lastLap ? lapTime(r.lastLap) : '–'}</td>,
          tyre: <td key="tyre" className="st-tyre">{r.inPit ? t('st.box') : r.tyreLaps ?? '–'}</td>,
          compound: <td key="compound" className="st-compound">{r.compound ? <Compound name={r.compound} /> : '–'}</td>,
        };
        return (
          <tr key={r.carIdx} className={[r.isTeam ? 'team' : '', i > 0 && r.pos !== cls.rows[i - 1]!.pos + 1 ? 'gap' : ''].join(' ')}>
            {cols.map((c) => cells[c])}
          </tr>
        );
      })}
    </tbody>
  );
}

/** Leader 0.0; same lap: seconds behind; else laps behind ("+2 L"). Qualifying: three decimals. */
function gapToLeader(r: StandingRow, best: boolean) {
  if (r.lapsGap && r.lapsGap < 0) return `+${t('st.laps', { n: -r.lapsGap })}`;
  if (r.gap == null) return '–';
  return Math.max(0, r.gap).toFixed(best ? 3 : 1);
}

/** Dark text on light class colours, white on dark ones. */
function textOn(color: string) {
  const n = parseInt(color.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150 ? '#111' : '#fff';
}

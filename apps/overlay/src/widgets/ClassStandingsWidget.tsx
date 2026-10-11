import type { ClassStandings, StandingRow, Standings } from '@stintview/protocol';
import { t } from '../i18n.ts';
import { Flag } from './gaps.tsx';
import { CarMake } from './carMake.tsx';
import { ClassBar } from './RelativeWidget.tsx';
import { Compound, lapTime, License, rating } from './StandingsWidget.tsx';

/**
 * Standings by class (fastest class first): P1–P3 of every class, in ours also the cars around
 * us. Gap = behind the class leader (seconds on the same lap, else laps). Fastest lap purple
 * when it is the class's best, last lap green when it is that driver's best. Stint = laps
 * since the last pit stop. Practice/qualifying: by best lap, gap = best − the leader's best.
 * Team column only in team races.
 */
export function ClassStandingsWidget({ standings }: { standings: Standings | null }) {
  const classes = standings?.classes ?? [];
  const best = standings?.mode === 'best';
  const teamRace = classes.some((c) => c.rows.some((r) => r.team));
  return (
    <div className="panel standings classes">
      <div className="title">
        {best ? t('cls.bestTitle', { session: t(`st.session.${standings?.session ?? 'Training'}`) }) : t('cls.title')}
        {!best && <span className="hint">{t('st.tyreHint')}</span>}
      </div>
      {classes.length === 0 ? (
        <div className="label">{t('st.noData')}</div>
      ) : (
        // One table for all classes, so the columns line up.
        <table>
          {classes.map((c) => <ClassRows key={c.classId} cls={c} best={best} teamRace={teamRace} />)}
        </table>
      )}
    </div>
  );
}

function ClassRows({ cls, best, teamRace }: { cls: ClassStandings; best: boolean; teamRace: boolean }) {
  const cols = 12 + (teamRace ? 1 : 0) + (best ? 0 : 1);
  return (
    <tbody>
      <tr className="cls-head-row">
        <td colSpan={cols} style={{ borderColor: cls.color }}>
          <span className="cls-name" style={{ background: cls.color, color: textOn(cls.color) }}>{cls.name}</span>
        </td>
      </tr>
      <tr className="cls-cols">
        <th className="th-pos">{t('st.col.pos')}</th><th />
        <th className="th-gap">{t('cls.col.gap')}</th>
        <th className="th-num">{t('st.col.num')}</th><th /><th />
        {teamRace && <th className="th-team">{t('st.col.team')}</th>}
        <th className="th-name">{t('st.col.name')}</th>
        <th>{t('st.col.irating')}</th><th className="th-sr">{t('st.col.sr')}</th>
        <th>{t('cls.col.fastest')}</th><th>{t('cls.col.last')}</th>
        {!best && <th>{t('st.col.tyre')}</th>}
        <th className="th-compound">{t('st.col.compound')}</th>
      </tr>
      {cls.rows.map((r, i) => (
        <tr key={r.carIdx} className={[r.isTeam ? 'team' : '', i > 0 && r.pos !== cls.rows[i - 1]!.pos + 1 ? 'gap' : ''].join(' ')}>
          <td className="st-pos">{r.pos}</td>
          <ClassBar color={r.classColor ?? cls.color} />
          <td className="cls-gap">{gapToLeader(r, best)}</td>
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
          <td className={`cls-lap${r.bestLap && r.bestLap === cls.best ? ' class-best' : ''}`}>{r.bestLap ? lapTime(r.bestLap) : '–'}</td>
          <td className={`cls-lap${r.lastLap && r.lastLap === r.bestLap ? ' personal-best' : ''}`}>{r.lastLap ? lapTime(r.lastLap) : '–'}</td>
          {!best && <td className="st-tyre">{r.inPit ? t('st.box') : r.tyreLaps ?? '–'}</td>}
          <td className="st-compound">{r.compound ? <Compound name={r.compound} /> : '–'}</td>
        </tr>
      ))}
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

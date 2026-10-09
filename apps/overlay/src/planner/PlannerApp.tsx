import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  autoPlan, available, evaluatePlan, mergeIntervals, planContext,
  type DriverStats, type Interval, type IssueCode, type Participant, type PlanStint, type Race,
} from '@stintview/planner';
import { brand } from '../brand.ts';
import { getLang, setLang, t, useLang, type Lang } from '../i18n.ts';
import logoUrl from '../assets/logo-light.webp';
import wordmarkUrl from '../assets/wordmark-light.webp';
import { api, AuthError, login, logout, type Overview, type RaceDetail, type RaceSettings } from './api.ts';

const LANG_KEY = 'stintview.planner.lang';
const POLL_MS = 20_000;

// ---------------------------------------------------------------------------
// Formatting (local time zone of the browser)
// ---------------------------------------------------------------------------

const locale = () => (getLang() === 'de' ? 'de-DE' : 'en-GB');
const fmtDateTime = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
/** 1:58.577 */
const fmtLap = (s: number | null | undefined) => {
  if (!s) return '–';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};
/** 1:05 h */
const fmtDur = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
};
const fmtNum = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? '–' : x.toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }));
/** Value for <input type="datetime-local"> in local time. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const parseNum = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() && Number.isFinite(n) ? n : null;
};
/** "1:58.5" or "118.5" → seconds */
const parseLap = (v: string) => {
  const m = /^\s*(\d+):(\d+(?:[.,]\d+)?)\s*$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]!.replace(',', '.')) : parseNum(v);
};

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function initialLang(): Lang {
  const fromUrl = new URLSearchParams(location.hash.slice(1)).get('lang');
  let stored: string | null = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch { /* none */ }
  const l = fromUrl ?? stored ?? (navigator.language.startsWith('de') ? 'de' : 'en');
  return l === 'en' ? 'en' : 'de';
}

/** Route in the hash: #r=<race id> or #new. */
function readRoute(): { race: string | null; creating: boolean } {
  const p = new URLSearchParams(location.hash.slice(1));
  return { race: p.get('r'), creating: p.has('new') };
}
function go(route: { race?: string | null; creating?: boolean }) {
  const p = new URLSearchParams();
  if (route.race) p.set('r', route.race);
  if (route.creating) p.set('new', '');
  location.hash = p.toString().replace(/=$/, '');
}

export function PlannerApp() {
  useLang();
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    setLang(initialLang());
    login().then((ok) => setAuth(ok ? 'in' : 'out'), () => setAuth('out'));
    const onHash = () => setRoute(readRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const onError = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      logout();
      setAuth('out');
    } else setError(errorText(e));
  }, []);

  const reload = useCallback(() => api.overview().then(setOverview, onError), [onError]);
  useEffect(() => {
    if (auth !== 'in') return;
    void reload();
    const timer = setInterval(() => { if (!document.hidden) void reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [auth, reload]);

  useEffect(() => {
    document.title = overview ? `${t('pl.title')} · ${overview.teamName}` : t('pl.title');
  });

  const switchLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* not remembered */ }
  };

  return (
    <div className="planner">
      <header className="pl-head">
        {brand === 'backseat' ? (
          <span className="plate" aria-hidden="true"><span>BR</span></span>
        ) : (
          <img className="oe-logo" src={logoUrl} alt="" />
        )}
        <div className="pl-titles">
          {brand === 'backseat'
            ? <div className="wordmark br"><span>BACKSEAT</span><b>RACER</b></div>
            : <img className="oe-wordmark" src={wordmarkUrl} alt="Outcast Endurance" />}
          <div className="product">{t('pl.title')}{overview && <> · {overview.teamName}</>}</div>
        </div>
        <div className="pl-user">
          {overview && <span>{t('pl.loggedInAs', { name: overview.me })}</span>}
          <div className="lang-switch" role="radiogroup" aria-label="Sprache / Language">
            {(['de', 'en'] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={getLang() === l} className={getLang() === l ? 'seg active' : 'seg'} onClick={() => switchLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <p className="pl-error" role="alert">
          {error} <button className="linkish" onClick={() => setError(null)}>{t('pl.dismiss')}</button>
        </p>
      )}

      {auth === 'checking' && <p className="pl-muted">{t('pl.loading')}</p>}
      {auth === 'out' && (
        <section className="card pl-login">
          <h2>{t('pl.loginTitle')}</h2>
          <p>{t('pl.loginText')}</p>
        </section>
      )}
      {auth === 'in' && overview && (
        <div className="pl-main">
          <RaceList overview={overview} selected={route.race} creating={route.creating} />
          <div className="pl-content">
            {route.creating ? (
              <section className="card">
                <h2>{t('pl.newRace')}</h2>
                <RaceForm overview={overview} onCancel={() => go({})} onSave={async (s) => {
                  const d = await api.createRace(s);
                  await reload();
                  go({ race: d.race.id });
                }} />
              </section>
            ) : route.race && overview.races.some((r) => r.id === route.race) ? (
              <RaceView key={route.race} id={route.race} overview={overview} onError={onError} onChanged={reload} />
            ) : (
              <section className="card">
                <h2>{t('pl.welcomeTitle')}</h2>
                <p>{t('pl.welcomeText')}</p>
                <p className="pl-muted">{t('pl.timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RaceList({ overview, selected, creating }: { overview: Overview; selected: string | null; creating: boolean }) {
  const now = Date.now();
  const upcoming = overview.races.filter((r) => r.start + r.duration * 1000 >= now);
  const past = overview.races.filter((r) => r.start + r.duration * 1000 < now).reverse();
  const item = (r: Overview['races'][number]) => {
    const invited = r.invited.includes(overview.me);
    const open = invited && !r.answered.includes(overview.me);
    return (
      <li key={r.id}>
        <a href={`#r=${r.id}`} className={r.id === selected ? 'race-item on' : 'race-item'}>
          <b>{r.name}</b>
          <span>{fmtDateTime(r.start)} · {fmtDur(r.duration * 1000)} h</span>
          <span className="pl-muted">{r.trackName || '–'}</span>
          {open && <span className="tag warn">{t('pl.yourAnswerMissing')}</span>}
          {r.planned && <span className="tag">{t('pl.planned')}</span>}
        </a>
      </li>
    );
  };
  return (
    <nav className="race-list">
      <a className={creating ? 'btn on' : 'btn'} href="#new">{t('pl.newRace')}</a>
      <h3>{t('pl.upcoming')}</h3>
      {upcoming.length ? <ul>{upcoming.map(item)}</ul> : <p className="pl-muted">{t('pl.noRaces')}</p>}
      {past.length > 0 && <><h3>{t('pl.past')}</h3><ul>{past.map(item)}</ul></>}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Race settings (new race / edit)
// ---------------------------------------------------------------------------

function RaceForm({ overview, initial, onSave, onCancel }: {
  overview: Overview; initial?: Race; onSave(s: RaceSettings): Promise<void>; onCancel(): void;
}) {
  const nextSaturday = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    d.setHours(18, 0, 0, 0);
    return d.getTime();
  };
  const comboKey = (track: number | null, car: number | null) => (track !== null && car !== null ? `${track}/${car}` : '');
  const [name, setName] = useState(initial?.name ?? '');
  const [combo, setCombo] = useState(initial ? comboKey(initial.track, initial.car) || 'free' : overview.combos[0] ? comboKey(overview.combos[0].track, overview.combos[0].car) : 'free');
  const [trackName, setTrackName] = useState(initial?.trackName ?? '');
  const [carName, setCarName] = useState(initial?.carName ?? '');
  const [start, setStart] = useState(toLocalInput(initial?.start ?? nextSaturday()));
  const [hours, setHours] = useState(String((initial?.duration ?? 6 * 3600) / 3600).replace('.', getLang() === 'de' ? ',' : '.'));
  const [pitTime, setPitTime] = useState(String(initial?.pitTime ?? 60));
  const [tank, setTank] = useState(initial?.tank ? String(initial.tank) : '');
  const [invited, setInvited] = useState<string[]>(initial?.invited ?? overview.members);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // An old combination of an edited race may have no laps any more: keep it selectable.
  const combos = [...overview.combos];
  if (initial?.track != null && initial.car !== null && !combos.some((c) => c.track === initial.track && c.car === initial.car)) {
    combos.push({ track: initial.track, trackName: initial.trackName, car: initial.car, carName: initial.carName, drivers: 0, laps: 0 });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = combos.find((x) => comboKey(x.track, x.car) === combo);
    const h = parseNum(hours);
    if (!h || h <= 0 || h > 48) return setError(t('pl.badDuration'));
    setBusy(true);
    setError('');
    try {
      await onSave({
        name, start: new Date(start).getTime(), duration: Math.round(h * 3600),
        track: c?.track ?? null, car: c?.car ?? null,
        trackName: c ? c.trackName : trackName, carName: c ? c.carName : carName,
        pitTime: parseNum(pitTime) ?? 60, tank: parseNum(tank), invited,
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form className="pl-form" onSubmit={submit}>
      <label className="field"><span>{t('pl.raceName')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder={t('pl.raceNamePlaceholder')} autoFocus />
      </label>
      <label className="field"><span>{t('pl.trackCar')}</span>
        <select value={combo} onChange={(e) => setCombo(e.target.value)}>
          {combos.map((c) => (
            <option key={comboKey(c.track, c.car)} value={comboKey(c.track, c.car)}>
              {c.trackName} · {c.carName} ({t('pl.comboData', { drivers: c.drivers, laps: c.laps })})
            </option>
          ))}
          <option value="free">{t('pl.comboFree')}</option>
        </select>
        <small>{t('pl.trackCarHint')}</small>
      </label>
      {combo === 'free' && (
        <div className="pl-row">
          <label className="field"><span>{t('pl.track')}</span><input value={trackName} onChange={(e) => setTrackName(e.target.value)} maxLength={120} /></label>
          <label className="field"><span>{t('pl.car')}</span><input value={carName} onChange={(e) => setCarName(e.target.value)} maxLength={120} /></label>
        </div>
      )}
      <div className="pl-row">
        <label className="field"><span>{t('pl.start')}</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label className="field"><span>{t('pl.durationHours')}</span><input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required /></label>
      </div>
      <div className="pl-row">
        <label className="field"><span>{t('pl.pitTime')}</span><input inputMode="decimal" value={pitTime} onChange={(e) => setPitTime(e.target.value)} />
          <small>{t('pl.pitTimeHint')}</small></label>
        <label className="field"><span>{t('pl.tank')}</span><input inputMode="decimal" value={tank} onChange={(e) => setTank(e.target.value)} placeholder={t('pl.fromLaps')} />
          <small>{t('pl.tankHint')}</small></label>
      </div>
      <fieldset className="field">
        <span>{t('pl.invite')}</span>
        <div className="pl-invite">
          {overview.members.map((m) => (
            <label key={m} className="check">
              <input type="checkbox" checked={invited.includes(m)}
                onChange={(e) => setInvited(e.target.checked ? [...invited, m] : invited.filter((x) => x !== m))} />
              <span>{m}</span>
            </label>
          ))}
        </div>
        <small>{t('pl.inviteHint')}</small>
      </fieldset>
      {error && <p className="pl-error">{error}</p>}
      <div className="pl-actions">
        <button className="btn" disabled={busy}>{t('pl.save')}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>{t('pl.cancel')}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One race: settings, participants, availability grid, stint plan
// ---------------------------------------------------------------------------

function RaceView({ id, overview, onError, onChanged }: { id: string; overview: Overview; onError(e: unknown): void; onChanged(): Promise<void> }) {
  const [detail, setDetail] = useState<RaceDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const pending = useRef(0); // saves in flight: don't overwrite local edits with a poll

  const load = useCallback(() => api.race(id).then((d) => { if (!pending.current) setDetail(d); }, onError), [id, onError]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  /** Shows `local` right away and stores it; the server's answer replaces it. */
  const save = useCallback(async (local: Race, request: () => Promise<RaceDetail>) => {
    setDetail((d) => (d ? { ...d, race: local } : d));
    pending.current++;
    try {
      const d = await request();
      pending.current--;
      if (!pending.current) setDetail(d);
    } catch (e) {
      pending.current--;
      onError(e);
      void load();
    }
  }, [load, onError]);

  if (!detail) return <p className="pl-muted">{t('pl.loading')}</p>;
  const { race, stats, canEdit } = detail;

  if (editing) {
    return (
      <section className="card">
        <h2>{t('pl.editRace')}</h2>
        <RaceForm overview={overview} initial={race} onCancel={() => setEditing(false)} onSave={async (s) => {
          setDetail(await api.updateRace(race.id, s));
          setEditing(false);
          await onChanged();
        }} />
      </section>
    );
  }

  const remove = async () => {
    if (!confirm(t('pl.deleteConfirm', { name: race.name }))) return;
    try {
      await api.deleteRace(race.id);
      await onChanged();
      go({});
    } catch (e) { onError(e); }
  };

  const setParticipant = (name: string, patch: Partial<Participant>) => {
    const p = { ...race.participants[name] ?? { avail: [], maxStints: 2, drives: true, lapTime: null, fuel: null }, ...patch };
    void save({ ...race, participants: { ...race.participants, [name]: p } }, () => api.participant(race.id, name, patch));
  };
  const setPlan = (plan: PlanStint[] | null) => void save({ ...race, plan }, () => api.plan(race.id, plan));

  return (
    <>
      <section className="card race-head">
        <div>
          <h1>{race.name}</h1>
          <p>
            <b>{fmtDateTime(race.start)}</b> – {fmtTime(race.start + race.duration * 1000)} · {fmtDur(race.duration * 1000)} h
            <br />{race.trackName || '–'} · {race.carName || '–'}
          </p>
          <p className="pl-muted">
            {t('pl.pitTimeShort', { s: race.pitTime })} · {t('pl.createdBy', { name: race.createdBy })} · {t('pl.timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          </p>
        </div>
        {canEdit && (
          <div className="pl-actions">
            <button className="btn ghost" onClick={() => setEditing(true)}>{t('pl.edit')}</button>
            <button className="btn ghost danger" onClick={remove}>{t('pl.delete')}</button>
          </div>
        )}
      </section>
      <Participants race={race} stats={stats} me={overview.me} canEdit={canEdit} onChange={setParticipant} />
      <Availability race={race} stats={stats} me={overview.me} canEdit={canEdit} onChange={(name, avail) => setParticipant(name, { avail })} />
      <Plan race={race} stats={stats} canEdit={canEdit} onChange={setPlan} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Participants: role, stints in a row, lap time data
// ---------------------------------------------------------------------------

function Participants({ race, stats, me, canEdit, onChange }: {
  race: Race; stats: Record<string, DriverStats>; me: string; canEdit: boolean; onChange(name: string, p: Partial<Participant>): void;
}) {
  const ctx = useMemo(() => planContext(race, stats), [race, stats]);
  const tankFrom = race.tank ? t('pl.tankEntered') : t('pl.tankFromLaps');
  return (
    <section className="card">
      <h2>{t('pl.participants')}</h2>
      <p className="pl-muted">
        {ctx.tank ? t('pl.tankInfo', { l: fmtNum(ctx.tank, 1), from: tankFrom }) : t('pl.noTank')}
        {race.track === null && <><br />{t('pl.noCombo')}</>}
      </p>
      <div className="pl-scroll">
        <table className="pl-table">
          <thead>
            <tr>
              <th>{t('pl.name')}</th><th>{t('pl.role')}</th><th>{t('pl.maxStints')}</th>
              <th className="num">{t('pl.lapsData')}</th><th className="num">{t('pl.best')}</th><th className="num">{t('pl.pace')}</th>
              <th className="num">{t('pl.fuel')}</th><th className="num">{t('pl.lapsPerTank')}</th><th className="num">{t('pl.stintLength')}</th>
            </tr>
          </thead>
          <tbody>
            {ctx.members.map((m) => {
              const p = race.participants[m.name];
              const s = stats[m.name];
              const mine = m.name === me;
              const edit = mine || canEdit;
              return (
                <tr key={m.name} className={mine ? 'me' : ''}>
                  <td>
                    {m.name}
                    {!p && <span className="tag warn">{t('pl.noAnswer')}</span>}
                  </td>
                  <td>
                    {edit ? (
                      <select value={m.drives ? 'drive' : 'spot'} onChange={(e) => onChange(m.name, { drives: e.target.value === 'drive' })}>
                        <option value="drive">{t('pl.roleDrive')}</option>
                        <option value="spot">{t('pl.roleSpot')}</option>
                      </select>
                    ) : m.drives ? t('pl.roleDrive') : t('pl.roleSpot')}
                  </td>
                  <td>
                    {edit && m.drives ? (
                      <input className="small" type="number" min={1} max={20} value={m.maxStints}
                        onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 20) onChange(m.name, { maxStints: n }); }} />
                    ) : m.drives ? m.maxStints : '–'}
                  </td>
                  <td className="num">{s?.laps ?? 0}</td>
                  <td className="num">{fmtLap(s?.best)}</td>
                  <td className="num">
                    {canEdit ? (
                      <OverrideInput value={p?.lapTime ?? null} measured={s?.pace ?? null} format={fmtLap} parse={parseLap}
                        onCommit={(v) => onChange(m.name, { lapTime: v })} />
                    ) : <>{fmtLap(m.lapTime)}{p?.lapTime ? ' *' : ''}</>}
                  </td>
                  <td className="num">
                    {canEdit ? (
                      <OverrideInput value={p?.fuel ?? null} measured={s?.fuel ?? null} format={(x) => fmtNum(x, 2)} parse={parseNum}
                        onCommit={(v) => onChange(m.name, { fuel: v })} />
                    ) : <>{fmtNum(m.fuel)}{m.fuelEstimated ? ' ~' : p?.fuel ? ' *' : ''}</>}
                  </td>
                  <td className="num">{m.stintLaps ?? '–'}</td>
                  <td className="num">{m.stintLaps && m.lapTime ? `${fmtDur(m.stintLaps * m.lapTime * 1000)} h` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pl-muted small">{canEdit ? t('pl.overrideHint') : t('pl.legend')}</p>
    </section>
  );
}

/** Manual value with the measured one as placeholder; empty = measured. */
function OverrideInput({ value, measured, format, parse, onCommit }: {
  value: number | null; measured: number | null; format(x: number): string; parse(v: string): number | null; onCommit(v: number | null): void;
}) {
  const [text, setText] = useState(value === null ? '' : format(value));
  useEffect(() => setText(value === null ? '' : format(value)), [value]);
  const commit = () => {
    const v = text.trim() ? parse(text) : null;
    if (v !== value) onCommit(v);
  };
  return (
    <input className={value === null ? 'override' : 'override set'} value={text} placeholder={measured === null ? '–' : format(measured)}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

// ---------------------------------------------------------------------------
// Availability grid
// ---------------------------------------------------------------------------

function slotSize(durationS: number) {
  return durationS <= 8 * 3600 ? 15 * 60_000 : durationS <= 24 * 3600 ? 30 * 60_000 : 60 * 60_000;
}

function Availability({ race, stats, me, canEdit, onChange }: {
  race: Race; stats: Record<string, DriverStats>; me: string; canEdit: boolean; onChange(name: string, avail: Interval[]): void;
}) {
  const slot = slotSize(race.duration);
  const end = race.start + race.duration * 1000;
  const n = Math.ceil((end - race.start) / slot);
  const slots = useMemo(() => Array.from({ length: n }, (_, i) => [race.start + i * slot, Math.min(end, race.start + (i + 1) * slot)] as Interval), [race.start, end, slot, n]);
  const ctx = useMemo(() => planContext(race, stats), [race, stats]);
  const plan = useMemo(() => (race.plan ? evaluatePlan(ctx, race.plan).stints : []), [ctx, race.plan]);
  const [drag, setDrag] = useState<{ name: string; value: boolean; cells: boolean[] } | null>(null);

  const cellsOf = (name: string) => {
    const avail = mergeIntervals(race.participants[name]?.avail ?? []);
    return slots.map(([a, b]) => available(avail, a, b));
  };
  const toIntervals = (cells: boolean[]) => mergeIntervals(slots.filter((_, i) => cells[i]));

  const startDrag = (name: string, i: number) => {
    const cells = cellsOf(name);
    const value = !cells[i];
    cells[i] = value;
    setDrag({ name, value, cells });
  };
  const enter = (name: string, i: number) => {
    if (!drag || drag.name !== name || drag.cells[i] === drag.value) return;
    const cells = [...drag.cells];
    cells[i] = drag.value;
    setDrag({ ...drag, cells });
  };
  useEffect(() => {
    if (!drag) return;
    const up = () => {
      onChange(drag.name, toIntervals(drag.cells));
      setDrag(null);
    };
    addEventListener('pointerup', up);
    return () => removeEventListener('pointerup', up);
  });

  const role = (name: string, [a, b]: Interval) => {
    const s = plan.find((x) => x.start < b && x.end > a && (x.driver === name || x.spotter === name));
    return s ? (s.driver === name ? 'drive' : 'spot') : '';
  };
  // Hour marks in local time.
  const labels = slots.map(([a], i) => {
    const d = new Date(a);
    return i === 0 || (d.getMinutes() === 0) ? fmtTime(a) : '';
  });
  const pct = (ms: number) => `${((ms - race.start) / (end - race.start)) * 100}%`;

  return (
    <section className="card">
      <h2>{t('pl.availability')}</h2>
      <p className="pl-muted">{t('pl.availabilityHint', { min: slot / 60_000 })}</p>
      <div className="pl-scroll">
        <div className="grid" style={{ ['--cols' as string]: n }}>
          <div className="grid-row grid-labels">
            <div className="grid-name" />
            <div className="grid-cells">
              {labels.map((l, i) => <div key={i} className={l ? 'grid-label mark' : 'grid-label'}>{l && <span>{l}</span>}</div>)}
            </div>
          </div>
          {plan.length > 0 && (
            <div className="grid-row">
              <div className="grid-name"><b>{t('pl.plan')}</b></div>
              <div className="grid-cells grid-plan">
                {plan.filter((s) => s.start < end).map((s) => (
                  <div key={s.index} className={s.issues.length ? 'stint-block bad' : 'stint-block'} title={`${s.index + 1}: ${s.driver ?? '–'} / ${s.spotter ?? '–'}`}
                    style={{ left: pct(s.start), width: `calc(${pct(Math.min(s.end, end))} - ${pct(s.start)})` }}>
                    {s.driver ?? '?'}
                  </div>
                ))}
              </div>
            </div>
          )}
          {race.invited.map((name) => {
            const editable = name === me || canEdit;
            const cells = drag?.name === name ? drag.cells : cellsOf(name);
            return (
              <div key={name} className={name === me ? 'grid-row me' : 'grid-row'}>
                <div className="grid-name">
                  {name}
                  {editable && (
                    <span className="grid-quick">
                      <button className="linkish" onClick={() => onChange(name, [[race.start, end]])}>{t('pl.all')}</button>
                      <button className="linkish" onClick={() => onChange(name, [])}>{t('pl.none')}</button>
                    </span>
                  )}
                </div>
                <div className={editable ? 'grid-cells editable' : 'grid-cells'}>
                  {cells.map((on, i) => (
                    <div key={i} className={`cell ${on ? 'on' : ''} ${role(name, slots[i]!)} ${labels[i] ? 'mark' : ''}`}
                      title={`${fmtTime(slots[i]![0])}–${fmtTime(slots[i]![1])}`}
                      onPointerDown={editable ? (e) => { e.preventDefault(); startDrag(name, i); } : undefined}
                      onPointerEnter={editable ? () => enter(name, i) : undefined} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="pl-legend">
        <span><i className="cell on" /> {t('pl.legendAvailable')}</span>
        <span><i className="cell on drive" /> {t('pl.legendDrives')}</span>
        <span><i className="cell on spot" /> {t('pl.legendSpots')}</span>
        <span><i className="cell drive" /> {t('pl.legendConflict')}</span>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stint plan
// ---------------------------------------------------------------------------

const ISSUE_ORDER: IssueCode[] = ['no-driver', 'driver-away', 'no-spotter', 'spotter-away', 'spotter-is-driver', 'streak', 'fuel', 'not-a-driver', 'no-laptime', 'unknown-member', 'after-end'];

function Plan({ race, stats, canEdit, onChange }: {
  race: Race; stats: Record<string, DriverStats>; canEdit: boolean; onChange(plan: PlanStint[] | null): void;
}) {
  const ctx = useMemo(() => planContext(race, stats), [race, stats]);
  const plan = race.plan ?? [];
  const summary = useMemo(() => evaluatePlan(ctx, plan), [ctx, plan]);
  const [note, setNote] = useState<string | null>(null);

  const run = (keep: PlanStint[]) => {
    const res = autoPlan(ctx, keep);
    if (res.noDrivers) return setNote(t('pl.noDrivers'));
    setNote(null);
    onChange(res.stints);
  };
  const auto = () => {
    if (plan.length && !confirm(t('pl.replaceConfirm'))) return;
    run([]);
  };
  const update = (i: number, patch: Partial<PlanStint>) => onChange(plan.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(plan.filter((_, k) => k !== i));
  const insert = (i: number) => {
    const ref = plan[i] ?? plan.at(-1);
    onChange([...plan.slice(0, i + 1), { driver: null, spotter: null, laps: ref?.laps ?? ctx.typicalLaps ?? 25 }, ...plan.slice(i + 1)]);
  };

  // Problems grouped by kind for the summary line.
  const counts = new Map<IssueCode, number>();
  for (const s of summary.stints) for (const c of s.issues) counts.set(c, (counts.get(c) ?? 0) + 1);
  const problems = ISSUE_ORDER.filter((c) => counts.has(c)).map((c) => t('pl.count', { n: counts.get(c)!, what: t(`pl.issue.${c}`) }));
  if (summary.short && plan.length) problems.push(t('pl.short', { time: fmtTime(summary.end) }));
  const ok = plan.length > 0 && !problems.length;
  const names = race.invited;

  return (
    <section className="card">
      <h2>{t('pl.stintPlan')}</h2>
      {canEdit && (
        <div className="pl-actions">
          <button className="btn" onClick={auto}>{t('pl.autoPlan')}</button>
          {plan.length > 0 && <button className="btn ghost" onClick={() => confirm(t('pl.clearConfirm')) && onChange(null)}>{t('pl.clearPlan')}</button>}
        </div>
      )}
      {note && <p className="pl-status bad">{note}</p>}
      {!plan.length && !note && <p className="pl-muted">{canEdit ? t('pl.noPlanAdmin') : t('pl.noPlan')}</p>}
      {plan.length > 0 && (
        <p className={ok ? 'pl-status ok' : 'pl-status bad'}>
          {ok ? t('pl.planOk', { laps: summary.laps }) : <>{t('pl.planProblems')} {problems.join(' · ')}</>}
        </p>
      )}
      {plan.length > 0 && (
        <div className="pl-scroll">
          <table className="pl-table plan">
            <thead>
              <tr>
                <th>#</th><th>{t('pl.time')}</th><th>{t('pl.driver')}</th><th>{t('pl.spotter')}</th><th className="num">{t('pl.laps')}</th>
                <th className="num">{t('pl.lapTime')}</th><th>{t('pl.notes')}</th>{canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {summary.stints.map((s, i) => (
                <tr key={i} className={s.issues.length ? 'bad' : ''}>
                  <td>{i + 1}</td>
                  <td className="nowrap">{fmtTime(s.start)}–{fmtTime(s.end)}</td>
                  <td>{canEdit ? <PersonSelect value={s.driver} names={names} onChange={(driver) => update(i, { driver })} /> : s.driver ?? '–'}</td>
                  <td>{canEdit ? <PersonSelect value={s.spotter} names={names} onChange={(spotter) => update(i, { spotter })} /> : s.spotter ?? '–'}</td>
                  <td className="num">
                    {canEdit ? (
                      <input className="small" type="number" min={1} max={999} value={s.laps}
                        onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1) update(i, { laps: n }); }} />
                    ) : s.laps}
                  </td>
                  <td className="num">{fmtLap(s.lapTime)}</td>
                  <td className="issues">{s.issues.map((c) => t(`pl.issue.${c}`)).join(', ')}</td>
                  {canEdit && (
                    <td className="nowrap row-actions">
                      <button className="linkish" title={t('pl.replanFromHint')} onClick={() => run(plan.slice(0, i))}>{t('pl.replanFrom')}</button>
                      <button className="linkish" title={t('pl.insertHint')} onClick={() => insert(i)}>+</button>
                      <button className="linkish" title={t('pl.removeHint')} onClick={() => remove(i)}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan.length > 0 && (
        <>
          <h3>{t('pl.load')}</h3>
          <div className="pl-scroll">
            <table className="pl-table">
              <thead><tr><th>{t('pl.name')}</th><th className="num">{t('pl.stints')}</th><th className="num">{t('pl.driveTime')}</th><th className="num">{t('pl.spotTime')}</th></tr></thead>
              <tbody>
                {names.map((n) => {
                  const l = summary.members[n];
                  return <tr key={n}><td>{n}</td><td className="num">{l?.stints ?? 0}</td><td className="num">{fmtDur(l?.drive ?? 0)} h</td><td className="num">{fmtDur(l?.spot ?? 0)} h</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function PersonSelect({ value, names, onChange }: { value: string | null; names: string[]; onChange(v: string | null): void }): ReactNode {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">–</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

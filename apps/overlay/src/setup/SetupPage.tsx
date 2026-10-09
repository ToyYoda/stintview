import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { MESSAGE_COLORS, MESSAGE_MAX_LENGTH, type MessageColor } from '@stintview/protocol';
import type { AppState, HotkeyGroup, PanelSetting, DuelOptions, RadioState, StandingsColumn, StandingsOptions } from '../feed.ts';
import { setLang, t, useLang, type Lang } from '../i18n.ts';
import { brand } from '../brand.ts';
import logoUrl from '../assets/logo-light.webp';
import wordmarkUrl from '../assets/wordmark-light.webp';
import './setup.css';

const api = () => window.stintview!;

/** Setup and status window of the desktop app (route #/setup). */
export function SetupPage() {
  const [state, setState] = useState<AppState | null>(null);
  useLang();

  useEffect(() => {
    document.body.classList.add('setup-body');
    api().getState().then(setState);
    api().onState(setState);
  }, []);
  useEffect(() => {
    if (state) setLang(state.settings.language);
  }, [state?.settings.language]);

  if (!state) return null;
  const setLanguage = async (language: Lang) => setState(await api().updateSettings({ language }));
  return (
    <div className="setup">
      <header className="setup-head">
        {brand === 'backseat' ? (
          // Alternative app: "BR" race plate and its own wordmark.
          <>
            <span className="plate" aria-hidden="true"><span>BR</span></span>
            <div>
              <div className="wordmark br"><span>BACKSEAT</span><b>RACER</b></div>
              <div className="product">v{state.version}</div>
            </div>
          </>
        ) : (
          <>
            <img className="oe-logo" src={logoUrl} alt="" />
            <div>
              <img className="oe-wordmark" src={wordmarkUrl} alt="Outcast Endurance" />
              <div className="product">StintView <small>v{state.version}</small></div>
            </div>
          </>
        )}
        <div className="lang-switch" role="radiogroup" aria-label={t('set.language')}>
          {(['de', 'en'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={state.settings.language === l}
              className={state.settings.language === l ? 'seg active' : 'seg'} onClick={() => setLanguage(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      {/* Also without a team: the displays then show this PC's own sessions; joining is in the Team tab. */}
      <Dashboard state={state} onState={setState} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// No team yet: join or create one (Team tab)
// ---------------------------------------------------------------------------

function Onboarding({ onState, serverPort }: { onState(s: AppState): void; serverPort: number }) {
  const [tab, setTab] = useState<'join' | 'create'>('join');
  return (
    <>
      <p className="intro">{t('set.welcome')}</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>{t('set.join')}</button>
        <button role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>{t('set.createTab')}</button>
      </div>
      {tab === 'join' ? <JoinForm onState={onState} /> : <CreateForm onState={onState} serverPort={serverPort} />}
    </>
  );
}

function useSubmit(action: () => Promise<AppState>, onState: (s: AppState) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onState(await action());
    } catch (err) {
      // Electron prefixes IPC errors with "Error invoking remote method '…': Error: "
      setError(String((err as Error).message ?? err).replace(/^.*?Error: /, ''));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function JoinForm({ onState }: { onState(s: AppState): void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [memberName, setMemberName] = useState('');
  const { busy, error, submit } = useSubmit(() => api().join({ serverUrl, inviteCode, memberName }), onState);
  return (
    <form className="card" onSubmit={submit}>
      <Field label={t('set.serverAddress')} hint={t('set.serverHint')}>
        <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder={t('set.serverPlaceholder')} required autoFocus spellCheck={false} />
      </Field>
      <Field label={t('set.inviteCode')}>
        <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" required spellCheck={false} className="mono" />
      </Field>
      <Field label={t('set.yourName')} hint={t('set.yourNameHint')}>
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder={t('set.namePlaceholder')} required maxLength={64} />
      </Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? t('set.connecting') : t('set.join')}</button>
    </form>
  );
}

function CreateForm({ onState, serverPort }: { onState(s: AppState): void; serverPort: number }) {
  const [hostHere, setHostHere] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [teamName, setTeamName] = useState('Outcast Endurance');
  const [memberName, setMemberName] = useState('');
  const { busy, error, submit } = useSubmit(() => api().create({ serverUrl, teamName, memberName, hostHere }), onState);
  return (
    <form className="card" onSubmit={submit}>
      <label className="check">
        <input type="checkbox" checked={hostHere} onChange={(e) => setHostHere(e.target.checked)} />
        <span>{t('set.hostHere')} <small>{t('set.hostHereHint', { port: serverPort })}</small></span>
      </label>
      {!hostHere && (
        <Field label={t('set.serverAddress')}>
          <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder={t('set.serverPlaceholder')} required spellCheck={false} />
        </Field>
      )}
      <Field label={t('set.teamName')}>
        <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required maxLength={64} />
      </Field>
      <Field label={t('set.yourName')}>
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} required maxLength={64} autoFocus />
      </Field>
      {hostHere && <p className="hint">{t('set.firewall', { port: serverPort })}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? t('set.creating') : t('set.create')}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Configured: status and switches
// ---------------------------------------------------------------------------

type Tab = 'status' | 'displays' | 'pit' | 'radio' | 'planner' | 'team' | 'keys';
const TABS: Tab[] = ['status', 'displays', 'pit', 'radio', 'planner', 'team', 'keys'];
const TAB_KEY = 'stintview.setupTab';

/**
 * Last tab, or the hotkey overview when opened via "Tastaturkürzel …" in the tray menu;
 * without a team the Team tab (join or create).
 */
function initialTab(configured: boolean): Tab {
  if (location.hash.endsWith('/keys')) return 'keys';
  if (!configured) return 'team';
  try {
    const saved = localStorage.getItem(TAB_KEY) as Tab | null;
    if (saved && TABS.includes(saved)) return saved;
  } catch { /* no storage */ }
  return 'status';
}

function Dashboard({ state, onState }: { state: AppState; onState(s: AppState): void }) {
  const { team, settings, status } = state;
  const set = async (patch: Partial<AppState['settings']>) => onState(await api().updateSettings(patch));
  const serverDot = status.server === 'connected' || status.server === 'standby' ? 'ok' : status.server === 'error' ? 'bad' : 'warn';
  const [tab, setTabState] = useState<Tab>(() => initialTab(state.configured));
  const setTab = (next: Tab) => {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* not remembered */ }
  };
  useEffect(() => {
    // The tray menu reloads the window with #/setup/keys while it is open.
    const onHash = () => { if (location.hash.endsWith('/keys')) setTab('keys'); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      {state.update.phase === 'ready' && (
        <section className="card update-ready">
          <h2>{t('set.updateReady')}</h2>
          <p>{t('set.updateText', { version: state.update.version })}</p>
          <button className="btn" onClick={() => api().installUpdate()}>{t('set.updateNow')}</button>
        </section>
      )}
      <div className="tabs main-tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {t(`set.tab.${id}`)}
          </button>
        ))}
      </div>

      {tab === 'status' && (
      <section className="card">
        <h2>{t('set.status')}</h2>
        <ul className="status">
          {state.configured ? (
            <li><Dot kind={serverDot} />{t('set.teamServer')}{status.server === 'error' ? `: ${status.serverText.replace(/^server error: /, '')}` : status.server === 'offline' ? t('set.noConnection') : t('set.connected')}</li>
          ) : (
            <li><Dot kind="idle" />{t('set.noTeam')}</li>
          )}
          {state.configured && (status.server === 'offline' || status.server === 'error') && <li><Dot kind="idle" />{t('set.localFallback')}</li>}
          {status.otherSession && <li><Dot kind="idle" />{t('set.otherSession')}</li>}
          <li><Dot kind={status.iracing ? 'ok' : 'idle'} />{status.iracing ? t('set.iracingRunning') : t('set.iracingNot')}</li>
          <li><Dot kind={status.inCar ? (status.server === 'standby' && !status.otherSession ? 'warn' : 'ok') : 'idle'} />{status.inCar ? (status.server === 'standby' && !status.otherSession ? t('set.standby') : status.server === 'connected' ? t('set.driving') : t('set.drivingLocal')) : t('set.notInCar')}</li>
          {status.waitingForIracing && <li><Dot kind="idle" />{t('set.waitingForIracing')}</li>}
          {settings.overlay && settings.output === 'vr' && !status.waitingForIracing && <li><Dot kind={status.vr === 'connected' ? 'ok' : 'warn'} />{status.vr === 'connected' ? t('set.vrConnected') : t('set.vrWaiting')}</li>}
          {settings.server && <li><Dot kind={status.relay === 'running' ? 'ok' : 'bad'} />{status.relay === 'running' ? t('set.relayRunning') : t('set.relayStopped')}</li>}
        </ul>
      </section>
      )}

      {tab === 'displays' && (
      <section className="card">
        <h2>{t('set.displays')}</h2>
        <Toggle checked={settings.overlay} onChange={(v) => set({ overlay: v })} label={t('set.show')} hint={t('set.showHint')} />
        <Toggle checked={settings.onlyWithIracing} disabled={!settings.overlay} onChange={(v) => set({ onlyWithIracing: v })}
          label={t('set.onlyWithIracing')} hint={t('set.onlyWithIracingHint')} />
        <div className="output-choice" role="radiogroup" aria-label={t('set.output')}>
          <span>{t('set.output')}</span>
          {(['monitor', 'vr'] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={settings.output === o}
              className={settings.output === o ? 'seg active' : 'seg'} onClick={() => set({ output: o })}>
              {o === 'monitor' ? t('set.monitor') : t('set.vr')}
            </button>
          ))}
        </div>
        <p className="hint">{settings.output === 'monitor' ? t('set.monitorHint') : t('set.vrHint')}</p>
        {status.overlay && (
          <div className="edit-row">
            <button className="btn ghost" onClick={async () => onState(await api().setEditMode(!status.editing))}>
              {status.editing ? t('set.moveEnd') : t('set.move')}
            </button>
            <small>{status.editHotkey ? t('set.orKey', { key: status.editHotkey }) : t('set.noKey')}</small>
          </div>
        )}
        <Slider label={t('set.background')} hint={t('set.backgroundHint')}
          value={settings.opacity} min={0} max={100} step={5} onCommit={(opacity) => set({ opacity })} />
        <PanelList panels={settings.panels} onChange={(panels) => set({ panels })} />
        <p className="hint cam-keys">
          {t('set.camKeysA')}<b>{state.cameraHotkeys.incident ?? '–'}</b>{t('set.camKeysB')}
          <b>{state.cameraHotkeys.back ?? '–'}</b>{t('set.camKeysC')}{' '}
          <a href="#keys" onClick={(e) => { e.preventDefault(); setTab('keys'); }}>{t('set.allKeys')}</a>
        </p>
      </section>
      )}

      {tab === 'pit' && (
        <PitStopCard pit={settings.pitStop} onChange={(pitStop) => set({ pitStop })} imp={state.pitImport}
          onImport={async (choose) => onState(await api().pitImport(choose))} />
      )}

      {tab === 'radio' && !state.configured && <p className="hint">{t('set.radioNoTeam')}</p>}
      {tab === 'radio' && (
        <RadioCard radio={state.radio} onChange={(messages) => set({ messages })} />
      )}

      {tab === 'planner' && <PlannerCard state={state} onState={onState} />}

      {tab === 'team' && !state.configured && (
        <>
          <Onboarding onState={onState} serverPort={settings.serverPort} />
          <section className="card">
            <Toggle checked={settings.autostart} disabled={!state.autostartAvailable} onChange={(v) => set({ autostart: v })} label={t('set.autostart')} hint={t('set.autostartHint')} />
          </section>
        </>
      )}
      {tab === 'team' && state.configured && (
      <section className="card">
        <h2>{t('set.team')}</h2>
        <dl className="team">
          <dt>{t('set.team')}</dt><dd>{team?.teamName}</dd>
          <dt>{t('set.you')}</dt><dd>{team?.memberName}</dd>
          <dt>{t('set.server')}</dt><dd className="mono">{team?.serverUrl}</dd>
          <dt>{t('set.inviteCode')}</dt><dd className="mono">{team?.inviteCode}</dd>
        </dl>
        <Toggle checked={settings.autostart} disabled={!state.autostartAvailable} onChange={(v) => set({ autostart: v })} label={t('set.autostart')} hint={t('set.autostartHint')} />
        <Toggle checked={settings.server} onChange={(v) => set({ server: v })} label={t('set.serverHere', { port: settings.serverPort })} hint={t('set.serverHereHint')} />
        <button className="btn ghost" onClick={async () => onState(await api().leave())}>{t('set.leave')}</button>
      </section>
      )}

      {tab === 'keys' && <HotkeyCard groups={state.hotkeys} />}

      <p className="foot">
        {t('set.version', { version: state.version })}
        {state.update.phase !== 'unavailable' && state.update.phase !== 'ready' && (
          <>
            {' · '}
            <button className="linkish" disabled={state.update.phase === 'checking' || state.update.phase === 'downloading'}
              onClick={async () => onState(await api().checkUpdate())}>
              {state.update.label}
            </button>
          </>
        )}
        <br />
        {t('set.closeHint')}
      </p>
    </>
  );
}

type EditableMessage = { id: string; text: string; color: MessageColor };

/**
 * "Funk": the team messages this PC can send – text and colour, editable, each with a hotkey
 * (first nine) – plus a one-off message that isn't kept. Sending works from here too.
 */
function RadioCard({ radio, onChange }: { radio: RadioState; onChange(list: EditableMessage[] | null): void }) {
  const list: EditableMessage[] = radio.messages.map(({ id, text, color }) => ({ id, text, color }));
  const [once, setOnce] = useState<{ text: string; color: MessageColor }>({ text: '', color: 'white' });
  const [sent, setSent] = useState<string | null>(null);
  const update = (i: number, patch: Partial<EditableMessage>) => onChange(list.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const send = async (what: string | { text: string; color: MessageColor }, mark: string) => {
    if (await api().sendMessage?.(what)) {
      setSent(mark);
      setTimeout(() => setSent((s) => (s === mark ? null : s)), 1500);
    }
  };
  return (
    <section className="card radio-card">
      <h2>{t('set.radio')}</h2>
      <p className="hint">{t('set.radioHint')}</p>
      {radio.driving && <p className="hint warn">{t('set.radioDriving')}</p>}
      <ul className="radio-list">
        {radio.messages.map((m, i) => (
          <li key={`${m.id}:${m.text}`}>
            <ColorDots value={m.color} onChange={(color) => update(i, { color })} />
            <input type="text" defaultValue={m.text} maxLength={MESSAGE_MAX_LENGTH} aria-label={t('set.radioText')}
              onBlur={(e) => { const text = e.target.value.trim(); if (text && text !== m.text) update(i, { text }); else e.target.value = m.text; }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <span className="radio-key-label">{m.key ?? (i < 9 ? '' : t('set.radioNoKey'))}</span>
            <button type="button" className="btn small" onClick={() => send(m.id, m.id)}>{sent === m.id ? '✓' : t('set.radioSend')}</button>
            <span className="radio-tools">
              <button type="button" className="icon" disabled={i === 0} aria-label={t('set.radioUp')} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon" disabled={i === list.length - 1} aria-label={t('set.radioDown')} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="icon" aria-label={t('set.radioDelete')} onClick={() => onChange(list.filter((_, k) => k !== i))}>✕</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="radio-actions">
        <button type="button" className="btn ghost" disabled={list.length >= 12}
          onClick={() => onChange([...list, { id: '', text: t('set.radioNew'), color: 'white' }])}>{t('set.radioAdd')}</button>
        <button type="button" className="linkish" onClick={() => onChange(null)}>{t('set.radioReset')}</button>
      </div>
      <h3>{t('set.radioOnce')}</h3>
      <div className="radio-once">
        <ColorDots value={once.color} onChange={(color) => setOnce({ ...once, color })} />
        <input type="text" value={once.text} maxLength={MESSAGE_MAX_LENGTH} placeholder={t('set.radioOncePlaceholder')}
          onChange={(e) => setOnce({ ...once, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && once.text.trim()) send({ text: once.text.trim(), color: once.color }, 'once'); }} />
        <button type="button" className="btn small" disabled={!once.text.trim()}
          onClick={() => send({ text: once.text.trim(), color: once.color }, 'once')}>{sent === 'once' ? '✓' : t('set.radioSend')}</button>
      </div>
    </section>
  );
}

/** Colour choice for a team message. */
function ColorDots({ value, onChange }: { value: MessageColor; onChange(c: MessageColor): void }) {
  return (
    <span className="color-dots" role="radiogroup" aria-label={t('set.radioColor')}>
      {MESSAGE_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t(`set.color.${c}`)}
          className={`color-dot color-${c}${value === c ? ' on' : ''}`} onClick={() => onChange(c)} />
      ))}
    </span>
  );
}

/** All global hotkeys with the key each function actually got ("Tastaturkürzel" in the tray menu). */
function HotkeyCard({ groups }: { groups: HotkeyGroup[] }) {
  return (
    <section className="card" id="keys">
      <h2>{t('set.keys')}</h2>
      <p className="hint">{t('set.keysHint')}</p>
      {groups.map((g) => (
        <div key={g.title} className="keys-group">
          <h3>{g.title}</h3>
          {g.note && <p className="hint">{g.note}</p>}
          <table className="keys">
            <tbody>
              {g.items.map((k) => (
                <tr key={k.label} className={k.active ? '' : 'inactive'}>
                  <td>{k.label}</td>
                  <td className="keys-key">
                    {k.key ? <kbd>{k.key}</kbd> : <span className="bad">{t('set.keyTaken')}</span>}
                    {k.taken.length > 0 && <small>{t('set.takenBy', { keys: k.taken.join(' / ') })}</small>}
                    {k.alternatives.length > 0 && <small>{t('set.spare', { keys: k.alternatives.join(' / ') })}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

/** Slider that applies live while dragging (saved at most every 150 ms). */
function Slider({ label, hint, value, min, max, step, onCommit }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number; onCommit(v: number): void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const timer = setTimeout(() => onCommit(v), 150);
    return () => clearTimeout(timer);
  }, [v]);
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <b>{v} %</b>
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Manual crew values for the pit stop planner; empty = measured at our own stops. */
function PitStopCard({ pit, onChange, imp, onImport }: {
  pit: AppState['settings']['pitStop'];
  onChange(p: AppState['settings']['pitStop']): void;
  imp: AppState['pitImport'];
  onImport(choose: boolean): void;
}) {
  const [fill, setFill] = useState(pit.fillRate?.toString() ?? '');
  const [tyre, setTyre] = useState(pit.tyreTime?.toString() ?? '');
  const num = (v: string) => {
    const n = Number(v.replace(',', '.'));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const save = (patch: Partial<AppState['settings']['pitStop']>) => onChange({ ...pit, ...patch });
  return (
    <section className="card">
      <h2>{t('set.pit')}</h2>
      <p className="hint">{t('set.pitHint')}</p>
      <div className="pit-form">
        <label>{t('set.fillRate')} <input inputMode="decimal" placeholder={t('set.auto')} value={fill}
          onChange={(e) => setFill(e.target.value)} onBlur={() => save({ fillRate: num(fill) })} /> l/s</label>
        <label>{t('set.tyreTime')} <input inputMode="decimal" placeholder={t('set.auto')} value={tyre}
          onChange={(e) => setTyre(e.target.value)} onBlur={() => save({ tyreTime: num(tyre) })} /> s</label>
        <label>{t('set.regulation')}
          <select value={pit.regulation} onChange={(e) => save({ regulation: e.target.value as AppState['settings']['pitStop']['regulation'] })}>
            <option value="auto">{t('set.auto')}</option>
            <option value="standard">{t('set.reg.standard')}</option>
            <option value="imsa">{t('set.reg.imsa')}</option>
            <option value="nec">{t('set.reg.nec')}</option>
            <option value="dtm">{t('set.reg.dtm')}</option>
          </select>
        </label>
      </div>
      <div className="pit-import">
        <p className="hint">{t('set.importHint')}</p>
        <div className="edit-row">
          <button className="btn ghost" disabled={imp.running} onClick={() => onImport(false)}>
            {imp.running ? t('set.reading') : t('set.import')}
          </button>
          <button className="linkish" disabled={imp.running} onClick={() => onImport(true)}>{t('set.otherFolder')}</button>
        </div>
        {(imp.running || imp.finished) && (
          <small className={imp.error ? 'bad' : ''}>
            {imp.error ? imp.error
              : imp.running ? t('set.importProgress', { done: imp.done, total: imp.total || '…', passes: imp.passes, tracks: imp.tracks })
                : imp.total === 0 ? t('set.importNothing')
                  : t('set.importDone', { total: imp.total, passes: imp.passes, tracks: imp.tracks })}
            {imp.folder && <><br />{imp.folder}</>}
          </small>
        )}
      </div>
    </section>
  );
}

/**
 * "Planer": open the stint planner (a page on the team server) and the lap times it plans
 * with – recorded while driving, older ones read from the .ibt archive.
 */
function PlannerCard({ state, onState }: { state: AppState; onState(s: AppState): void }) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const imp = state.lapImport, counts = state.lapCounts;
  const open = async () => {
    setOpening(true);
    setError((await api().openPlanner!()).error);
    setOpening(false);
  };
  return (
    <>
      <section className="card">
        <h2>{t('set.planner')}</h2>
        <p className="hint">{t('set.plannerHint')}</p>
        {state.configured ? (
          <button className="btn" disabled={opening} onClick={open}>{t('set.plannerOpen')}</button>
        ) : <p className="hint">{t('set.plannerNoTeam')}</p>}
        {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </section>
      <section className="card">
        <h2>{t('set.lapsTitle')}</h2>
        <p className="hint">{t('set.lapsHint')}</p>
        <p className="laps-count">
          {!counts ? t('set.lapsUnknown')
            : counts.unsent ? t('set.lapsCount', { total: counts.total, unsent: counts.unsent })
              : t('set.lapsAllSent', { total: counts.total })}
        </p>
        <div className="pit-import">
          <p className="hint">{t('set.lapImportHint')}</p>
          <div className="edit-row">
            <button className="btn ghost" disabled={imp.running} onClick={async () => onState(await api().lapImport!(false))}>
              {imp.running ? t('set.reading') : t('set.lapImport')}
            </button>
            <button className="linkish" disabled={imp.running} onClick={async () => onState(await api().lapImport!(true))}>{t('set.otherFolder')}</button>
          </div>
          {(imp.running || imp.finished) && (
            <small className={imp.error ? 'bad' : ''}>
              {imp.error ? imp.error
                : imp.running ? t('set.lapImportProgress', { done: imp.done, total: imp.total || '…', laps: imp.laps, tracks: imp.tracks })
                  : imp.total === 0 ? t('set.importNothing')
                    : t('set.lapImportDone', { total: imp.total, laps: imp.laps, tracks: imp.tracks })}
              {imp.folder && <><br />{imp.folder}</>}
            </small>
          )}
        </div>
      </section>
    </>
  );
}

const PANEL_IDS = ['header', 'inputs', 'fuel', 'tyres', 'weather', 'standings', 'duel', 'pitstop', 'messages', 'radio'] as const;
const STANDINGS_COLUMNS: StandingsColumn[] = ['pos', 'num', 'flag', 'name', 'best', 'gap', 'tyre', 'delta'];

/**
 * Every panel: on/off in the header, and when opened its size and panel-specific options.
 * Applies to the chosen output (monitor or VR).
 */
function PanelList({ panels, onChange }: {
  panels: AppState['settings']['panels'];
  onChange(p: AppState['settings']['panels']): void;
}) {
  const update = (id: string, patch: Partial<PanelSetting>) => onChange({ ...panels, [id]: { ...panels[id]!, ...patch } });
  return (
    <div className="panel-list">
      {PANEL_IDS.map((id) => {
        const p = panels[id];
        if (!p) return null;
        const name = t(`set.panel.${id}`);
        return (
          <details key={id} className={p.shown ? 'panel-item' : 'panel-item off'}>
            <summary>
              <input type="checkbox" aria-label={t('set.showPanel', { name })} checked={p.shown}
                onClick={(e) => e.stopPropagation()} onChange={() => update(id, { shown: !p.shown })} />
              <span className="panel-name">{name}</span>
              <span className="panel-meta">{p.size !== 100 ? `${p.size} %` : ''}</span>
            </summary>
            <div className="panel-body">
              <Slider label={t('set.size')} value={p.size} min={50} max={200} step={5} onCommit={(size) => update(id, { size })} />
              {id === 'standings' && p.options && <StandingsOptionsForm options={p.options as StandingsOptions} onChange={(options) => update(id, { options })} />}
              {id === 'duel' && p.options && <DuelOptionsForm options={p.options as DuelOptions} onChange={(options) => update(id, { options })} />}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function StandingsOptionsForm({ options, onChange }: { options: StandingsOptions; onChange(o: StandingsOptions): void }) {
  return (
    <div className="panel-options">
      <div className="options-title">{t('set.columns')}</div>
      <div className="options-grid">
        {STANDINGS_COLUMNS.map((c) => (
          <label key={c}>
            <input type="checkbox" checked={options.columns[c] ?? true}
              onChange={() => onChange({ ...options, columns: { ...options.columns, [c]: !(options.columns[c] ?? true) } })} />
            {t(`set.col.${c}`)}
          </label>
        ))}
      </div>
      <label className="option-line">
        <input type="checkbox" checked={options.duel} onChange={() => onChange({ ...options, duel: !options.duel })} />
        {t('set.duel')}
      </label>
      <label className="option-line">
        <input type="checkbox" checked={options.lapping} onChange={() => onChange({ ...options, lapping: !options.lapping })} />
        {t('set.lapping')}
      </label>
    </div>
  );
}

function DuelOptionsForm({ options, onChange }: { options: DuelOptions; onChange(o: DuelOptions): void }) {
  return (
    <div className="panel-options">
      <label className="option-line">
        <input type="checkbox" checked={options.traffic} onChange={() => onChange({ ...options, traffic: !options.traffic })} />
        {t('set.traffic')}
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={disabled ? 'toggle disabled' : 'toggle'}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" aria-hidden="true" />
      <span className="label">{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

function Dot({ kind }: { kind: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return <span className={`sdot ${kind}`} aria-hidden="true" />;
}


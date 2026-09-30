import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AppState, HotkeyGroup } from '../feed.ts';
import './setup.css';

const api = () => window.stintview!;

/** Setup and status window of the desktop app (route #/setup). */
export function SetupPage() {
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    document.body.classList.add('setup-body');
    api().getState().then(setState);
    api().onState(setState);
  }, []);

  if (!state) return null;
  return (
    <div className="setup">
      <header className="setup-head">
        <Emblem />
        <div>
          <div className="wordmark"><b>OUTCAST</b><span>ENDURANCE</span></div>
          <div className="product">StintView <small>v{state.version}</small></div>
        </div>
      </header>
      {state.configured ? <Dashboard state={state} onState={setState} /> : <Onboarding onState={setState} serverPort={state.settings.serverPort} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// First run: join or create a team
// ---------------------------------------------------------------------------

function Onboarding({ onState, serverPort }: { onState(s: AppState): void; serverPort: number }) {
  const [tab, setTab] = useState<'join' | 'create'>('join');
  return (
    <>
      <p className="intro">Willkommen! Verbinde StintView einmalig mit deinem Team. Server-Adresse und Einladungscode bekommst du vom Teamchef.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>Team beitreten</button>
        <button role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>Team anlegen (Teamchef)</button>
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
      <Field label="Server-Adresse" hint="z. B. beispiel.dyndns.org:8787">
        <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="beispiel.dyndns.org:8787" required autoFocus spellCheck={false} />
      </Field>
      <Field label="Einladungscode">
        <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" required spellCheck={false} className="mono" />
      </Field>
      <Field label="Dein Name" hint="So sieht dich dein Team.">
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Max Mustermann" required maxLength={64} />
      </Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Verbinde …' : 'Team beitreten'}</button>
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
        <span>Team-Server auf diesem PC betreiben <small>(Port {serverPort}, muss während der Rennen laufen)</small></span>
      </label>
      {!hostHere && (
        <Field label="Server-Adresse">
          <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="beispiel.dyndns.org:8787" required spellCheck={false} />
        </Field>
      )}
      <Field label="Teamname">
        <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required maxLength={64} />
      </Field>
      <Field label="Dein Name">
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} required maxLength={64} autoFocus />
      </Field>
      {hostHere && (
        <p className="hint">Windows fragt beim ersten Start des Servers, ob StintView Verbindungen annehmen darf – bitte erlauben. Damit dein Team dich erreicht, braucht dein Router eine Portfreigabe für TCP {serverPort}.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Lege an …' : 'Team anlegen'}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Configured: status and switches
// ---------------------------------------------------------------------------

function Dashboard({ state, onState }: { state: AppState; onState(s: AppState): void }) {
  const { team, settings, status } = state;
  const set = async (patch: Partial<AppState['settings']>) => onState(await api().updateSettings(patch));
  const serverDot = status.server === 'connected' || status.server === 'standby' ? 'ok' : status.server === 'error' ? 'bad' : 'warn';

  // Opened via "Tastaturkürzel …" in the tray menu: the overview comes first.
  const keysFirst = location.hash.endsWith('/keys');

  return (
    <>
      {keysFirst && <HotkeyCard groups={state.hotkeys} />}
      {state.update.phase === 'ready' && (
        <section className="card update-ready">
          <h2>Update bereit</h2>
          <p>StintView {state.update.version} ist geladen. Die Installation dauert einige Sekunden, danach startet StintView von selbst neu.</p>
          <button className="btn" onClick={() => api().installUpdate()}>Jetzt aktualisieren</button>
        </section>
      )}
      <section className="card">
        <h2>Status</h2>
        <ul className="status">
          <li><Dot kind={serverDot} />Team-Server{status.server === 'error' ? `: ${status.serverText.replace(/^server error: /, '')}` : status.server === 'offline' ? ': keine Verbindung' : ': verbunden'}</li>
          <li><Dot kind={status.iracing ? 'ok' : 'idle'} />iRacing{status.iracing ? ' läuft' : ' nicht aktiv'}</li>
          <li><Dot kind={status.inCar ? (status.server === 'standby' ? 'warn' : 'ok') : 'idle'} />{status.inCar ? (status.server === 'standby' ? 'Im Auto – Standby (anderer Fahrer sendet noch)' : 'Du fährst – dein Team sieht deine Daten') : 'Nicht im Auto'}</li>
          {settings.vr && <li><Dot kind={status.vr === 'connected' ? 'ok' : 'warn'} />SteamVR{status.vr === 'connected' ? ' verbunden' : ' – wartet auf SteamVR'}</li>}
          {settings.server && <li><Dot kind={status.relay === 'running' ? 'ok' : 'bad'} />Team-Server auf diesem PC{status.relay === 'running' ? ' läuft' : ' gestoppt'}</li>}
        </ul>

      </section>

      <section className="card">
        <h2>Anzeigen</h2>
        <Toggle checked={settings.overlay} onChange={(v) => set({ overlay: v })} label="Overlay am Monitor" hint="iRacing im randlosen Fenstermodus." />
        {status.overlay && (
          <div className="edit-row">
            <button className="btn ghost" onClick={async () => onState(await api().setEditMode(!status.editing))}>
              {status.editing ? 'Verschieben beenden' : 'Anzeigen verschieben'}
            </button>
            <small>{status.editHotkey ? `oder ${status.editHotkey}` : 'Kein Tastenkürzel frei – bitte diesen Knopf nutzen.'}</small>
          </div>
        )}
        <Toggle checked={settings.vr} onChange={(v) => set({ vr: v })} label="VR-Overlay (SteamVR)" hint="Panels in der Brille. Strg+Umschalt+V wählt, Pfeiltasten verschieben." />
        <PanelTable panels={settings.panels} onChange={(panels) => set({ panels })} />
        <OpacitySliders opacity={settings.opacity} onChange={(opacity) => set({ opacity })} />
        <p className="hint cam-keys">
          Als Zuschauer bei Gelb für deinen Fahrer: <b>{state.cameraHotkeys.incident ?? '–'}</b> springt mit der Kamera zum Unfall vor ihm,{' '}
          <b>{state.cameraHotkeys.back ?? '–'}</b> zurück zu ihm. Am Monitor gibt es dafür auch Knöpfe in der Kopfzeile.{' '}
          <a href="#keys" onClick={(e) => { e.preventDefault(); document.getElementById('keys')?.scrollIntoView({ behavior: 'smooth' }); }}>Alle Tastaturkürzel</a>
        </p>
      </section>

      <section className="card">
        <h2>Team</h2>
        <dl className="team">
          <dt>Team</dt><dd>{team?.teamName}</dd>
          <dt>Du</dt><dd>{team?.memberName}</dd>
          <dt>Server</dt><dd className="mono">{team?.serverUrl}</dd>
          <dt>Einladungscode</dt><dd className="mono">{team?.inviteCode}</dd>
        </dl>
        <Toggle checked={settings.autostart} disabled={!state.autostartAvailable} onChange={(v) => set({ autostart: v })} label="Mit Windows starten" hint="StintView läuft dann unauffällig im Infobereich der Taskleiste." />
        <Toggle checked={settings.server} onChange={(v) => set({ server: v })} label={`Team-Server auf diesem PC (Port ${settings.serverPort})`} hint="Nur für den Teamchef." />
        <button className="btn ghost" onClick={async () => onState(await api().leave())}>Team verlassen …</button>
      </section>

      {!keysFirst && <HotkeyCard groups={state.hotkeys} />}

      <p className="foot">
        Version {state.version}
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
        Du kannst dieses Fenster schließen – StintView läuft im Infobereich der Taskleiste weiter.
      </p>
    </>
  );
}

/** All global hotkeys with the key each function actually got ("Tastaturkürzel" in the tray menu). */
function HotkeyCard({ groups }: { groups: HotkeyGroup[] }) {
  return (
    <section className="card" id="keys">
      <h2>Tastaturkürzel</h2>
      <p className="hint">Gelten überall, auch während iRacing im Vordergrund ist. Ist ein Kürzel schon von einem anderen Programm belegt, nimmt StintView das nächste freie.</p>
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
                    {k.key ? <kbd>{k.key}</kbd> : <span className="bad">belegt – bitte Knopf nutzen</span>}
                    {k.taken.length > 0 && <small>belegt von anderem Programm: {k.taken.join(' / ')}</small>}
                    {k.alternatives.length > 0 && <small>Ausweich: {k.alternatives.join(' / ')}</small>}
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

/** Background opacity of the panels, separately for monitor and VR; applied live while dragging. */
function OpacitySliders({ opacity, onChange }: {
  opacity: AppState['settings']['opacity'];
  onChange(o: AppState['settings']['opacity']): void;
}) {
  const [value, setValue] = useState(opacity);
  useEffect(() => setValue(opacity), [opacity.monitor, opacity.vr]);
  // Save at most every 150 ms while the slider moves.
  useEffect(() => {
    if (value.monitor === opacity.monitor && value.vr === opacity.vr) return;
    const t = setTimeout(() => onChange(value), 150);
    return () => clearTimeout(t);
  }, [value.monitor, value.vr]);
  const row = (where: 'monitor' | 'vr', label: string) => (
    <label className="opacity-row">
      <span>{label}</span>
      <input type="range" min={0} max={100} step={5} value={value[where]}
        onChange={(e) => setValue({ ...value, [where]: Number(e.target.value) })} />
      <b>{value[where]} %</b>
    </label>
  );
  return (
    <div className="opacity">
      <div className="opacity-title">Hintergrund der Anzeigen <small>0 % = durchsichtig, 100 % = deckend; die Schrift bleibt immer voll sichtbar</small></div>
      {row('monitor', 'Monitor')}
      {row('vr', 'VR')}
    </div>
  );
}

const PANEL_NAMES: [string, string][] = [
  ['header', 'Kopfzeile (Fahrer, Gelb-Knopf)'],
  ['inputs', 'Eingaben (Lenkung, Gas, Bremse)'],
  ['fuel', 'Sprit'],
  ['tyres', 'Reifen'],
  ['weather', 'Wetter'],
  ['standings', 'Position (Reihenfolge auf der Strecke)'],
];

/** Which displays appear on the monitor overlay and as VR panels. */
function PanelTable({ panels, onChange }: {
  panels: AppState['settings']['panels'];
  onChange(p: AppState['settings']['panels']): void;
}) {
  const toggle = (id: string, where: 'monitor' | 'vr') =>
    onChange({ ...panels, [id]: { ...panels[id]!, [where]: !panels[id]?.[where] } });
  return (
    <table className="panels">
      <thead><tr><th>Anzeige</th><th>Monitor</th><th>VR</th></tr></thead>
      <tbody>
        {PANEL_NAMES.map(([id, name]) => (
          <tr key={id}>
            <td>{name}</td>
            {(['monitor', 'vr'] as const).map((where) => (
              <td key={where}>
                <input type="checkbox" aria-label={`${name} – ${where === 'vr' ? 'VR' : 'Monitor'}`}
                  checked={Boolean(panels[id]?.[where])} onChange={() => toggle(id, where)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

function Emblem() {
  return (
    <svg className="emblem" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="none" stroke="#e5e5e5" strokeOpacity="0.35" strokeWidth="2.5" />
      <g transform="skewX(-14) translate(8 0)">
        <rect x="18" y="15" width="28" height="34" rx="9" fill="none" stroke="#e5e5e5" strokeWidth="7" />
      </g>
      <polygon points="9,47 55,17 58,20.5 13,50.5" fill="#d10f0f" />
    </svg>
  );
}

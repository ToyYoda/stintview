import { useEffect, useState } from 'react';
import { t } from '../i18n.ts';
import type { FeedState } from '../feed.ts';
import { CameraBar } from './CameraBar.tsx';

/**
 * Active driver, connection and data age, plus the spectator camera bar
 * (clickable on the monitor overlay, hotkey hints on VR panels).
 */
export function HeaderWidget({ state, interactive = false }: { state: FeedState; interactive?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const age = state.lastData ? (now - state.lastData) / 1000 : null;
  const driver = state.active?.driverName;
  let dot = 'ok';
  let text = driver ? `${driver}` : t('header.nobody');
  // Own data (no team server): this PC's driver or nobody, and why it isn't the team's.
  if (state.local) {
    if (!driver) { dot = 'idle'; text = t('header.localIdle'); }
    else if (age !== null && age > 3) dot = 'warn';
  }
  else if (state.conn === 'no-config') { dot = 'bad'; text = t('header.noConfig'); }
  else if (state.conn === 'error') { dot = 'bad'; text = state.error ?? t('header.error'); }
  else if (state.conn === 'connecting') { dot = 'warn'; text = t('header.connecting'); }
  else if (!driver) dot = 'idle';
  else if (age !== null && age > 3) dot = 'warn';
  const why = !state.local ? null
    : state.conn === 'connected' && state.otherSession ? t('header.localOtherSession')
      : state.conn === 'no-config' ? t('header.localNoTeam')
        : state.conn === 'error' ? t('header.localError', { error: state.error ?? t('header.error') })
          : t('header.localOffline');

  return (
    <div className="panel header">
      <div className="header-row">
        <span className={`dot ${dot}`} />
        <span className="driver">{text}</span>
        {driver && state.session && <span className="label">{state.session.car} · {state.session.track}</span>}
        {driver && age !== null && age > 3 && <span className="label warn-text">{t('header.dataAge', { s: Math.round(age) })}</span>}
      </div>
      {why && <div className="label local-why">{why}</div>}
      {/* Jumping to incidents is for teammates watching the team car, not for your own session. */}
      {!state.local && <CameraBar state={state} interactive={interactive} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { YELLOW_FLAGS } from '@stintview/protocol';
import type { FeedState } from '../feed.ts';

/** Keep the banner up this long after the warning clears (local yellows last ~10 s). */
const HOLD_MS = 20_000;
const RESULT_MS = 7000;
/** A click shows "…" until iRacing confirms (the recorder checks for 1.5 s). */
const PENDING_MS = 2500;
const RESULT_FAILED_MS = 15_000; // failures carry longer hints (e.g. iRacing running as administrator)

interface CameraState {
  t: 'camera-state';
  available: boolean;
  sessionId: string;
  camCarIdx: number;
  camCarNumber: number;
  camCarName: string;
}
interface CameraResult { t: 'camera-result'; ok: boolean; text: string }
interface Hotkeys { incident: string | null; back: string | null }

/**
 * Spectator camera controls: on a yellow for our driver, jump the local iRacing camera to
 * the incident ahead; while looking at another car, jump back. Buttons on the monitor
 * overlay (`interactive`), hotkey hints on VR panels.
 */
export function CameraBar({ state, interactive }: { state: FeedState; interactive: boolean }) {
  const api = window.stintview;
  const [camera, setCamera] = useState<CameraState | null>(null);
  const [result, setResult] = useState<(CameraResult & { at: number }) | null>(null);
  const [hotkeys, setHotkeys] = useState<Hotkeys>({ incident: null, back: null });
  const [holdUntil, setHoldUntil] = useState(0);
  /** Last car named by the driver's "Unfall voraus" (kept while the banner is held). */
  const [lastHazard, setLastHazard] = useState<{ carIdx: number; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (!api?.onCamera) return;
    api.getCameraInfo().then((info) => {
      if (info.state) setCamera(info.state as CameraState);
      setHotkeys(info.hotkeys);
    });
    api.onCamera((m) => {
      if (m.t === 'camera-state') setCamera(m as unknown as CameraState);
      else {
        setResult({ ...(m as unknown as CameraResult), at: Date.now() });
        setPending(null);
      }
    });
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [api]);

  const driving = Boolean(state.active?.driverName);
  const yellowNow = driving && Boolean((state.status?.flags ?? 0) & YELLOW_FLAGS);
  // The driver's recorder watches the cars ahead (iRacing's spotter call isn't in the SDK).
  const hazard = driving && state.hazard?.active ? state.hazard : null;
  const warningNow = yellowNow || hazard !== null;
  useEffect(() => {
    if (warningNow) setHoldUntil(Date.now() + HOLD_MS);
  }, [warningNow, state.status, state.hazard]);
  useEffect(() => {
    if (!hazard) return;
    const what = hazard.reason === 'offtrack' ? 'neben der Strecke' : 'steht';
    setLastHazard({ carIdx: hazard.carIdx, text: `#${hazard.carNumber} ${hazard.driverName} · ${hazard.distance} m · ${what}` });
  }, [hazard?.carIdx, hazard?.distance, hazard?.reason]);
  useEffect(() => {
    // Forget the car once the banner is gone, so a later yellow doesn't show a stale one.
    if (!warningNow && now >= holdUntil && lastHazard) setLastHazard(null);
  }, [warningNow, now, holdUntil, lastHazard]);
  useEffect(() => {
    // Hotkey jumps go to the same car as the button.
    api?.setHazard?.(warningNow || now < holdUntil ? lastHazard?.carIdx ?? null : null);
  }, [lastHazard, warningNow, holdUntil > now]);

  if (!api?.onCamera || !driving) return null;
  const session = state.session;
  const yellow = warningNow || now < holdUntil;
  const sameSession = Boolean(camera && session && camera.sessionId === session.sessionId);
  const away = Boolean(camera?.available && sameSession && camera.camCarIdx >= 0 && camera.camCarIdx !== session?.carIdx);
  const showResult = result && now - result.at < (result.ok ? RESULT_MS : RESULT_FAILED_MS);
  if (!yellow && !away && !showResult) return null;

  const canJump = Boolean(camera?.available && sameSession);
  const busy = pending !== null && now - pending < PENDING_MS;
  const hover = (on: boolean) => interactive && api.setInteractive(on);
  const run = (action: 'incident' | 'back') => {
    setPending(Date.now());
    api.camera(action, action === 'incident' ? lastHazard?.carIdx : undefined);
  };
  // Both buttons always sit in the same place (first row, fixed width). In the race on
  // 29.09. the bar re-laid out under the pointer and repeated clicks hit the other button.
  const button = (label: string, key: string | null, action: 'incident' | 'back', enabled: boolean) =>
    interactive ? (
      <button type="button" className="cam-btn" disabled={!enabled || busy} onClick={() => run(action)}
        onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
        {busy && enabled ? '…' : label}
      </button>
    ) : (
      enabled && key && <span className="cam-key">{key}: {label}</span>
    );

  return (
    <div className="camera-bar">
      {canJump ? (
        <div className="cam-actions">
          {button('Zum Unfall', hotkeys.incident, 'incident', yellow)}
          {button('Zurück', hotkeys.back, 'back', away)}
        </div>
      ) : (
        yellow && <span className="cam-hint">{camera?.available ? 'Du schaust eine andere iRacing-Session' : 'Zum Springen in iRacing zuschauen'}</span>
      )}
      {yellow && (
        <div className={warningNow ? 'cam-row yellow live' : 'cam-row yellow'}>
          <span className="cam-flag">{lastHazard ? 'Unfall voraus' : 'Gelb voraus'}</span>
          {lastHazard && <span className="cam-hint">{lastHazard.text}</span>}
        </div>
      )}
      {away && <div className="cam-hint">Kamera: #{camera!.camCarNumber} {camera!.camCarName} · „Zurück“ = {state.active?.driverName ?? 'dein Fahrer'}</div>}
      {showResult && <div className={result.ok ? 'cam-result' : 'cam-result bad'}>{result.text}</div>}
    </div>
  );
}

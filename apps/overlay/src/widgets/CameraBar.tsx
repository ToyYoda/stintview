import { useEffect, useState } from 'react';
import { YELLOW_FLAGS } from '@stintview/protocol';
import type { FeedState } from '../feed.ts';

/** Keep the yellow banner up this long after the flag clears (local yellows last ~10 s). */
const YELLOW_HOLD_MS = 20_000;
const RESULT_MS = 7000;

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
  const [yellowUntil, setYellowUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!api?.onCamera) return;
    api.getCameraInfo().then((info) => {
      if (info.state) setCamera(info.state as CameraState);
      setHotkeys(info.hotkeys);
    });
    api.onCamera((m) => {
      if (m.t === 'camera-state') setCamera(m as unknown as CameraState);
      else setResult({ ...(m as unknown as CameraResult), at: Date.now() });
    });
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [api]);

  const driving = Boolean(state.active?.driverName);
  const yellowNow = driving && Boolean((state.status?.flags ?? 0) & YELLOW_FLAGS);
  useEffect(() => {
    if (yellowNow) setYellowUntil(Date.now() + YELLOW_HOLD_MS);
  }, [yellowNow, state.status]);

  if (!api?.onCamera || !driving) return null;
  const session = state.session;
  const yellow = yellowNow || now < yellowUntil;
  const sameSession = Boolean(camera && session && camera.sessionId === session.sessionId);
  const away = Boolean(camera?.available && sameSession && camera.camCarIdx >= 0 && camera.camCarIdx !== session?.carIdx);
  const showResult = result && now - result.at < RESULT_MS;
  if (!yellow && !away && !showResult) return null;

  const canJump = Boolean(camera?.available && sameSession);
  const hover = (on: boolean) => interactive && api.setInteractive(on);
  const button = (label: string, key: string | null, action: 'incident' | 'back') =>
    interactive ? (
      <button type="button" className="cam-btn" onClick={() => api.camera(action)} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
        {label}
      </button>
    ) : (
      key && <span className="cam-key">{key}: {label}</span>
    );

  return (
    <div className="camera-bar">
      {yellow && (
        <div className={yellowNow ? 'cam-row yellow live' : 'cam-row yellow'}>
          <span className="cam-flag">Gelb voraus</span>
          {canJump
            ? button('Zum Unfall', hotkeys.incident, 'incident')
            : <span className="cam-hint">{camera?.available ? 'Du schaust eine andere iRacing-Session' : 'Zum Springen in iRacing zuschauen'}</span>}
        </div>
      )}
      {away && (
        <div className="cam-row">
          <span className="cam-hint">Kamera: #{camera!.camCarNumber} {camera!.camCarName}</span>
          {button(`Zurück zu ${state.active?.driverName ?? 'deinem Fahrer'}`, hotkeys.back, 'back')}
        </div>
      )}
      {showResult && <div className={result.ok ? 'cam-result' : 'cam-result bad'}>{result.text}</div>}
    </div>
  );
}

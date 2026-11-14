import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.ts';
import type { VideoOptions } from '../feed.ts';

/** Width of the video in CSS px at 100 % (the size slider scales it). */
const WIDTH = 480;
/** Capture rate: enough for a camera, light on the overlay windows and VR uploads. */
const MAX_FPS = 15;
/** Window gone or capture refused: try again after this long. */
const RETRY_MS = 5000;

type Status = 'none' | 'searching' | 'missing' | 'error' | 'live';

/**
 * Video of another window – e.g. Discord's pop-out of a camera or screen share (wish 14.11.2026;
 * Discord gives other programs no stream). The window is chosen in the StintView window; it may be
 * covered by other windows, but not minimised (Windows then sends no picture). Crop: percent cut
 * off each side (Discord's buttons and frame).
 */
export function VideoWidget({ options }: { options?: VideoOptions | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('none');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const want = options?.window ?? null;

  useEffect(() => {
    if (!want || !window.stintview?.videoSource) {
      setStatus('none');
      return;
    }
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
      if (video.current) video.current.srcObject = null;
    };
    const retry = (s: Status, ms = RETRY_MS) => {
      stop();
      setStatus(s);
      setSize(null);
      if (!stopped) timer = setTimeout(start, ms);
    };
    async function start() {
      setStatus((s) => (s === 'live' ? s : 'searching'));
      const source = await window.stintview!.videoSource!(want!).catch(() => null);
      if (stopped) return;
      if (!source) return retry('missing');
      try {
        // Chromium's desktop capture (Electron): the legacy "mandatory" constraints are the way to name the window.
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: MAX_FPS } },
        } as unknown as MediaStreamConstraints);
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
      } catch {
        return retry('error');
      }
      // The window was closed: look for it again (Discord reopens the pop-out with a new window).
      stream.getVideoTracks()[0]?.addEventListener('ended', () => retry('missing', 1000));
      if (video.current) video.current.srcObject = stream;
      setStatus('live');
    }
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stop();
    };
  }, [want?.id, want?.name]);

  const crop = options?.crop ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const fx = Math.max(0.2, 1 - (crop.left + crop.right) / 100);
  const fy = Math.max(0.2, 1 - (crop.top + crop.bottom) / 100);
  // The whole picture is WIDTH / fx wide, so that the part left over is WIDTH wide.
  const full = WIDTH / fx;
  const fullH = size ? (full * size.h) / size.w : (WIDTH * 9) / 16;
  const live = status === 'live' && size !== null;
  const boxH = live ? fullH * fy : (WIDTH * 9) / 16;

  return (
    <div className="panel video-panel">
      <div className="video-box" style={{ width: WIDTH, height: boxH }}>
        <video ref={video} autoPlay muted playsInline
          style={live ? { width: full, height: fullH, marginLeft: -(full * crop.left) / 100, marginTop: -(fullH * crop.top) / 100 } : { display: 'none' }}
          onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onResize={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setSize({ w: v.videoWidth, h: v.videoHeight });
          }} />
        {!live && (
          <div className="video-note label">
            {status === 'none' ? t('video.none')
              : status === 'missing' ? t('video.missing', { name: want?.name ?? '' })
                : status === 'error' ? t('video.error', { name: want?.name ?? '' })
                  : t('video.searching')}
          </div>
        )}
      </div>
    </div>
  );
}

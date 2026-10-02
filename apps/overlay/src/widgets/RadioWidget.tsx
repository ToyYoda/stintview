import { useEffect, useState } from 'react';
import { t } from '../i18n.ts';
import type { RadioState } from '../feed.ts';

/** "Sent" tick on a button. */
const SENT_MS = 1500;

/**
 * Buttons to send the team messages defined in the StintView window, each with its hotkey in
 * small print. Clickable on the monitor overlay (`interactive`); VR panels can't be clicked,
 * there the hotkeys do it. Invisible while this PC's user is driving.
 */
export function RadioWidget({ interactive }: { interactive: boolean }) {
  const api = window.stintview;
  const [radio, setRadio] = useState<RadioState | null>(null);
  const [sent, setSent] = useState<{ id: string; at: number } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    api?.getRadio?.().then(setRadio);
    api?.onRadio?.(setRadio);
  }, [api]);
  // Panel gone (you got in the car) while the pointer was on a button: make the overlay
  // click-through again, otherwise it would keep catching the mouse.
  const hidden = !radio || radio.driving;
  useEffect(() => {
    if (hidden && interactive) api?.setInteractive(false);
  }, [hidden, interactive, api]);
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setTick((n) => n + 1), SENT_MS);
    return () => clearTimeout(timer);
  }, [sent]);

  if (!api?.sendMessage || !radio || radio.driving) return null;
  const hover = (on: boolean) => interactive && api.setInteractive(on);
  const send = async (id: string) => {
    if (await api.sendMessage!(id)) setSent({ id, at: Date.now() });
  };
  return (
    <div className="panel radio-panel">
      <div className="title">{t('radio.title')}<span className="hint">{interactive ? t('radio.hintClick') : t('radio.hintKeys')}</span></div>
      {radio.messages.length === 0 ? (
        <div className="label">{t('radio.empty')}</div>
      ) : (
        <div className="radio-grid">
          {radio.messages.map((m) => {
            const done = sent?.id === m.id && Date.now() - sent.at < SENT_MS;
            return (
              <button key={m.id} type="button" className={`radio-btn color-${m.color}`} disabled={!interactive}
                onClick={() => send(m.id)} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
                <span className="radio-text">{done ? `✓ ${t('radio.sent')}` : m.text}</span>
                {m.key && <span className="radio-key">{m.key}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

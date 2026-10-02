import { useEffect, useState } from 'react';
import { t } from '../i18n.ts';
import type { ReceivedMessage } from '../feed.ts';

/** A message is shown this long after it arrives, then the panel is empty again. */
const SHOW_MS = 10_000;

/**
 * Team message (usually from the spotter): large in its colour with the sender, for 10 s
 * after it arrives. Messages from before the overlay connected (snapshot) are not shown.
 * Without a current message the panel is invisible, except a placeholder while moving panels.
 */
export function MessagesWidget({ messages, placeholder = false }: { messages: ReceivedMessage[]; placeholder?: boolean }) {
  const [, setNow] = useState(Date.now()); // re-render when the message expires
  const newest = messages[messages.length - 1];
  const until = newest?.rx !== undefined ? newest.rx + SHOW_MS : 0;
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), until - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [until]);

  if (!newest || Date.now() >= until) {
    if (placeholder) return <div className="panel msg-panel"><div className="label">{t('msg.none')}</div></div>;
    // Invisible but keeps its size: VR panels adapt their size only every 2 s, a message
    // appearing in a panel that had shrunk would be cut off at first.
    return (
      <div className="panel msg-panel msg-idle" aria-hidden="true">
        <div className="msg-main"><div className="msg-text">&nbsp;</div><div className="msg-meta">&nbsp;</div></div>
      </div>
    );
  }
  return (
    <div className="panel msg-panel">
      <div className={`msg-main color-${newest.color}`}>
        <div className="msg-text">{newest.text}</div>
        <div className="msg-meta">{newest.from}</div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { t } from '../i18n.ts';
import type { ReceivedMessage } from '../feed.ts';

/** A new message stands out this long. */
const FRESH_MS = 10_000;
const OLDER = 3;

/**
 * Team messages (usually from the spotter): the newest one large in its colour – highlighted
 * for 10 s after it arrives – and the three before it small, with sender and age.
 */
export function MessagesWidget({ messages }: { messages: ReceivedMessage[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const newest = messages[messages.length - 1];
  const older = messages.slice(-1 - OLDER, -1).reverse();
  if (!newest) return <div className="panel msg-panel"><div className="label">{t('msg.none')}</div></div>;
  const fresh = newest.rx !== undefined && now - newest.rx < FRESH_MS;
  return (
    <div className="panel msg-panel">
      <div className={`msg-main color-${newest.color}${fresh ? ' fresh' : ''}`}>
        <div className="msg-text">{newest.text}</div>
        <div className="msg-meta">{newest.from} · {age(newest, now)}</div>
      </div>
      {older.map((m) => (
        <div key={m.id} className={`msg-old color-${m.color}`}>
          <span className="msg-dot" />
          <span className="msg-old-text">{m.text}</span>
          <span className="msg-meta">{m.from} · {age(m, now)}</span>
        </div>
      ))}
    </div>
  );
}

/** "jetzt", "vor 40 s", "vor 3 min" – from the local arrival time where known. */
function age(m: ReceivedMessage, now: number) {
  const s = Math.max(0, Math.round((now - (m.rx ?? m.at)) / 1000));
  if (s < 5) return t('msg.now');
  if (s < 60) return t('msg.secondsAgo', { n: s });
  return t('msg.minutesAgo', { n: Math.floor(s / 60) });
}

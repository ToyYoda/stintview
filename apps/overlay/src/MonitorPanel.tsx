import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { t } from './i18n.ts';

/** Transparent margin around the panel in its window (as PAD in overlay-window.cjs). */
const PAD = 8;
const MIN_SCALE = 0.5, MAX_SCALE = 2;
/** Where the overlay page kept panel positions up to 0.23 (handed to the app once). */
const LEGACY_KEYS = ['stintview.positions', 'stintview.positions.driving', 'stintview.positions.watching'];

/** Reports the size of `ref` to the app (0 × 0 = nothing to show) whenever it changes. */
function useReportSize(ref: RefObject<HTMLElement | null>, empty: () => boolean = () => false) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      window.stintview?.reportSize?.(empty() ? 0 : r.width, empty() ? 0 : r.height);
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    report();
    return () => ro.disconnect();
  }, []);
}

/**
 * One panel in its own small window (monitor overlay since 0.24): the window follows the panel's
 * size; in edit mode the panel is the window's drag area and the corner handle resizes it.
 */
export function MonitorPanel({ edit, scale, onResized, children }: {
  edit: boolean; scale: number; onResized(scale: number): void; children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  // A panel without content (pit stop panel in practice, no message, radio while driving): hidden.
  useReportSize(host, () => !frame.current || frame.current.offsetWidth === 0 || frame.current.offsetHeight === 0);
  useEffect(() => {
    try {
      window.stintview?.sendLegacyPositions?.(Object.fromEntries(LEGACY_KEYS.map((k) => [k, localStorage.getItem(k)])));
    } catch { /* nothing to hand over */ }
  }, []);
  const s = preview ?? scale;
  return (
    <div ref={host} className={edit ? 'panel-host edit' : 'panel-host'} style={{ padding: PAD }}>
      <div ref={frame} className="panel-frame" style={{ zoom: s }}>{children}</div>
      {edit && (
        <ResizeHandle scale={s} host={host} onResize={setPreview}
          onResized={(v) => { setPreview(null); onResized(v); }} />
      )}
    </div>
  );
}

/** Corner handle: the panel grows along the drag towards bottom right, in 5 % steps. */
function ResizeHandle({ scale, host, onResize, onResized }: {
  scale: number; host: RefObject<HTMLDivElement | null>; onResize(scale: number): void; onResized(scale: number): void;
}) {
  const start = useRef<{ px: number; py: number; w: number; h: number; scale: number; last: number } | null>(null);
  return (
    <div
      className="resize-handle"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = host.current!.getBoundingClientRect();
        // Screen coordinates: the window grows under the pointer.
        start.current = { px: e.screenX, py: e.screenY, w: r.width - 2 * PAD, h: r.height - 2 * PAD, scale, last: scale };
      }}
      onPointerMove={(e) => {
        const r = start.current;
        if (!r) return;
        // Drag projected onto the panel's diagonal.
        const dx = e.screenX - r.px, dy = e.screenY - r.py;
        const factor = 1 + (dx * r.w + dy * r.h) / (r.w * r.w + r.h * r.h);
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(r.scale * factor * 20) / 20));
        if (next !== r.last) { r.last = next; onResize(next); }
      }}
      onPointerUp={() => {
        const r = start.current;
        start.current = null;
        if (r && r.last !== r.scale) onResized(r.last); else onResize(scale);
      }}
    />
  );
}

/** Banner while moving panels: what to do, the hotkey that ends it, and "Done". */
export function EditBanner() {
  const box = useRef<HTMLDivElement>(null);
  const [hotkey, setHotkey] = useState<string | null>(null);
  useReportSize(box);
  useEffect(() => { window.stintview?.onEditMode((_on, key) => setHotkey(key)); }, []);
  return (
    <div ref={box} className="banner-page">
      <div className="edit-banner">
        {t('edit.banner')}{hotkey ? ` · ${t('edit.endsWith', { key: hotkey })}` : ''}
        <button type="button" onClick={() => window.stintview?.setEditMode(false)}>{t('edit.done')}</button>
      </div>
    </div>
  );
}

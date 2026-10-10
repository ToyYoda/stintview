import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isPracticeOrQuali, useTeamFeed } from './feed.ts';
import { FuelWidget } from './widgets/FuelWidget.tsx';
import { HeaderWidget } from './widgets/HeaderWidget.tsx';
import { InputsWidget } from './widgets/InputsWidget.tsx';
import { TyresWidget } from './widgets/TyresWidget.tsx';
import { WeatherWidget } from './widgets/WeatherWidget.tsx';
import { StandingsWidget } from './widgets/StandingsWidget.tsx';
import { DuelWidget } from './widgets/DuelWidget.tsx';
import { MessagesWidget } from './widgets/MessagesWidget.tsx';
import { RadioWidget } from './widgets/RadioWidget.tsx';
import type { DuelOptions, PanelConfig, StandingsOptions } from './feed.ts';
import { setLang, t, useLang } from './i18n.ts';
import { PitWidget } from './widgets/PitWidget.tsx';

type WidgetId = 'header' | 'inputs' | 'fuel' | 'tyres' | 'weather' | 'standings' | 'duel' | 'pitstop' | 'messages' | 'radio';
type Positions = Record<WidgetId, { x: number; y: number }>;

// Side by side on a 1920 px wide screen (panels are ~320 px, inputs ~440, standings ~500 wide).
const DEFAULT_POSITIONS: Positions = {
  header: { x: 40, y: 40 },
  inputs: { x: 40, y: 100 },
  fuel: { x: 500, y: 100 },
  tyres: { x: 840, y: 100 },
  standings: { x: 1420, y: 100 },
  radio: { x: 40, y: 480 },
  messages: { x: 660, y: 560 },
  weather: { x: 1060, y: 480 },
  pitstop: { x: 1420, y: 600 }, // below standings, which grows to ~450 px with lapping rows
  duel: { x: 700, y: 860 },
};
const STORAGE_KEY = 'stintview.positions';

function loadPositions(): Positions {
  try {
    return { ...DEFAULT_POSITIONS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return DEFAULT_POSITIONS;
  }
}

/**
 * `#/` – all widgets on a transparent full-screen overlay (Electron).
 * `#/widget/<id>` – a single widget, for VR panels (SteamVR overlay / OpenKneeboard).
 */
export function App() {
  useLang(); // re-render all widgets when the language changes
  const { state, inputs } = useTeamFeed();
  const [route, setRoute] = useState(location.hash);
  // Browser: always movable. Electron: toggled by hotkey (desktop) or panel selection (VR).
  const [edit, setEdit] = useState(!window.stintview && !location.hash.startsWith('#/widget/'));
  const [positions, setPositions] = useState(loadPositions);
  const [hotkey, setHotkey] = useState<string | null>(null);
  // Widgets chosen for the monitor overlay in the StintView window (null = all, e.g. in a browser).
  const [shown, setShown] = useState<string[] | null>(null);
  // Size factor and options per panel from the StintView window.
  const [config, setConfig] = useState<PanelConfig | null>(null);
  // The overlay window spans all monitors; positions are stored relative to the main monitor.
  const [main, setMain] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Size while resizing with the mouse (edit mode), before the StintView window confirms it.
  const [resizing, setResizing] = useState<{ id: WidgetId; scale: number } | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(location.hash);
    addEventListener('hashchange', onHash);
    window.stintview?.onEditMode((on, key) => {
      setEdit(on);
      setHotkey(key);
    });
    window.stintview?.onPanels?.(setShown);
    window.stintview?.onOverlayArea?.(setMain);
    window.stintview?.onPanelConfig?.(setConfig);
    window.stintview?.onLanguage?.(setLang);
    window.stintview?.onOpacity?.((v) => document.documentElement.style.setProperty('--panel-alpha', String(v)));
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const widgets: Record<WidgetId, ReactNode> = {
    // Buttons only on the desktop overlay; VR panels / browser widgets show hotkeys instead.
    header: <HeaderWidget state={state} interactive={Boolean(window.stintview) && !location.hash.startsWith('#/widget/')} />,
    inputs: <InputsWidget inputs={inputs} />,
    fuel: <FuelWidget fuel={state.fuel} status={state.status} session={state.session} />,
    tyres: <TyresWidget tyres={state.tyres} status={state.status} />,
    weather: <WeatherWidget weather={state.weather} />,
    standings: <StandingsWidget standings={state.standings} options={config?.standings?.options as StandingsOptions | null | undefined} />,
    duel: <DuelWidget standings={state.standings} options={config?.duel?.options as DuelOptions | null | undefined} />,
    // Not shown in practice/qualifying, except while moving panels (so it can be placed).
    pitstop: isPracticeOrQuali(state) && !edit ? null : <PitWidget plan={state.pitplan} />,
    // Empty without a current message; a placeholder while moving panels, so it can be placed.
    messages: <MessagesWidget messages={state.messages} placeholder={edit} />,
    // Clickable on the desktop overlay only; VR panels show the hotkeys.
    radio: <RadioWidget interactive={Boolean(window.stintview) && !location.hash.startsWith('#/widget/')} />,
  };

  const single = /^#\/widget\/(\w+)/.exec(route)?.[1] as WidgetId | undefined;
  if (single && single in widgets) return <div className={edit ? 'single selected' : 'single'}>{widgets[single]}</div>;

  const ox = main?.x ?? 0, oy = main?.y ?? 0;
  // A panel left on a monitor that is gone (or a smaller one) is pulled back into view.
  const onScreen = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(0, p.x + ox), Math.max(0, innerWidth - 120)),
    y: Math.min(Math.max(0, p.y + oy), Math.max(0, innerHeight - 60)),
  });
  // Window coordinates from dragging -> relative to the main monitor.
  const move = (id: WidgetId, x: number, y: number) =>
    setPositions((p) => {
      const next = { ...p, [id]: { x: x - ox, y: y - oy } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* not persisted */ }
      return next;
    });

  return (
    <div className={edit ? 'overlay edit' : 'overlay'}>
      {edit && window.stintview && (
        <div className="edit-banner" style={main ? { left: main.x + main.width / 2, top: main.y + 8 } : undefined}>
          {t('edit.banner')}{hotkey ? ` · ${t('edit.endsWith', { key: hotkey })}` : ''}
          <button type="button" onClick={() => window.stintview?.setEditMode(false)}>{t('edit.done')}</button>
        </div>
      )}
      {(Object.keys(widgets) as WidgetId[]).filter((id) => !shown || shown.includes(id)).map((id) => (
        <Draggable key={id} pos={onScreen(positions[id])} enabled={edit} onMove={(x, y) => move(id, x, y)}
          scale={resizing?.id === id ? resizing.scale : config?.[id]?.scale ?? 1}
          onResize={(scale) => setResizing({ id, scale })}
          onResized={(scale) => {
            // Saved as the panel's size in the settings; comes back as panel config.
            setConfig((c) => (c?.[id] ? { ...c, [id]: { ...c[id], scale } } : c));
            setResizing(null);
            window.stintview?.setPanelSize?.(id, Math.round(scale * 100));
          }}>
          {/* Size from the StintView window or the corner handle; VR panels are sized in the headset instead. */}
          <div style={{ zoom: resizing?.id === id ? resizing.scale : config?.[id]?.scale ?? 1 }}>{widgets[id]}</div>
        </Draggable>
      ))}
    </div>
  );
}

const MIN_SCALE = 0.5, MAX_SCALE = 2;

function Draggable({ pos, enabled, onMove, scale, onResize, onResized, children }: {
  pos: { x: number; y: number }; enabled: boolean; onMove(x: number, y: number): void;
  scale: number; onResize(scale: number): void; onResized(scale: number): void; children: ReactNode;
}) {
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const resize = useRef<{ px: number; py: number; w: number; h: number; scale: number; last: number } | null>(null);
  return (
    <div
      className="draggable"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => {
        if (!enabled) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s) onMove(Math.max(0, s.x + e.clientX - s.px), Math.max(0, s.y + e.clientY - s.py));
      }}
      onPointerUp={() => { start.current = null; }}
    >
      {children}
      {enabled && (
        // Corner handle: the panel grows along the drag towards bottom right, in 5 % steps.
        <div
          className="resize-handle"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture(e.pointerId);
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            resize.current = { px: e.clientX, py: e.clientY, w: box.width, h: box.height, scale, last: scale };
          }}
          onPointerMove={(e) => {
            const r = resize.current;
            if (!r) return;
            e.stopPropagation();
            // Drag projected onto the panel's diagonal.
            const dx = e.clientX - r.px, dy = e.clientY - r.py;
            const factor = 1 + (dx * r.w + dy * r.h) / (r.w * r.w + r.h * r.h);
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(r.scale * factor * 20) / 20));
            if (next !== r.last) { r.last = next; onResize(next); }
          }}
          onPointerUp={(e) => {
            const r = resize.current;
            if (!r) return;
            e.stopPropagation();
            resize.current = null;
            if (r.last !== r.scale) onResized(r.last);
          }}
        />
      )}
    </div>
  );
}

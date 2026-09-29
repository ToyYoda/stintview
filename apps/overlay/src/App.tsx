import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTeamFeed } from './feed.ts';
import { FuelWidget } from './widgets/FuelWidget.tsx';
import { HeaderWidget } from './widgets/HeaderWidget.tsx';
import { InputsWidget } from './widgets/InputsWidget.tsx';
import { TyresWidget } from './widgets/TyresWidget.tsx';

type WidgetId = 'header' | 'inputs' | 'fuel' | 'tyres';
type Positions = Record<WidgetId, { x: number; y: number }>;

const DEFAULT_POSITIONS: Positions = {
  header: { x: 40, y: 40 },
  inputs: { x: 40, y: 100 },
  fuel: { x: 500, y: 100 },
  tyres: { x: 780, y: 100 },
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
  const { state, inputs } = useTeamFeed();
  const [route, setRoute] = useState(location.hash);
  // Browser: always movable. Electron: toggled by hotkey (desktop) or panel selection (VR).
  const [edit, setEdit] = useState(!window.stintview && !location.hash.startsWith('#/widget/'));
  const [positions, setPositions] = useState(loadPositions);
  const [hotkey, setHotkey] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(location.hash);
    addEventListener('hashchange', onHash);
    window.stintview?.onEditMode((on, key) => {
      setEdit(on);
      setHotkey(key);
    });
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const widgets: Record<WidgetId, ReactNode> = {
    // Buttons only on the desktop overlay; VR panels / browser widgets show hotkeys instead.
    header: <HeaderWidget state={state} interactive={Boolean(window.stintview) && !location.hash.startsWith('#/widget/')} />,
    inputs: <InputsWidget inputs={inputs} />,
    fuel: <FuelWidget fuel={state.fuel} status={state.status} />,
    tyres: <TyresWidget tyres={state.tyres} status={state.status} />,
  };

  const single = /^#\/widget\/(\w+)/.exec(route)?.[1] as WidgetId | undefined;
  if (single && single in widgets) return <div className={edit ? 'single selected' : 'single'}>{widgets[single]}</div>;

  const move = (id: WidgetId, x: number, y: number) =>
    setPositions((p) => {
      const next = { ...p, [id]: { x, y } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* not persisted */ }
      return next;
    });

  return (
    <div className={edit ? 'overlay edit' : 'overlay'}>
      {edit && window.stintview && (
        <div className="edit-banner">
          Anzeigen mit der Maus ziehen{hotkey ? ` · ${hotkey} beendet` : ''}
          <button type="button" onClick={() => window.stintview?.setEditMode(false)}>Fertig</button>
        </div>
      )}
      {(Object.keys(widgets) as WidgetId[]).map((id) => (
        <Draggable key={id} pos={positions[id]} enabled={edit} onMove={(x, y) => move(id, x, y)}>
          {widgets[id]}
        </Draggable>
      ))}
    </div>
  );
}

function Draggable({ pos, enabled, onMove, children }: {
  pos: { x: number; y: number }; enabled: boolean; onMove(x: number, y: number): void; children: ReactNode;
}) {
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
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
    </div>
  );
}

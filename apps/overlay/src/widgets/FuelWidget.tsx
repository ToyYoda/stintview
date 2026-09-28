import { fuelStats } from '@stintview/telemetry';
import type { Fuel, Status } from '@stintview/protocol';

const fmt = (v: number | null, digits = 2) => (v === null ? '–' : v.toFixed(digits));

/** Fuel used per lap (last / avg of 3 / avg of 5) and laps remaining. */
export function FuelWidget({ fuel, status }: { fuel: Fuel | null; status: Status | null }) {
  const level = status?.fuelLevel ?? null;
  const laps = fuel?.laps ?? [];
  const s = level !== null ? fuelStats(laps, level) : null;
  const recent = laps.slice(-8);
  const max = Math.max(...recent.map((l) => l.used), 0.001);

  return (
    <div className="panel fuel">
      <div className="title">Sprit</div>
      <div className="big-row">
        <div>
          <div className="big">{fmt(level, 1)}<span className="unit"> l</span></div>
          <div className="label">im Tank</div>
        </div>
        <div>
          <div className="big accent">{s?.lapsRemaining?.toFixed(1) ?? '–'}</div>
          <div className="label">Runden übrig</div>
        </div>
      </div>
      <div className="grid3">
        <Stat label="Letzte" value={fmt(s?.lastLap ?? null)} />
        <Stat label="Ø 3" value={fmt(s?.avg3 ?? null)} />
        <Stat label="Ø 5" value={fmt(s?.avg5 ?? null)} />
      </div>
      <div className="lapbars" aria-label="Verbrauch der letzten Runden">
        {recent.map((l) => (
          <div key={l.lap} className="lapbar" title={`Runde ${l.lap}: ${l.used.toFixed(2)} l${l.pit ? ' (Box)' : ''}`}>
            <div className={l.pit ? 'fill pit' : 'fill'} style={{ height: `${(l.used / max) * 100}%` }} />
            <span>{l.lap}</span>
          </div>
        ))}
        {!recent.length && <div className="label">Noch keine volle Runde</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mid">{value}<span className="unit"> l</span></div>
      <div className="label">{label}</div>
    </div>
  );
}

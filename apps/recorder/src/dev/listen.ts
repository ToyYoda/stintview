/** Dev tool: connects as an overlay and prints what arrives. Usage: tsx src/dev/listen.ts */
import WebSocket from 'ws';
import { PROTOCOL_VERSION, pack, unpack, type ServerMessage, type Telemetry } from '@stintview/protocol';
import { fuelStats, estimateWear } from '@stintview/telemetry';
import { loadConfig, wsUrl } from '../config.ts';

const config = loadConfig();
if (!config) throw new Error('no config');
const ws = new WebSocket(wsUrl(config.serverUrl));
const counts: Record<string, number> = {};
let lastFuel: Extract<Telemetry, { t: 'fuel' }> | null = null;
let lastTyres: Extract<Telemetry, { t: 'tyres' }> | null = null;

ws.on('open', () => ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token: config.token, role: 'overlay' })));
ws.on('message', (data: Buffer) => {
  const msg = unpack<ServerMessage>(data);
  counts[msg.t] = (counts[msg.t] ?? 0) + 1;
  switch (msg.t) {
    case 'welcome': console.log(`welcome team=${msg.teamName}`); break;
    case 'active': console.log(`active driver: ${msg.driverName ?? '-'} (${msg.memberName ?? '-'})`); break;
    case 'snapshot': console.log(`snapshot: active=${msg.active.driverName} telemetry=${msg.telemetry.map((t) => t.t)}`); break;
    case 'session': console.log(`session: ${msg.track} / ${msg.car} / ${msg.sessionType} / ${msg.driverName} (${msg.teamName})`); break;
    case 'fuel': {
      lastFuel = msg;
      const l = msg.laps.at(-1)!;
      console.log(`fuel: lap ${l.lap} used ${l.used.toFixed(2)} l in ${l.lapTime.toFixed(1)} s${l.pit ? ' (pit)' : ''}`);
      break;
    }
    case 'tyres': {
      lastTyres = msg;
      const m = msg.measurements.at(-1)!;
      console.log(`tyres measured lap ${m.lap}: LF wear ${m.wear.LF.map((w) => w.toFixed(3))} carcass ${m.carcass.LF.map((c) => c.toFixed(1))} @ ${(m.odometer.LF / 1000).toFixed(1)} km`);
      break;
    }
    case 'status':
      if (counts.status! % 20 === 1) {
        const s = lastFuel ? fuelStats(lastFuel.laps, msg.fuelLevel) : null;
        const w = lastTyres ? estimateWear(lastTyres.measurements, msg.odometer).LF : null;
        console.log(`status: t=${msg.sessionTime.toFixed(0)} lap ${msg.lap} fuel ${msg.fuelLevel.toFixed(1)} l` +
          (s ? ` avg3 ${s.avg3} -> ${s.lapsRemaining} laps` : '') +
          ` LF odo ${(msg.odometer.LF / 1000).toFixed(1)} km` + (w?.remaining != null ? ` est. wear ${(w.remaining * 100).toFixed(1)}%` : ''));
      }
      break;
    case 'inputs':
      if (counts.inputs! % 100 === 1) {
        const [steer, thr, brk] = msg.samples[0]!;
        console.log(`inputs: steer ${(steer * 57.3).toFixed(0)}° thr ${(thr * 100).toFixed(0)}% brk ${(brk * 100).toFixed(0)}% ${(msg.speed * 3.6).toFixed(0)} km/h G${msg.gear}`);
      }
      break;
    case 'error': console.log(`error: ${msg.message}`); break;
  }
});
setInterval(() => console.log(`-- received: ${JSON.stringify(counts)}`), 10_000);

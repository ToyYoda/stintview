// Fuel laps the Fuel panel would get from one .ibt file, with every lap change and pit road
// change (Lap, LapCompleted, LapDistPct, OnPitRoad) – to check which laps count.
//   npx tsx src/dev/fuel-from-ibt.ts <file.ibt>
import { FuelTracker } from '@stintview/telemetry';
import { IbtSource } from '../irsdk/ibt.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: fuel-from-ibt <file.ibt>');
const src = new IbtSource(file);
const fuel = new FuelTracker(1000);
let prev: { lap: number; done: number; pit: boolean; session: number; state: number } | null = null;
for (let i = 0; i < src.recordCount; i++) {
  const f = src.frame(i);
  if (f.num('IsOnTrack') !== 1) continue;
  const s = {
    sessionTime: f.num('SessionTime'), lap: f.num('Lap'), lapDistPct: f.num('LapDistPct'),
    fuelLevel: f.num('FuelLevel'), onPitRoad: f.num('OnPitRoad') === 1,
  };
  const cur = {
    lap: s.lap, done: f.has('LapCompleted') ? f.num('LapCompleted') : NaN, pit: s.onPitRoad, session: f.num('SessionNum'),
    state: f.has('SessionState') ? f.num('SessionState') : NaN,
  };
  if (!prev || cur.lap !== prev.lap || cur.done !== prev.done || cur.pit !== prev.pit || cur.session !== prev.session || cur.state !== prev.state) {
    console.log(`t ${s.sessionTime.toFixed(1)} session ${cur.session} state ${cur.state} Lap ${cur.lap} LapCompleted ${cur.done} pct ${s.lapDistPct.toFixed(3)} pit ${cur.pit} fuel ${s.fuelLevel.toFixed(2)} flags 0x${(f.num('SessionFlags') >>> 0).toString(16)}`);
  }
  prev = cur;
  const done = fuel.feed({ ...s, lapsCompleted: f.num('LapCompleted'), sessionState: f.num('SessionState') });
  if (done) console.log(`   => lap ${done.lap}: ${done.used.toFixed(2)} l, ${done.lapTime.toFixed(1)} s${done.pit ? ' (pit)' : ''}`);
}
src.close();

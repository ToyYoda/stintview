// Lap times the stint planner would read from one .ibt file (no files written).
//   npx tsx src/dev/laps-from-ibt.ts <file.ibt>
import { lapStats } from '@stintview/planner';
import { lapsInFile } from '../lap-import.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: laps-from-ibt <file.ibt>');
const r = lapsInFile(file);
for (const l of r.laps) console.log(`${l.session.padEnd(8)} ${l.time.toFixed(3)} s  ${l.fuel.toFixed(2)} l${l.wet ? '  wet' : ''}`);
const first = r.laps[0];
if (first) console.log(first.trackName, '/', first.carName, `(track ${first.track}, car ${first.car}, tank ${first.tank} l)`, lapStats(r.laps, first.track, first.car));

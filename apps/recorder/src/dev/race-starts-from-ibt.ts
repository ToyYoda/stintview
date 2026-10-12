// Race starts in .ibt files: SessionState, Lap, LapCompleted and LapDistPct changes from the
// first frame of a race session until LapCompleted reaches 2 – how iRacing counts the first laps.
//   npx tsx src/dev/race-starts-from-ibt.ts <file.ibt> [more.ibt …]
import { parse } from 'yaml';
import { IbtSource } from '../irsdk/ibt.ts';

for (const file of process.argv.slice(2)) {
  const src = new IbtSource(file);
  try {
    const y = parse(src.sessionInfo, { strict: false, uniqueKeys: false, maxAliasCount: -1 }) ?? {};
    const types: string[] = (y.SessionInfo?.Sessions ?? []).map((s: { SessionType?: string }) => s.SessionType ?? '');
    let key = '', printed = 0, pct = -1, done = false;
    for (let i = 0; i < src.recordCount && !done; i++) {
      const f = src.frame(i);
      const session = f.num('SessionNum');
      if (!/race/i.test(types[session] ?? '')) continue;
      if (printed === 0) console.log(`\n${file.split(/[\\/]/).pop()} – session ${session} (${types[session]})`);
      const lap = f.num('Lap'), completed = f.num('LapCompleted'), state = f.num('SessionState'), p = f.num('LapDistPct');
      const k = `${state}|${lap}|${completed}|${f.num('OnPitRoad')}|${f.num('IsOnTrack')}`;
      const wrap = pct > 0.9 && p < 0.1;
      if (k !== key || wrap) {
        console.log(`  t ${f.num('SessionTime').toFixed(1)} state ${state} Lap ${lap} LapCompleted ${completed} pct ${p.toFixed(3)} pit ${f.num('OnPitRoad')} onTrack ${f.num('IsOnTrack')}${wrap ? '  <- line' : ''}`);
        key = k;
        if (++printed > 25) done = true;
      }
      pct = p;
      if (completed >= 2) done = true;
    }
  } finally {
    src.close();
  }
}

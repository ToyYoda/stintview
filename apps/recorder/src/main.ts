import { parseArgs } from 'node:util';
import type { ClientMessage, CreateTeamRequest, JoinTeamRequest, SendMessage, ServerMessage, TeamCredentials } from '@stintview/protocol';
import { configPath, loadConfig, saveConfig, wsUrl } from './config.ts';
import { Connection } from './connection.ts';
import { IbtSource } from './irsdk/ibt.ts';
import type { TelemetrySource } from './irsdk/layout.ts';
import { Recorder } from './recorder.ts';
import { Spectator, type CameraCommand, type CameraResult, type CameraState } from './spectator.ts';
import { HazardDetector } from './hazard.ts';
import { parseSessions, StandingsTracker } from './standings.ts';
import { countryCode } from './country.ts';
import { parseSessionCars } from './spectator.ts';
import { PitModelStore, PitPlanner, type PitOverride } from './pitstop.ts';
import { importArchive, type ImportProgress } from './pitlane-import.ts';
import { LapLog, LapUploader } from './laps.ts';
import { importLapArchive, type LapImportProgress } from './lap-import.ts';

const USAGE = `StintView recorder

  create-team --server <url> --team <team name> --name <your name>
  join        --server <url> --code <invite code> --name <your name>
  run                       record live from iRacing (default)
  replay <file.ibt> [--speed 1] [--start 0] [--loop]
                            play an .ibt file as if it were live (start in minutes)
  import-pitlane <telemetry dir>
                            read pit lane losses from old .ibt files into pit-model.json
  import-laps <telemetry dir>
                            read lap times from old .ibt files (stint planner) and upload them

Config: ${configPath()}`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string' }, team: { type: 'string' }, name: { type: 'string' }, code: { type: 'string' },
    speed: { type: 'string' }, start: { type: 'string' }, loop: { type: 'boolean' }, help: { type: 'boolean' },
  },
});
const [command = 'run', ...rest] = positionals;

/** Status for the desktop app when running as its utility process (no-op on the command line). */
export type RecorderEvent =
  | { t: 'iracing'; connected: boolean }
  | { t: 'server'; connected: boolean; text: string }
  | { t: 'car'; inCar: boolean; driverName: string }
  /** Every message for the team, also straight to the app: its displays use it without a team server. */
  | { t: 'telemetry'; msg: ClientMessage }
  /** The team streams another iRacing session than this PC's: its displays show their own data. */
  | { t: 'other-session'; on: boolean }
  | { t: 'team-message'; msg: Extract<ServerMessage, { t: 'message' }> }
  | CameraState
  | CameraResult
  | ({ t: 'pit-import'; finished: boolean; error?: string } & Partial<ImportProgress>)
  /** Lap times kept on this PC for the stint planner, and how many are not on the team server yet. */
  | { t: 'laps'; total: number; unsent: number }
  | ({ t: 'lap-import'; finished: boolean; error?: string } & Partial<LapImportProgress>);
interface ParentPort {
  postMessage(m: RecorderEvent): void;
  on(event: 'message', fn: (e: { data: CameraCommand | { t: 'pit-settings'; pit: PitOverride } | { t: 'pit-model-reload' } | { t: 'laps-sync' } | SendMessage }) => void): void;
}
const parentPort = (process as { parentPort?: ParentPort }).parentPort;
const report = (e: RecorderEvent) => parentPort?.postMessage(e);
/** The live source reports iRacing going away before record() has set up the recorder. */
let recorderRef: Recorder | null = null;
let onSourceLost: (() => void) | null = null;
/** Standby replies repeat every 2 s while driving; none for this long = the claim was taken. */
const STANDBY_GONE_MS = 5000;

async function register(path: string, body: CreateTeamRequest | JoinTeamRequest) {
  if (!values.server) throw new Error('--server is required');
  const res = await fetch(new URL(path, values.server), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json() as TeamCredentials & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  saveConfig({ ...json, serverUrl: values.server });
  console.log(`Team "${json.teamName}" – you are ${json.memberName}.`);
  console.log(`Invite code for teammates: ${json.inviteCode}`);
  console.log(`Saved to ${configPath()}`);
}

/** `recordLaps`: keep this PC's laps for the stint planner (live only – replays are no new laps). */
async function record(source: TelemetrySource, label: string, spectator?: Spectator, hazard?: HazardDetector, recordLaps = false) {
  // Without a team the app's displays still show this PC's own sessions (see `send`).
  const config = loadConfig();
  if (!config && !parentPort) throw new Error(`Not set up yet – run create-team or join first.\n\n${USAGE}`);
  if (!config) console.log('[server] no team – data for the displays on this PC only');

  // The team streams another session than ours: remembered for our session (also in the garage,
  // so the displays don't flip back on every pit exit) until it changes, iRacing goes away, the
  // connection drops or the server takes our claim after all.
  let otherSession: string | null = null;
  let lastStandby = 0;
  const setOtherSession = (session: string | null) => {
    if (session === otherSession) return;
    if (session !== null || otherSession !== null) console.log(session ? '[server] team in another session – displays show this PC' : '[server] same session as the team again');
    otherSession = session;
    report({ t: 'other-session', on: session !== null });
  };
  setInterval(() => {
    if (otherSession === null) return;
    if (recorder.sessionId !== otherSession || (recorder.isDriving && Date.now() - lastStandby > STANDBY_GONE_MS)) setOtherSession(null);
  }, 1000);
  onSourceLost = () => setOtherSession(null);

  const conn = config ? new Connection(wsUrl(config.serverUrl), config.token, {
    onOpen: () => recorder.stateMessages(),
    onStatus: (s) => {
      console.log(`[server] ${s}`);
      if (!s.startsWith('standby')) setOtherSession(null);
      report({ t: 'server', connected: s.startsWith('connected') || s.startsWith('standby'), text: s });
    },
    onStandby: (reason) => {
      lastStandby = Date.now();
      setOtherSession(reason === 'other-session' ? recorder.sessionId : null);
    },
    // In the desktop app: team messages straight to its displays (see Room.message).
    ...(parentPort ? { onMessage: (msg: Extract<ServerMessage, { t: 'message' }>) => report({ t: 'team-message', msg }) } : {}),
  }) : null;
  const send = (msg: ClientMessage) => {
    conn?.send(msg);
    report({ t: 'telemetry', msg });
  };
  const lapLog = new LapLog();
  const laps = recordLaps ? new LapUploader(lapLog, loadConfig, (line) => console.log(line), (c) => report({ t: 'laps', ...c })) : null;
  laps?.start();
  let inCar = false;
  const recorder = new Recorder((msg) => {
    if (msg.t === 'driving' && msg.driving !== inCar) {
      inCar = msg.driving;
      console.log(inCar ? `[car] ${msg.driverName || 'you'} in the car – streaming` : '[car] left the car – idle');
      report({ t: 'car', inCar, driverName: msg.driverName });
    }
    send(msg);
  }, laps ? (lap) => {
    lapLog.add([lap]);
    console.log(`[laps] ${lap.time.toFixed(3)} s, ${lap.fuel.toFixed(2)} l (${lap.session}${lap.wet ? ', wet' : ''})`);
    void laps.sync();
  } : undefined);

  console.log(`[source] ${label}`);
  conn?.connect();
  const standings = new StandingsTracker((line) => console.log(line));
  const pit = new PitPlanner(undefined, (line) => console.log(line));
  source.start(
    (f) => {
      recorder.onFrame(f);
      const table = standings.onFrame(f, recorder.isDriving); // also tracks pit stops while not driving
      if (table) send(table);
      const plan = pit.onFrame(f, recorder.isDriving); // learns from stops also while not driving
      if (plan) send(plan);
      spectator?.onFrame(f, recorder.isDriving);
      const warning = hazard?.onFrame(f, recorder.isDriving);
      if (warning) send(warning);
    },
    (yaml) => {
      recorder.onSessionInfo(yaml);
      spectator?.onSessionInfo(yaml);
      const cars = parseSessionCars(yaml);
      const info = new Map([...cars.drivers].map(([idx, d]) => [idx, { number: d.label, name: d.name, country: countryCode(d.flair), team: d.team, car: d.car, irating: d.irating, license: d.license, estLap: d.estLap }]));
      standings.setDrivers(info, cars.trackLength, cars.tires);
      standings.setSessions(parseSessions(yaml));
      pit.setSession(yaml, info);
      const cleared = hazard?.onSessionInfo(yaml);
      if (cleared) send(cleared);
    },
  );
  recorderRef = recorder;
  // Camera commands from the desktop app (teammate watching the team car in iRacing).
  parentPort?.on('message', (e) => {
    if (e.data?.t === 'pit-model-reload') {
      console.log('[pit] reloading learned values (archive import finished)');
      return pit.reloadModel();
    }
    if (e.data?.t === 'laps-sync') return void laps?.sync(); // after an .ibt import
    if (e.data?.t === 'send-message') {
      // Team message from the spotter (StintView window, overlay button or hotkey).
      console.log(`[message] ${e.data.color}: ${e.data.text}`);
      return conn?.send({ t: 'send-message', text: e.data.text, color: e.data.color });
    }
    if (e.data?.t === 'pit-settings') {
      console.log(`[pit] crew values from the app: ${JSON.stringify(e.data.pit)}`);
      return pit.setOverride(e.data.pit);
    }
    if (e.data?.t !== 'camera' || !spectator) return;
    console.log(`[camera] ${e.data.action}${e.data.targetCarIdx !== undefined ? ` car ${e.data.targetCarIdx}` : ''} requested`);
    spectator.command(e.data); // result is reported (and logged) once iRacing's camera moved – or didn't
  });

  const shutdown = () => {
    source.stop();
    conn?.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  if (values.help) return console.log(USAGE);
  switch (command) {
    case 'create-team':
      return register('/api/teams', { teamName: values.team ?? '', memberName: values.name ?? '' });
    case 'join':
      return register('/api/join', { inviteCode: values.code ?? '', memberName: values.name ?? '' });
    case 'run': {
      const { LiveSource } = await import('./irsdk/live.ts');
      const spectator = new Spectator(report, undefined, (line) => console.log(line));
      const source = new LiveSource((c) => {
        console.log(c ? '[iracing] connected' : '[iracing] waiting for iRacing session…');
        report({ t: 'iracing', connected: c });
        spectator.setConnected(c);
        if (!c) {
          recorderRef?.sourceLost();
          onSourceLost?.();
        }
      });
      return record(source, 'live iRacing telemetry', spectator, new HazardDetector((line) => console.log(line)), true);
    }
    case 'replay': {
      const file = rest[0];
      if (!file) throw new Error('replay needs an .ibt file');
      const source = new IbtSource(file, {
        speed: Number(values.speed ?? 1), startMinutes: Number(values.start ?? 0), loop: values.loop,
      });
      // Tests of the stint planner only: STINTVIEW_REPLAY_LAPS=1 keeps the replayed laps as if driven.
      return record(source, `replay ${file} (${source.durationMinutes.toFixed(0)} min, speed ${values.speed ?? 1}x)`, undefined, undefined, process.env.STINTVIEW_REPLAY_LAPS === '1');
    }
    case 'import-pitlane': {
      // Separate process started by the app's "Boxengassen-Zeiten einlesen" button.
      const dir = rest[0];
      if (!dir) throw new Error('import-pitlane needs the telemetry folder');
      try {
        const r = await importArchive(dir, new PitModelStore(), (p) => report({ t: 'pit-import', finished: false, ...p }));
        console.log(`[pit] archive import: ${r.files} files, ${r.passes} pit lane passes on ${r.tracks} tracks`);
        report({ t: 'pit-import', finished: true, done: r.files, total: r.files, passes: r.passes, tracks: r.tracks });
      } catch (e) {
        report({ t: 'pit-import', finished: true, error: (e as Error).message });
      }
      return;
    }
    case 'import-laps': {
      // Separate process started by the app's "Rundenzeiten einlesen" button.
      const dir = rest[0];
      if (!dir) throw new Error('import-laps needs the telemetry folder');
      try {
        const log = new LapLog();
        const r = await importLapArchive(dir, log, (p) => report({ t: 'lap-import', finished: false, ...p }));
        console.log(`[laps] archive import: ${r.files} files, ${r.laps} laps on ${r.tracks} tracks`);
        await new LapUploader(log, loadConfig, (line) => console.log(line)).sync();
        report({ t: 'lap-import', finished: true, done: r.files, total: r.files, laps: r.laps, tracks: r.tracks });
      } catch (e) {
        report({ t: 'lap-import', finished: true, error: (e as Error).message });
      }
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

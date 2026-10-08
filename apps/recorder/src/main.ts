import { parseArgs } from 'node:util';
import type { ClientMessage, CreateTeamRequest, JoinTeamRequest, SendMessage, TeamCredentials } from '@stintview/protocol';
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

const USAGE = `StintView recorder

  create-team --server <url> --team <team name> --name <your name>
  join        --server <url> --code <invite code> --name <your name>
  run                       record live from iRacing (default)
  replay <file.ibt> [--speed 1] [--start 0] [--loop]
                            play an .ibt file as if it were live (start in minutes)
  import-pitlane <telemetry dir>
                            read pit lane losses from old .ibt files into pit-model.json

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
  | CameraState
  | CameraResult
  | ({ t: 'pit-import'; finished: boolean; error?: string } & Partial<ImportProgress>);
interface ParentPort {
  postMessage(m: RecorderEvent): void;
  on(event: 'message', fn: (e: { data: CameraCommand | { t: 'pit-settings'; pit: PitOverride } | { t: 'pit-model-reload' } | SendMessage }) => void): void;
}
const parentPort = (process as { parentPort?: ParentPort }).parentPort;
const report = (e: RecorderEvent) => parentPort?.postMessage(e);
/** The live source reports iRacing going away before record() has set up the recorder. */
let recorderRef: Recorder | null = null;

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

async function record(source: TelemetrySource, label: string, spectator?: Spectator, hazard?: HazardDetector) {
  // Without a team the app's displays still show this PC's own sessions (see `send`).
  const config = loadConfig();
  if (!config && !parentPort) throw new Error(`Not set up yet – run create-team or join first.\n\n${USAGE}`);
  if (!config) console.log('[server] no team – data for the displays on this PC only');

  const conn = config ? new Connection(wsUrl(config.serverUrl), config.token, {
    onOpen: () => recorder.stateMessages(),
    onStatus: (s) => {
      console.log(`[server] ${s}`);
      report({ t: 'server', connected: s.startsWith('connected') || s.startsWith('standby'), text: s });
    },
  }) : null;
  const send = (msg: ClientMessage) => {
    conn?.send(msg);
    report({ t: 'telemetry', msg });
  };
  let inCar = false;
  const recorder = new Recorder((msg) => {
    if (msg.t === 'driving' && msg.driving !== inCar) {
      inCar = msg.driving;
      console.log(inCar ? `[car] ${msg.driverName || 'you'} in the car – streaming` : '[car] left the car – idle');
      report({ t: 'car', inCar, driverName: msg.driverName });
    }
    send(msg);
  });

  console.log(`[source] ${label}`);
  conn?.connect();
  const standings = new StandingsTracker();
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
      const info = new Map([...cars.drivers].map(([idx, d]) => [idx, { number: d.label, name: d.name, country: countryCode(d.flair) }]));
      standings.setDrivers(info, cars.trackLength);
      standings.setSessions(parseSessions(yaml));
      pit.setSession(yaml, info);
      hazard?.onSessionInfo(yaml);
    },
  );
  recorderRef = recorder;
  // Camera commands from the desktop app (teammate watching the team car in iRacing).
  parentPort?.on('message', (e) => {
    if (e.data?.t === 'pit-model-reload') {
      console.log('[pit] reloading learned values (archive import finished)');
      return pit.reloadModel();
    }
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
        if (!c) recorderRef?.sourceLost();
      });
      return record(source, 'live iRacing telemetry', spectator, new HazardDetector((line) => console.log(line)));
    }
    case 'replay': {
      const file = rest[0];
      if (!file) throw new Error('replay needs an .ibt file');
      const source = new IbtSource(file, {
        speed: Number(values.speed ?? 1), startMinutes: Number(values.start ?? 0), loop: values.loop,
      });
      return record(source, `replay ${file} (${source.durationMinutes.toFixed(0)} min, speed ${values.speed ?? 1}x)`);
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
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

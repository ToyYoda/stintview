import { parseArgs } from 'node:util';
import type { CreateTeamRequest, JoinTeamRequest, TeamCredentials } from '@stintview/protocol';
import { configPath, loadConfig, saveConfig, wsUrl } from './config.ts';
import { Connection } from './connection.ts';
import { IbtSource } from './irsdk/ibt.ts';
import type { TelemetrySource } from './irsdk/layout.ts';
import { Recorder } from './recorder.ts';
import { Spectator, type CameraCommand, type CameraResult, type CameraState } from './spectator.ts';
import { HazardDetector } from './hazard.ts';
import { StandingsTracker } from './standings.ts';
import { parseSessionCars } from './spectator.ts';

const USAGE = `StintView recorder

  create-team --server <url> --team <team name> --name <your name>
  join        --server <url> --code <invite code> --name <your name>
  run                       record live from iRacing (default)
  replay <file.ibt> [--speed 1] [--start 0] [--loop]
                            play an .ibt file as if it were live (start in minutes)

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
  | CameraState
  | CameraResult;
interface ParentPort {
  postMessage(m: RecorderEvent): void;
  on(event: 'message', fn: (e: { data: CameraCommand }) => void): void;
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
  const config = loadConfig();
  if (!config) throw new Error(`Not set up yet – run create-team or join first.\n\n${USAGE}`);

  const conn = new Connection(wsUrl(config.serverUrl), config.token, {
    onOpen: () => recorder.stateMessages(),
    onStatus: (s) => {
      console.log(`[server] ${s}`);
      report({ t: 'server', connected: s.startsWith('connected') || s.startsWith('standby'), text: s });
    },
  });
  let inCar = false;
  const recorder = new Recorder((msg) => {
    if (msg.t === 'driving' && msg.driving !== inCar) {
      inCar = msg.driving;
      console.log(inCar ? `[car] ${msg.driverName || 'you'} in the car – streaming` : '[car] left the car – idle');
      report({ t: 'car', inCar, driverName: msg.driverName });
    }
    conn.send(msg);
  });

  console.log(`[source] ${label}`);
  conn.connect();
  const standings = new StandingsTracker();
  source.start(
    (f) => {
      recorder.onFrame(f);
      const table = standings.onFrame(f, recorder.isDriving); // also tracks pit stops while not driving
      if (table) conn.send(table);
      spectator?.onFrame(f, recorder.isDriving);
      const warning = hazard?.onFrame(f, recorder.isDriving);
      if (warning) conn.send(warning);
    },
    (yaml) => {
      recorder.onSessionInfo(yaml);
      spectator?.onSessionInfo(yaml);
      const cars = parseSessionCars(yaml);
      standings.setDrivers(new Map([...cars.drivers].map(([idx, d]) => [idx, { number: d.label, name: d.name }])), cars.trackLength);
      hazard?.onSessionInfo(yaml);
    },
  );
  recorderRef = recorder;
  // Camera commands from the desktop app (teammate watching the team car in iRacing).
  parentPort?.on('message', (e) => {
    if (e.data?.t !== 'camera' || !spectator) return;
    console.log(`[camera] ${e.data.action}${e.data.targetCarIdx !== undefined ? ` car ${e.data.targetCarIdx}` : ''} requested`);
    spectator.command(e.data); // result is reported (and logged) once iRacing's camera moved – or didn't
  });

  const shutdown = () => {
    source.stop();
    conn.close();
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
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

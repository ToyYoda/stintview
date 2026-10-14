// Bundles the recorder and the relay server into single CommonJS files that the desktop
// app runs as Electron utility processes – so users don't need Node.js installed – and the
// display pages' team connection, which the app's main process loads (since 0.25), and the
// encrypted link to the team server it uses for that (since 0.26).
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apps = join(here, '..', '..');

await build({
  entryPoints: {
    recorder: join(apps, 'recorder', 'src', 'main.ts'),
    server: join(apps, 'server', 'src', 'main.ts'),
    'team-feed': join(apps, 'recorder', 'src', 'team-feed.ts'),
    // Encrypted link to the team server for the main process (joining, stint planner; since 0.26).
    'server-link': join(apps, 'recorder', 'src', 'server-link.ts'),
  },
  outdir: join(here, '..', 'dist-bundles'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outExtension: { '.js': '.cjs' }, // the package is "type": "module"
  // koffi is a native module shipped next to the app; ws' native speedups are optional.
  external: ['koffi', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});

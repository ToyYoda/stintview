// Bundles the recorder and the relay server into single CommonJS files that the desktop
// app runs as Electron utility processes – so users don't need Node.js installed.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apps = join(here, '..', '..');

await build({
  entryPoints: {
    recorder: join(apps, 'recorder', 'src', 'main.ts'),
    server: join(apps, 'server', 'src', 'main.ts'),
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

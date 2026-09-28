// Dev: start Vite, then the Electron app pointing at it. Closing the app stops both.
// Extra arguments are passed to Electron (e.g. `--hidden`).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = createRequire(import.meta.url)('electron');

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

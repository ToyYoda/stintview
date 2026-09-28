// Dev: start Vite, then Electron pointing at it. Closing Electron stops both.
// `node electron/dev.mjs vr` starts the SteamVR host instead of the desktop overlay.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = createRequire(import.meta.url)('electron');

const child = spawn(electron, [process.argv[2] === 'vr' ? 'electron/vr.cjs' : '.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

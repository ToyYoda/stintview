import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const configPath = () =>
  process.env.STINTVIEW_CONFIG ??
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'StintView', 'config.json');

/**
 * Browser mode (dev, OpenKneeboard): serves the local team config to pages on this
 * machine so the token never has to appear in a URL. Only bound to localhost.
 */
function localConfig(): Plugin {
  return {
    name: 'stintview-local-config',
    configureServer(server) {
      server.middlewares.use('/local-config', (_req, res) => {
        try {
          const { serverUrl, token, teamName, memberName } = JSON.parse(readFileSync(configPath(), 'utf8'));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ serverUrl, token, teamName, memberName }));
        } catch {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), localConfig()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});

// Dev helper: drive a running StintView window over the Chrome DevTools Protocol.
// Start the app with --remote-debugging-port=9333, then:
//   node scripts/cdp.mjs eval "<js>" [route]    evaluate in the page whose URL contains route (default #/setup)
//   node scripts/cdp.mjs shot <file.png> [route]
import { writeFileSync } from 'node:fs';
import WebSocket from '../../recorder/node_modules/ws/index.js';

const [cmd, arg, route = '#/setup'] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((t) => t.type === 'page' && t.url.includes(route));
if (!target) {
  console.error(`no page with ${route}; pages: ${targets.map((t) => t.url).join(', ')}`);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const my = ++id;
  const onMsg = (data) => {
    const msg = JSON.parse(data);
    if (msg.id !== my) return;
    ws.off('message', onMsg);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  };
  ws.on('message', onMsg);
  ws.send(JSON.stringify({ id: my, method, params }));
});

if (cmd === 'eval') {
  const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true, replMode: true });
  console.log(JSON.stringify(r.result.value ?? r.exceptionDetails?.exception?.description ?? r.result, null, 2));
} else if (cmd === 'shot') {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.data, 'base64'));
  console.log(`saved ${arg}`);
}
ws.close();

// Dev helper: drive a running StintView window over the Chrome DevTools Protocol.
// Start the app with --remote-debugging-port=9333, then:
//   node scripts/cdp.mjs eval "<js>" [route]    evaluate in the page whose URL contains route (default #/setup)
//   node scripts/cdp.mjs shot <file.png> [route]
import { writeFileSync } from 'node:fs';
import WebSocket from '../../recorder/node_modules/ws/index.js';

const [cmd, arg, route = '#/setup'] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
// Match the end of the URL: "#/" must not also pick "#/setup".
const target = targets.find((t) => t.type === 'page' && t.url.endsWith(route));
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
} else if (cmd === 'drag') {
  // node scripts/cdp.mjs drag "x1,y1,x2,y2" [route] – real mouse drag in CSS pixels
  const [x1, y1, x2, y2] = arg.split(',').map(Number);
  const mouse = (type, x, y, buttons) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  await mouse('mouseMoved', x1, y1, 0);
  await mouse('mousePressed', x1, y1, 1);
  for (let i = 1; i <= 10; i++) await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10, 1);
  await mouse('mouseReleased', x2, y2, 0);
  console.log(`dragged ${x1},${y1} -> ${x2},${y2}`);
} else if (cmd === 'shot') {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.data, 'base64'));
  console.log(`saved ${arg}`);
}
ws.close();

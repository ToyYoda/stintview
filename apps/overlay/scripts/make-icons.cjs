// Renders the Outcast "O" emblem to the app icons. Run once with: npx electron scripts/make-icons.cjs
//   electron/icons/tray.png (32 px, tray + window), build/icon.ico (16–256 px, installer + exe)
const { app, BrowserWindow, nativeImage } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">
  <circle cx="32" cy="32" r="30" fill="#0a0a0a"/>
  <circle cx="32" cy="32" r="29" fill="none" stroke="#e5e5e5" stroke-opacity="0.45" stroke-width="2.5"/>
  <g transform="skewX(-14) translate(8 0)">
    <rect x="18" y="15" width="28" height="34" rx="9" fill="none" stroke="#e5e5e5" stroke-width="7"/>
  </g>
  <polygon points="9,47 55,17 58,20.5 13,50.5" fill="#d10f0f"/>
</svg>`;

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function toIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 256, height: 256, transparent: true, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html,<body style="margin:0;background:transparent">${encodeURIComponent(SVG)}</body>`);
  await new Promise((r) => setTimeout(r, 300));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const at = (size) => nativeImage.createFromBuffer(full.toPNG()).resize({ width: size, height: size, quality: 'best' }).toPNG();

  const root = path.join(__dirname, '..');
  mkdirSync(path.join(root, 'electron', 'icons'), { recursive: true });
  mkdirSync(path.join(root, 'build'), { recursive: true });
  writeFileSync(path.join(root, 'electron', 'icons', 'tray.png'), at(32));
  writeFileSync(path.join(root, 'electron', 'icons', 'tray@2x.png'), at(64));
  writeFileSync(path.join(root, 'build', 'icon.ico'), toIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: at(size) }))));
  writeFileSync(path.join(root, 'build', 'icon.png'), at(256));
  console.log('icons written');
  app.quit();
});

// Renders the Outcast logo to the app icons. Run once with: npx electron scripts/make-icons.cjs
//   electron/icons/tray.png (32 px, tray + window), build/icon.ico (16–256 px, installer + exe)
// Alternative app: npx electron scripts/make-icons.cjs backseat -> yellow "BR" race plate in
//   electron/icons/backseat/ and build/backseat/.
const { app, BrowserWindow, nativeImage } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const BACKSEAT = process.argv.includes('backseat');

// Light Outcast logo (brand/outcast/logo-light.png) on a dark round badge, so it shows on light and dark taskbars.
const LOGO = path.join(__dirname, '..', '..', '..', 'brand', 'outcast', 'logo-light.png');
const OUTCAST_HTML = `<style>html, body { margin: 0; background: transparent; overflow: hidden; }
  .b { position: absolute; left: 4px; top: 4px; width: 240px; height: 240px; border-radius: 50%; background: #0a0a0a;
       border: 4px solid rgba(229, 229, 229, 0.45); display: grid; place-items: center; }
  .b img { width: 206px; margin: 0 0 4px 6px; }
</style><div class="b"><img src="${'file:///' + LOGO.replace(/\\/g, '/')}"></div>`;

// Signal-yellow plate, slightly slanted, with "BR" in Barlow Condensed Black Italic.
const FONT = path.join(__dirname, '..', 'node_modules', '@fontsource', 'barlow-condensed', 'files', 'barlow-condensed-latin-900-italic.woff2');
const BACKSEAT_HTML = `<style>@font-face { font-family: BR; src: url('${'file:///' + FONT.replace(/\\/g, '/')}'); }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  .p { position: absolute; left: 22px; top: 36px; width: 212px; height: 184px; border-radius: 44px; background: #ffd60a; transform: skewX(-8deg);
       display: grid; place-items: center; }
  .p span { transform: skewX(8deg); font: italic 900 160px/1 BR; color: #111214; letter-spacing: -4px; margin-top: 6px; }
</style><div class="p"><span>BR</span></div>`;

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
  // A file page, so the font (backseat) or the logo can be loaded from disk.
  const page = path.join(tmpdir(), BACKSEAT ? 'backseat-icon.html' : 'outcast-icon.html');
  writeFileSync(page, BACKSEAT ? BACKSEAT_HTML : OUTCAST_HTML);
  await win.loadFile(page);
  await win.webContents.executeJavaScript(BACKSEAT ? 'document.fonts.ready.then(() => true)' : 'document.images[0].decode().then(() => true)');
  await new Promise((r) => setTimeout(r, 300));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const at = (size) => nativeImage.createFromBuffer(full.toPNG()).resize({ width: size, height: size, quality: 'best' }).toPNG();

  const root = path.join(__dirname, '..');
  const sub = BACKSEAT ? 'backseat' : '';
  const icons = path.join(root, 'electron', 'icons', sub);
  const build = path.join(root, 'build', sub);
  mkdirSync(icons, { recursive: true });
  mkdirSync(build, { recursive: true });
  writeFileSync(path.join(icons, 'tray.png'), at(32));
  writeFileSync(path.join(icons, 'tray@2x.png'), at(64));
  writeFileSync(path.join(build, 'icon.ico'), toIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: at(size) }))));
  writeFileSync(path.join(build, 'icon.png'), at(256));
  console.log('icons written');
  app.quit();
});

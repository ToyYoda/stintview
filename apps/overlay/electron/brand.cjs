// Which app this is: StintView (default) or the alternative "Backseat Racer" – same code, own
// name, logo, colours, installer, data folder and update channel, so both can run side by side.
// Packaged: the "brand" field electron-builder writes into package.json (electron-builder.backseat.yml).
// Development / tests: STINTVIEW_BRAND=backseat.
const path = require('node:path');

const BRANDS = {
  stintview: {
    id: 'stintview',
    name: 'StintView',
    appId: 'com.outcastendurance.stintview',
    // %APPDATA%\StintView: team credentials, settings, logs (unchanged since the first version).
    dataDirName: 'StintView',
    icons: '',
    updateChannel: null, // latest.yml
  },
  backseat: {
    id: 'backseat',
    name: 'Backseat Racer',
    appId: 'com.outcastendurance.backseatracer',
    dataDirName: 'Backseat Racer',
    icons: 'backseat',
    updateChannel: 'backseat', // backseat.yml in the same GitHub release
  },
};

function brandId() {
  const fromEnv = process.env.STINTVIEW_BRAND;
  if (fromEnv && BRANDS[fromEnv]) return fromEnv;
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    if (pkg.brand && BRANDS[pkg.brand]) return pkg.brand;
  } catch { /* default */ }
  return 'stintview';
}

const brand = BRANDS[brandId()];

/**
 * Texts written for StintView, in the alternative app's name. Installer and data folder are
 * the alternative app's own (BackseatRacer-Setup.exe, %APPDATA%\Backseat Racer). Same rules as the website (site/strings.mjs).
 */
function brandText(text) {
  if (brand.id === 'stintview' || typeof text !== 'string') return text;
  return text
    .replace(/StintView-Setup\.exe/g, 'BackseatRacer-Setup.exe')
    .replace(/%APPDATA%\\StintView/g, '%APPDATA%\\Backseat Racer')
    .replace(/(?<![\\/\w])StintViews(?!\w)/g, 'Backseat-Racer-Apps')
    .replace(/(?<![\\/\w])StintView-(?!Setup)/g, 'Backseat-Racer-')
    .replace(/(?<![\\/\w])StintView(?![-\w]|\.\w)/g, 'Backseat Racer');
}

module.exports = { brand, brandText };

// The VR recenter key/button from iRacing, read along by rawinput-proc.cjs (utility process).
const { utilityProcess } = require('electron');
const path = require('node:path');

const LEARN_MS = 20000;

let proc = null;
let binding = null;
let onPress = () => {};
/** Pending learn: { resolve, timer } */
let learning = null;

function log(msg) {
  console.log(`[recenter] ${msg}`);
}

function ensureProc() {
  if (proc) return proc;
  proc = utilityProcess.fork(path.join(__dirname, 'rawinput-proc.cjs'), [], { serviceName: 'StintView Recenter', stdio: 'pipe' });
  proc.stdout?.on('data', (d) => log(String(d).trim()));
  proc.stderr?.on('data', (d) => log(String(d).trim()));
  proc.on('message', (m) => {
    if (m?.t === 'pressed') {
      log('iRacing recenter key pressed');
      onPress();
    } else if (m?.t === 'learned') {
      log(`learned: ${m.binding.name}`);
      finishLearn(m.binding);
    } else if (m?.t === 'learn-cancel') {
      finishLearn(null);
    } else if (m?.t === 'error') {
      log(`error: ${m.text}`);
    }
  });
  proc.on('exit', (code) => {
    if (code) log(`stopped (${code})`);
    proc = null;
    finishLearn(null);
  });
  if (binding) proc.postMessage({ t: 'watch', binding });
  return proc;
}

function finishLearn(result) {
  if (!learning) return;
  clearTimeout(learning.timer);
  const { resolve } = learning;
  learning = null;
  resolve(result);
}

function stopProc() {
  if (!proc) return;
  proc.postMessage({ t: 'stop' });
  const p = proc;
  setTimeout(() => p.kill(), 1000);
  proc = null;
}

/** Watch for this key/button (null = stop watching); `press` is called on each press. */
function watchRecenter(b, press) {
  binding = b ?? null;
  onPress = press;
  if (binding) ensureProc().postMessage({ t: 'watch', binding });
  else if (!learning) stopProc();
  else proc?.postMessage({ t: 'watch', binding: null });
}

/** The next key or button pressed anywhere; null after Escape or 20 s. */
function learnRecenter() {
  finishLearn(null);
  return new Promise((resolve) => {
    learning = { resolve, timer: setTimeout(() => { proc?.postMessage({ t: 'cancel' }); finishLearn(null); }, LEARN_MS) };
    ensureProc().postMessage({ t: 'learn' });
  });
}

function cancelLearnRecenter() {
  proc?.postMessage({ t: 'cancel' });
  finishLearn(null);
}

module.exports = { watchRecenter, learnRecenter, cancelLearnRecenter };

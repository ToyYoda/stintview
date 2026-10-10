// Utility process: watches the key/button that recenters VR in iRacing. Only reads along –
// iRacing still gets every key and button.
// - Keys: Windows Raw Input for the keyboard (a message per keystroke).
// - Wheel/button box buttons: the Windows joystick API (joyGetPosEx), polled 30 times a
//   second – it reads the state Windows keeps anyway. Raw Input for controllers only while
//   learning: a wheel base sends up to 1000 reports a second, and handling each of them all
//   the time cost a lot of CPU and made iRacing stutter (0.21.0, MOZA R12).
// - Fallback for buttons above 32 (the joystick API knows 32): Raw Input as while learning.
//
// parent -> { t: 'watch', binding } | { t: 'learn' } | { t: 'cancel' } | { t: 'stop' }
// child  -> { t: 'pressed' } | { t: 'learned', binding } | { t: 'learn-cancel' } | { t: 'error' | 'log', text }
//
// binding: { kind: 'key', vkey, e0, mods: number[], name } | { kind: 'button', device, button, name }
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const hid = koffi.load('hid.dll');
const kernel32 = koffi.load('kernel32.dll');
const winmm = koffi.load('winmm.dll');

const RAWINPUTDEVICE = koffi.struct('RAWINPUTDEVICE', { usUsagePage: 'uint16_t', usUsage: 'uint16_t', dwFlags: 'uint32_t', hwndTarget: 'void *' });
const POINT = koffi.struct('POINT', { x: 'int32_t', y: 'int32_t' });
const JOYINFOEX = koffi.struct('JOYINFOEX', Object.fromEntries(
  ['dwSize', 'dwFlags', 'dwXpos', 'dwYpos', 'dwZpos', 'dwRpos', 'dwUpos', 'dwVpos', 'dwButtons', 'dwButtonNumber', 'dwPOV', 'dwReserved1', 'dwReserved2'].map((k) => [k, 'uint32_t'])));
const JOYCAPSW = koffi.struct('JOYCAPSW', {
  wMid: 'uint16_t', wPid: 'uint16_t', szPname: koffi.array('char16_t', 32),
  ...Object.fromEntries(['wXmin', 'wXmax', 'wYmin', 'wYmax', 'wZmin', 'wZmax', 'wNumButtons', 'wPeriodMin', 'wPeriodMax', 'wRmin', 'wRmax',
    'wUmin', 'wUmax', 'wVmin', 'wVmax', 'wCaps', 'wMaxAxes', 'wNumAxes', 'wMaxButtons'].map((k) => [k, 'uint32_t'])),
  szRegKey: koffi.array('char16_t', 32), szOEMVxD: koffi.array('char16_t', 260),
});
const MSG = koffi.struct('MSG', { hwnd: 'void *', message: 'uint32_t', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32_t', pt: POINT, lPrivate: 'uint32_t' });

const CreateWindowExW = user32.func('void *CreateWindowExW(uint32_t ex, const char16_t *cls, const char16_t *name, uint32_t style, int x, int y, int w, int h, intptr_t parent, void *menu, void *inst, void *param)');
const DestroyWindow = user32.func('bool DestroyWindow(void *hwnd)');
const RegisterRawInputDevices = user32.func('bool RegisterRawInputDevices(RAWINPUTDEVICE *devices, uint32_t count, uint32_t size)');
const PeekMessageW = user32.func('bool PeekMessageW(_Out_ MSG *msg, void *hwnd, uint32_t min, uint32_t max, uint32_t remove)');
const DispatchMessageW = user32.func('intptr_t DispatchMessageW(MSG *msg)');
const GetRawInputData = user32.func('uint32_t GetRawInputData(intptr_t raw, uint32_t cmd, uint8_t *data, _Inout_ uint32_t *size, uint32_t header)');
const GetRawInputDeviceInfoW = user32.func('uint32_t GetRawInputDeviceInfoW(void *device, uint32_t cmd, uint8_t *data, _Inout_ uint32_t *size)');
const GetKeyNameTextW = user32.func('int GetKeyNameTextW(int32_t lParam, uint8_t *buf, int size)');
const GetLastError = kernel32.func('uint32_t GetLastError()');
const CreateFileW = kernel32.func('intptr_t CreateFileW(const char16_t *name, uint32_t access, uint32_t share, void *sec, uint32_t disposition, uint32_t flags, void *template)');
const CloseHandle = kernel32.func('bool CloseHandle(intptr_t h)');
const HidP_MaxUsageListLength = hid.func('uint32_t HidP_MaxUsageListLength(int32_t type, uint16_t page, uint8_t *preparsed)');
const HidP_GetUsages = hid.func('uint32_t HidP_GetUsages(int32_t type, uint16_t page, uint16_t link, uint16_t *usages, _Inout_ uint32_t *length, uint8_t *preparsed, uint8_t *report, uint32_t reportLength)');
const HidD_GetProductString = hid.func('bool HidD_GetProductString(intptr_t h, uint8_t *buf, uint32_t size)');
const joyGetNumDevs = winmm.func('uint32_t joyGetNumDevs()');
const joyGetDevCapsW = winmm.func('uint32_t joyGetDevCapsW(uintptr_t id, _Out_ JOYCAPSW *caps, uint32_t size)');
const joyGetPosEx = winmm.func('uint32_t joyGetPosEx(uint32_t id, _Inout_ JOYINFOEX *info)');

const HWND_MESSAGE = -3;
const RIDEV_INPUTSINK = 0x100, RIDEV_REMOVE = 0x1;
const JOY_RETURNBUTTONS = 0x80, JOYERR_NOERROR = 0;
const JOY_POLL_MS = 33;
/** A wheel that is gone (unplugged, off) is looked for again this often – enumerating can hitch. */
const JOY_RETRY_MS = 60000;
const WM_INPUT = 0xff;
const PM_REMOVE = 1;
const RID_INPUT = 0x10000003;
const RIDI_PREPARSEDDATA = 0x20000005;
const RIDI_DEVICENAME = 0x20000007;
const RIM_TYPEKEYBOARD = 1, RIM_TYPEHID = 2;
const HEADER = 24; // RAWINPUTHEADER on 64-bit
const RI_KEY_BREAK = 1, RI_KEY_E0 = 2;
const HIDP_INPUT = 0, PAGE_BUTTON = 9, HIDP_STATUS_SUCCESS = 0x110000;
const VK_ESCAPE = 0x1b;
const MODIFIERS = new Set([0x10, 0x11, 0x12, 0x5b, 0x5c]); // Shift, Ctrl, Alt, Win
const POLL_MS = 15;
const REPEAT_MS = 500; // one recenter per press, also with bouncing buttons

let mode = 'idle'; // 'idle' | 'watch' | 'learn'
let binding = null;
let lastPressed = 0;
const heldKeys = new Set();
/** hDevice -> { name, path, preparsed, maxUsages, pressed: Set, primed } */
const devices = new Map();

const send = (m) => process.parentPort.postMessage(m);

// --- window and registration ------------------------------------------------

const hwnd = CreateWindowExW(0, 'STATIC', 'StintView raw input', 0, 0, 0, 0, 0, HWND_MESSAGE, null, null, null);
if (!hwnd) {
  send({ t: 'error', text: `CreateWindowEx failed (${GetLastError()})` });
  process.exit(1);
}
const KEYBOARD = [6];
const CONTROLLERS = [4, 5, 8]; // joystick (wheels, button boxes), gamepad, multi-axis controller
/** Raw Input usages registered now. */
const registered = new Set();

/** Registers/unregisters Raw Input usages; INPUTSINK = also while iRacing has the focus. */
function setRawInput(usages, on) {
  const change = usages.filter((u) => registered.has(u) !== on);
  if (!change.length) return;
  const list = change.map((usage) => ({ usUsagePage: 1, usUsage: usage, dwFlags: on ? RIDEV_INPUTSINK : RIDEV_REMOVE, hwndTarget: on ? hwnd : null }));
  if (!RegisterRawInputDevices(list, list.length, koffi.sizeof(RAWINPUTDEVICE))) {
    return send({ t: 'error', text: `RegisterRawInputDevices failed (${GetLastError()})` });
  }
  for (const u of change) if (on) registered.add(u); else registered.delete(u);
  if (on && change.some((u) => CONTROLLERS.includes(u))) for (const d of devices.values()) d.primed = false;
}

// --- buttons through the joystick API --------------------------------------------------

/** { ids: joystick ids of the device, bit, down, primed, lookedAt } for a button binding. */
let joy = null;

/** Joystick ids (winmm) of the device with this VID/PID; checks every id once – can hitch. */
function findJoysticks(vid, pid) {
  const ids = [];
  const caps = {};
  const n = Math.min(joyGetNumDevs(), 16);
  for (let id = 0; id < n; id++) {
    if (joyGetDevCapsW(id, caps, koffi.sizeof(JOYCAPSW)) === JOYERR_NOERROR && caps.wMid === vid && caps.wPid === pid) ids.push(id);
  }
  return ids;
}

/** Sets up polling for a button binding; false = not possible (use Raw Input). */
function setupJoystick() {
  joy = null;
  if (binding?.kind !== 'button' || binding.button > 32) return false;
  const m = /vid_([0-9a-f]{4})&pid_([0-9a-f]{4})/i.exec(binding.device);
  if (!m) return false;
  const vid = parseInt(m[1], 16), pid = parseInt(m[2], 16);
  joy = { vid, pid, ids: findJoysticks(vid, pid), bit: 2 ** (binding.button - 1), down: false, primed: false, lookedAt: Date.now() };
  if (!joy.ids.length) send({ t: 'log', text: `joystick ${m[0]} not found, retrying every ${JOY_RETRY_MS / 1000} s` });
  return true;
}

function pollJoystick() {
  if (!joy || mode !== 'watch') return;
  if (!joy.ids.length) {
    if (Date.now() - joy.lookedAt < JOY_RETRY_MS) return;
    joy.lookedAt = Date.now();
    joy.ids = findJoysticks(joy.vid, joy.pid);
    joy.primed = false;
    return;
  }
  const info = { dwSize: koffi.sizeof(JOYINFOEX), dwFlags: JOY_RETURNBUTTONS };
  let buttons = 0, ok = false;
  for (const id of joy.ids) {
    if (joyGetPosEx(id, info) === JOYERR_NOERROR) { ok = true; buttons |= info.dwButtons; }
  }
  if (!ok) { joy.ids = []; joy.lookedAt = Date.now(); return; } // unplugged: look again later
  const down = (buttons & joy.bit) !== 0;
  if (down && !joy.down && joy.primed) fire();
  joy.down = down;
  joy.primed = true; // a button held when watching starts isn't a press
}

/** What to listen to for the current mode and binding. */
function updateSources() {
  const learning = mode === 'learn';
  const viaJoystick = !learning && mode === 'watch' && setupJoystick();
  if (learning || mode !== 'watch') joy = null;
  setRawInput(KEYBOARD, learning || (mode === 'watch' && binding?.kind === 'key'));
  setRawInput(CONTROLLERS, learning || (mode === 'watch' && binding?.kind === 'button' && !viaJoystick));
  if (mode === 'watch' && binding?.kind === 'button') {
    send({ t: 'log', text: viaJoystick ? `watching ${binding.name} (joystick API)` : `watching ${binding.name} (Raw Input – button above 32 or no VID/PID)` });
  }
}

// --- devices ------------------------------------------------------------------

function deviceInfo(hDevice) {
  const key = koffi.address(hDevice);
  let d = devices.get(key);
  if (d) return d;
  const size = [0];
  GetRawInputDeviceInfoW(hDevice, RIDI_DEVICENAME, null, size);
  const nameBuf = Buffer.alloc(size[0] * 2 + 2);
  GetRawInputDeviceInfoW(hDevice, RIDI_DEVICENAME, nameBuf, [size[0] + 1]);
  const name = nameBuf.toString('utf16le').replace(/\0.*$/s, '');
  size[0] = 0;
  GetRawInputDeviceInfoW(hDevice, RIDI_PREPARSEDDATA, null, size);
  let preparsed = null, maxUsages = 0;
  if (size[0] > 0) {
    preparsed = Buffer.alloc(size[0]);
    if (GetRawInputDeviceInfoW(hDevice, RIDI_PREPARSEDDATA, preparsed, size) === 0xffffffff) preparsed = null;
    else maxUsages = HidP_MaxUsageListLength(HIDP_INPUT, PAGE_BUTTON, preparsed);
  }
  d = { name: name.toLowerCase(), path: name, preparsed, maxUsages, pressed: new Set(), primed: false };
  devices.set(key, d);
  return d;
}

/** The device's product name ("Simucube 2 Pro"), else a short form of its path. */
function productName(path) {
  const h = CreateFileW(path, 0, 3 /* share read/write */, null, 3 /* open existing */, 0, null);
  if (h !== -1 && h !== 0) {
    const buf = Buffer.alloc(256);
    const ok = HidD_GetProductString(h, buf, buf.length);
    CloseHandle(h);
    const text = ok ? buf.toString('utf16le').replace(/\0.*$/s, '').trim() : '';
    if (text) return text;
  }
  return /vid_[0-9a-f]{4}&pid_[0-9a-f]{4}/i.exec(path)?.[0].toUpperCase() ?? 'HID';
}

function keyName(vkey, makeCode, e0) {
  const buf = Buffer.alloc(128);
  const n = GetKeyNameTextW((makeCode << 16) | (e0 ? 1 << 24 : 0), buf, 64);
  if (n > 0) return buf.toString('utf16le', 0, n * 2);
  // Windows has no name for F13–F24 (often used by button boxes and macro keys).
  return vkey >= 0x70 && vkey <= 0x87 ? `F${vkey - 0x6f}` : `VK ${vkey}`;
}

const modsHeld = () => [...heldKeys].filter((vk) => MODIFIERS.has(vk & 0xff)).map((vk) => vk & 0xff).sort((a, b) => a - b);

// --- events ---------------------------------------------------------------------

function fire() {
  const now = Date.now();
  if (now - lastPressed < REPEAT_MS) return;
  lastPressed = now;
  send({ t: 'pressed' });
}

function onKey(buf) {
  const makeCode = buf.readUInt16LE(HEADER), flags = buf.readUInt16LE(HEADER + 2), vkey = buf.readUInt16LE(HEADER + 6);
  if (vkey === 0xff) return; // fake key of some key combinations
  const e0 = Boolean(flags & RI_KEY_E0);
  const id = vkey | (e0 ? 0x100 : 0);
  if (flags & RI_KEY_BREAK) { heldKeys.delete(id); return; }
  if (heldKeys.has(id)) return; // auto repeat
  const mods = modsHeld();
  heldKeys.add(id);
  if (mode === 'learn') {
    if (vkey === VK_ESCAPE) { mode = binding ? 'watch' : 'idle'; updateSources(); return send({ t: 'learn-cancel' }); }
    if (MODIFIERS.has(vkey)) return; // wait for the key that goes with it
    const names = mods.map((m) => ({ 0x10: 'Shift', 0x11: 'Ctrl', 0x12: 'Alt', 0x5b: 'Win', 0x5c: 'Win' })[m]);
    return learned({ kind: 'key', vkey, e0, mods, name: [...names, keyName(vkey, makeCode, e0)].join('+') });
  }
  if (mode === 'watch' && binding?.kind === 'key' && binding.vkey === vkey && Boolean(binding.e0) === e0
    && binding.mods.join() === mods.join()) fire();
}

function onHid(buf, hDevice) {
  const d = deviceInfo(hDevice);
  if (!d.preparsed || !d.maxUsages) return;
  const sizeHid = buf.readUInt32LE(HEADER), count = buf.readUInt32LE(HEADER + 4);
  const usages = new Uint16Array(d.maxUsages);
  for (let i = 0; i < count; i++) {
    const report = buf.subarray(HEADER + 8 + i * sizeHid, HEADER + 8 + (i + 1) * sizeHid);
    const length = [d.maxUsages];
    // Reports without buttons (other report ids) don't touch the button state.
    if (HidP_GetUsages(HIDP_INPUT, PAGE_BUTTON, 0, usages, length, d.preparsed, report, report.length) !== HIDP_STATUS_SUCCESS) continue;
    const now = new Set(usages.subarray(0, length[0]));
    // First report of a device: buttons already down (e.g. switches that stay on) aren't presses.
    if (!d.primed) { d.primed = true; d.pressed = now; continue; }
    for (const button of now) {
      if (d.pressed.has(button)) continue;
      if (mode === 'learn') learned({ kind: 'button', device: d.name, button, name: `${productName(d.path)} – ${button}` });
      else if (mode === 'watch' && binding?.kind === 'button' && binding.device === d.name && binding.button === button) fire();
    }
    d.pressed = now;
  }
}

function learned(b) {
  binding = b;
  mode = 'watch';
  lastPressed = Date.now(); // the learning press itself doesn't recenter
  send({ t: 'learned', binding: b });
  updateSources();
}

// --- message loop ------------------------------------------------------------------

let buf = Buffer.alloc(1024);
function pump() {
  const msg = {};
  while (PeekMessageW(msg, null, 0, 0, PM_REMOVE)) {
    if (msg.message === WM_INPUT) {
      try {
        const size = [0];
        GetRawInputData(msg.lParam, RID_INPUT, null, size, HEADER);
        if (size[0] > buf.length) buf = Buffer.alloc(size[0]);
        if (GetRawInputData(msg.lParam, RID_INPUT, buf, size, HEADER) !== 0xffffffff) {
          const type = buf.readUInt32LE(0);
          if (type === RIM_TYPEKEYBOARD) onKey(buf);
          else if (type === RIM_TYPEHID && mode !== 'idle') onHid(buf.subarray(0, size[0]), koffi.decode(buf, 8, 'void *'));
        }
      } catch (e) {
        send({ t: 'error', text: e.message });
      }
    }
    DispatchMessageW(msg); // DefWindowProc cleans up after WM_INPUT
  }
}
const timer = setInterval(pump, POLL_MS);
const joyTimer = setInterval(pollJoystick, JOY_POLL_MS);

process.parentPort.on('message', (e) => {
  const m = e.data;
  if (m?.t === 'watch') {
    const same = JSON.stringify(binding) === JSON.stringify(m.binding ?? null), before = mode;
    binding = m.binding ?? null;
    if (mode !== 'learn') mode = binding ? 'watch' : 'idle';
    if (!same || mode !== before) updateSources(); // looking for the joystick again can hitch
  } else if (m?.t === 'learn') {
    mode = 'learn';
    updateSources();
  } else if (m?.t === 'cancel' && mode === 'learn') {
    mode = binding ? 'watch' : 'idle';
    updateSources();
  } else if (m?.t === 'stop') {
    clearInterval(timer);
    clearInterval(joyTimer);
    DestroyWindow(hwnd);
    process.exit(0);
  }
});

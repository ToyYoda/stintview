// Utility process: watches keyboards and game controllers (wheels, button boxes) with Windows
// Raw Input, for the key/button that recenters VR in iRacing. Raw Input only reads along –
// iRacing still gets every key and button. Runs on its own: a wheel sends up to 1000 reports
// a second, which must not land on the app's main thread.
//
// parent -> { t: 'watch', binding } | { t: 'learn' } | { t: 'cancel' } | { t: 'stop' }
// child  -> { t: 'pressed' } | { t: 'learned', binding } | { t: 'learn-cancel' } | { t: 'error', text }
//
// binding: { kind: 'key', vkey, e0, mods: number[], name } | { kind: 'button', device, button, name }
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const hid = koffi.load('hid.dll');
const kernel32 = koffi.load('kernel32.dll');

const RAWINPUTDEVICE = koffi.struct('RAWINPUTDEVICE', { usUsagePage: 'uint16_t', usUsage: 'uint16_t', dwFlags: 'uint32_t', hwndTarget: 'void *' });
const POINT = koffi.struct('POINT', { x: 'int32_t', y: 'int32_t' });
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

const HWND_MESSAGE = -3;
const RIDEV_INPUTSINK = 0x100;
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
// Keyboard, joystick (wheels, button boxes), gamepad, multi-axis controller; INPUTSINK = also
// while another program (iRacing) has the focus.
const wanted = [6, 4, 5, 8].map((usage) => ({ usUsagePage: 1, usUsage: usage, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }));
if (!RegisterRawInputDevices(wanted, wanted.length, koffi.sizeof(RAWINPUTDEVICE))) {
  send({ t: 'error', text: `RegisterRawInputDevices failed (${GetLastError()})` });
  process.exit(1);
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
    if (vkey === VK_ESCAPE) { mode = binding ? 'watch' : 'idle'; return send({ t: 'learn-cancel' }); }
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

process.parentPort.on('message', (e) => {
  const m = e.data;
  if (m?.t === 'watch') { binding = m.binding ?? null; if (mode !== 'learn') mode = binding ? 'watch' : 'idle'; }
  else if (m?.t === 'learn') mode = 'learn';
  else if (m?.t === 'cancel' && mode === 'learn') mode = binding ? 'watch' : 'idle';
  else if (m?.t === 'stop') {
    clearInterval(timer);
    DestroyWindow(hwnd);
    process.exit(0);
  }
});

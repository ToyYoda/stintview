import koffi from 'koffi';

// iRacing remote control ("broadcast messages"), see vendor/irsdk/irsdk_defines.h.
export const BroadcastMsg = {
  CamSwitchPos: 0, // car position, group, camera
  CamSwitchNum: 1, // car number, group, camera
} as const;

/** irsdk_csMode: pseudo car numbers for camera commands. */
export const CamFocus = { AtIncident: -3, AtLeader: -2, AtExiting: -1 } as const;

const HWND_BROADCAST = 0xffff;

let send: ((msg: number, var1: number, var2: number) => boolean) | null = null;

function init() {
  const user32 = koffi.load('user32.dll');
  const RegisterWindowMessageA = user32.func('uint32_t __stdcall RegisterWindowMessageA(const char *name)');
  const SendNotifyMessageA = user32.func('bool __stdcall SendNotifyMessageA(uintptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)');
  const msgId = RegisterWindowMessageA('IRSDK_BROADCASTMSG');
  if (!msgId) throw new Error('RegisterWindowMessage(IRSDK_BROADCASTMSG) failed');
  send = (msg, var1, var2) => SendNotifyMessageA(HWND_BROADCAST, msgId, packWords(msg, var1), var2);
}

/** MAKELONG(low, high) with both halves as 16-bit values (negative numbers allowed). */
export function packWords(low: number, high: number): number {
  return ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
}

/** irsdk_broadcastMsg(msg, var1, var2, var3): var2/var3 are 16 bit, packed into lParam. */
export function broadcast(msg: number, var1: number, var2 = 0, var3 = 0): boolean {
  if (!send) init();
  return send!(msg, var1, packWords(var2, var3));
}

/** Points the local iRacing camera at a car number (or a CamFocus mode) using camera group/camera. */
export function switchCamera(carNumber: number, group: number, camera = 0): boolean {
  return broadcast(BroadcastMsg.CamSwitchNum, carNumber, group, camera);
}

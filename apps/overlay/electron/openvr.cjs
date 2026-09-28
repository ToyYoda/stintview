// Minimal OpenVR overlay binding via koffi (FFI), no native build needed.
// Function table layout: vendor/openvr/openvr_capi.h (IVROverlay_028).
const koffi = require('koffi');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const IVROVERLAY = 'FnTable:IVROverlay_028';

const APP_OVERLAY = 2;
const APP_BACKGROUND = 3;
const UNIVERSE_SEATED = 0;
const FLAG_IS_PREMULTIPLIED = 2097152;
/** Upload rejected, e.g. while the compositor is still busy with the previous one. Retry next frame. */
const TRANSIENT_ERRORS = new Set([23 /* RequestFailed */, 34 /* TimedOut */]);

/** Index of each member in VR_IVROverlay_FnTable. */
const FN = {
  CreateOverlay: 1,
  DestroyOverlay: 3,
  GetOverlayErrorNameFromEnum: 8,
  SetOverlayFlag: 11,
  SetOverlayAlpha: 16,
  SetOverlayWidthInMeters: 22,
  SetOverlayTransformAbsolute: 33,
  ShowOverlay: 43,
  HideOverlay: 44,
  IsOverlayVisible: 45,
  SetOverlayTexture: 60,
  SetOverlayRaw: 62,
  GetOverlayTextureSize: 66,
};

const HmdMatrix34 = koffi.struct('HmdMatrix34_t', { m: koffi.array('float', 12) });
const Texture = koffi.struct('Texture_t', { handle: 'void *', eType: 'int32_t', eColorSpace: 'int32_t' });
const TEXTURE_DIRECTX = 0;
const COLORSPACE_AUTO = 0;

const PROTO = {
  CreateOverlay: koffi.proto('int32_t CreateOverlay(const char *key, const char *name, _Out_ uint64_t *handle)'),
  DestroyOverlay: koffi.proto('int32_t DestroyOverlay(uint64_t handle)'),
  GetOverlayErrorNameFromEnum: koffi.proto('const char *GetOverlayErrorNameFromEnum(int32_t error)'),
  SetOverlayFlag: koffi.proto('int32_t SetOverlayFlag(uint64_t handle, uint32_t flag, bool enabled)'),
  SetOverlayAlpha: koffi.proto('int32_t SetOverlayAlpha(uint64_t handle, float alpha)'),
  SetOverlayWidthInMeters: koffi.proto('int32_t SetOverlayWidthInMeters(uint64_t handle, float width)'),
  SetOverlayTransformAbsolute: koffi.proto('int32_t SetOverlayTransformAbsolute(uint64_t handle, int32_t origin, HmdMatrix34_t *m)'),
  ShowOverlay: koffi.proto('int32_t ShowOverlay(uint64_t handle)'),
  HideOverlay: koffi.proto('int32_t HideOverlay(uint64_t handle)'),
  SetOverlayRaw: koffi.proto('int32_t SetOverlayRaw(uint64_t handle, void *buffer, uint32_t width, uint32_t height, uint32_t bpp)'),
  IsOverlayVisible: koffi.proto('bool IsOverlayVisible(uint64_t handle)'),
  SetOverlayTexture: koffi.proto('int32_t SetOverlayTexture(uint64_t handle, Texture_t *texture)'),
  GetOverlayTextureSize: koffi.proto('int32_t GetOverlayTextureSize(uint64_t handle, _Out_ uint32_t *w, _Out_ uint32_t *h)'),
};

/** openvr_api.dll shipped with the installed SteamVR runtime (from openvrpaths.vrpath). */
function findOpenVrDll() {
  const vrpath = path.join(process.env.LOCALAPPDATA ?? '', 'openvr', 'openvrpaths.vrpath');
  const runtimes = JSON.parse(readFileSync(vrpath, 'utf8')).runtime ?? [];
  for (const r of runtimes) {
    const dll = path.join(r, 'bin', 'win64', 'openvr_api.dll');
    try {
      readFileSync(dll, { flag: 'r' }).length;
      return dll;
    } catch { /* try next */ }
  }
  throw new Error('SteamVR runtime not found (openvrpaths.vrpath)');
}

class OpenVR {
  constructor(dllPath = findOpenVrDll()) {
    this.lib = koffi.load(dllPath);
    this.api = {
      InitInternal2: this.lib.func('intptr_t VR_InitInternal2(_Out_ int32_t *err, int32_t type, const char *startupInfo)'),
      ShutdownInternal: this.lib.func('void VR_ShutdownInternal()'),
      IsHmdPresent: this.lib.func('bool VR_IsHmdPresent()'),
      IsRuntimeInstalled: this.lib.func('bool VR_IsRuntimeInstalled()'),
      GetGenericInterface: this.lib.func('void *VR_GetGenericInterface(const char *version, _Out_ int32_t *err)'),
      ErrorDescription: this.lib.func('const char *VR_GetVRInitErrorAsEnglishDescription(int32_t err)'),
    };
    this.table = null;
  }

  /**
   * Connects to a running SteamVR. Never launches SteamVR itself: probes with the
   * background app type first, which fails if SteamVR is not running.
   */
  init() {
    const err = [0];
    this.api.InitInternal2(err, APP_BACKGROUND, null);
    if (err[0] !== 0) throw new Error(`SteamVR not available: ${this.api.ErrorDescription(err[0])}`);
    this.api.ShutdownInternal();
    this.api.InitInternal2(err, APP_OVERLAY, null);
    if (err[0] !== 0) throw new Error(`VR init failed: ${this.api.ErrorDescription(err[0])}`);
    const table = this.api.GetGenericInterface(IVROVERLAY, err);
    if (!table || err[0] !== 0) {
      this.api.ShutdownInternal();
      throw new Error(`${IVROVERLAY} not supported by this SteamVR: ${this.api.ErrorDescription(err[0])}`);
    }
    this.table = table;
  }

  shutdown() {
    if (!this.table) return;
    this.table = null;
    this.api.ShutdownInternal();
  }

  call(name, ...args) {
    const fn = koffi.decode(this.table, FN[name] * 8, 'void *');
    return koffi.call(fn, PROTO[name], ...args);
  }

  check(name, ...args) {
    const e = this.call(name, ...args);
    if (e !== 0) {
      const err = new Error(`${name}: ${this.call('GetOverlayErrorNameFromEnum', e)}`);
      err.code = e;
      throw err;
    }
  }

  createOverlay(key, name) {
    const handle = [0];
    this.check('CreateOverlay', key, name, handle);
    this.check('SetOverlayFlag', handle[0], FLAG_IS_PREMULTIPLIED, true);
    return handle[0];
  }

  destroyOverlay(h) { this.call('DestroyOverlay', h); }
  show(h) { this.check('ShowOverlay', h); }
  hide(h) { this.check('HideOverlay', h); }
  setAlpha(h, a) { this.check('SetOverlayAlpha', h, a); }
  setWidth(h, meters) { this.check('SetOverlayWidthInMeters', h, meters); }

  /** Row-major 3x4 transform relative to the seated zero pose (what iRacing's recenter sets). */
  setSeatedTransform(h, m12) {
    this.check('SetOverlayTransformAbsolute', h, UNIVERSE_SEATED, { m: m12 });
  }

  /** What the compositor holds for this overlay – for diagnostics. */
  inspect(h) {
    const w = [0], hh = [0];
    const e = this.call('GetOverlayTextureSize', h, w, hh);
    return { visible: this.call('IsOverlayVisible', h), width: w[0], height: hh[0], error: e };
  }

  /** Hands SteamVR a D3D11 texture; the compositor copies it, so it can be reused afterwards. */
  setTexture(h, d3dTexture) {
    this.check('SetOverlayTexture', h, { handle: d3dTexture, eType: TEXTURE_DIRECTX, eColorSpace: COLORSPACE_AUTO });
  }

  /** RGBA pixels, 4 bytes per pixel. Creates a new texture per call – only for static images. */
  setRaw(h, rgba, width, height) {
    this.check('SetOverlayRaw', h, rgba, width, height, 4);
  }
}

/**
 * Transform for a panel `distance` m in front of the seated origin, `down` m below
 * eye height and `right` m to the side, turned and tilted so it faces the eyes.
 */
function panelTransform({ distance, down, right }) {
  // Panel normal is +Z; point it from the panel towards the origin.
  const yaw = Math.atan2(-right, distance);
  const pitch = -Math.atan2(down, Math.hypot(distance, right));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // R = Ry(yaw) * Rx(pitch); OpenVR: -Z is forward, +Y up.
  return [
    cy, sy * sp, sy * cp, right,
    0, cp, -sp, -down,
    -sy, cy * sp, cy * cp, -distance,
  ];
}

module.exports = { OpenVR, panelTransform, findOpenVrDll, TRANSIENT_ERRORS };

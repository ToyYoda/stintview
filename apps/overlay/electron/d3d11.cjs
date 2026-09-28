// Minimal Direct3D 11 via koffi: one device and BGRA textures we upload CPU pixels into.
// vtable indices checked against the Windows SDK d3d11.h (ID3D11*Vtbl).
const koffi = require('koffi');

const D3D_DRIVER_TYPE_HARDWARE = 1;
const D3D11_SDK_VERSION = 7;
const D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20;
const DXGI_FORMAT_B8G8R8A8_UNORM = 87;
const D3D11_USAGE_DEFAULT = 0;
const D3D11_BIND_SHADER_RESOURCE = 0x8;
const D3D11_RESOURCE_MISC_SHARED = 0x2;

const VT = {
  Release: 2,
  Device_CreateTexture2D: 5,
  Context_UpdateSubresource: 48,
  Context_Flush: 111,
};

const TextureDesc = koffi.struct('D3D11_TEXTURE2D_DESC', {
  Width: 'uint32_t', Height: 'uint32_t', MipLevels: 'uint32_t', ArraySize: 'uint32_t', Format: 'uint32_t',
  SampleCount: 'uint32_t', SampleQuality: 'uint32_t',
  Usage: 'uint32_t', BindFlags: 'uint32_t', CPUAccessFlags: 'uint32_t', MiscFlags: 'uint32_t',
});

const PROTO = {
  Release: koffi.proto('uint32_t Release(void *self)'),
  CreateTexture2D: koffi.proto('int32_t CreateTexture2D(void *self, D3D11_TEXTURE2D_DESC *desc, void *initial, _Out_ void **tex)'),
  UpdateSubresource: koffi.proto('void UpdateSubresource(void *self, void *res, uint32_t sub, void *box, void *data, uint32_t rowPitch, uint32_t depthPitch)'),
  Flush: koffi.proto('void Flush(void *self)'),
};

const d3d11 = koffi.load('d3d11.dll');
const D3D11CreateDevice = d3d11.func(
  'int32_t __stdcall D3D11CreateDevice(void *adapter, int32_t driverType, void *software, uint32_t flags, void *featureLevels, uint32_t numLevels, uint32_t sdkVersion, _Out_ void **device, _Out_ uint32_t *featureLevel, _Out_ void **context)',
);

/** Calls method `index` of a COM object's vtable. */
function com(obj, index, proto, ...args) {
  const vtbl = koffi.decode(obj, 'void *');
  const fn = koffi.decode(vtbl, index * 8, 'void *');
  return koffi.call(fn, proto, obj, ...args);
}

const hex = (hr) => `0x${(hr >>> 0).toString(16)}`;

class D3D11 {
  constructor() {
    const device = [null], context = [null], level = [0];
    const hr = D3D11CreateDevice(null, D3D_DRIVER_TYPE_HARDWARE, null, D3D11_CREATE_DEVICE_BGRA_SUPPORT, null, 0, D3D11_SDK_VERSION, device, level, context);
    if (hr < 0) throw new Error(`D3D11CreateDevice failed ${hex(hr)}`);
    this.device = device[0];
    this.context = context[0];
  }

  createTexture(width, height) {
    const tex = [null];
    const desc = {
      Width: width, Height: height, MipLevels: 1, ArraySize: 1, Format: DXGI_FORMAT_B8G8R8A8_UNORM,
      SampleCount: 1, SampleQuality: 0, Usage: D3D11_USAGE_DEFAULT,
      BindFlags: D3D11_BIND_SHADER_RESOURCE, CPUAccessFlags: 0, MiscFlags: D3D11_RESOURCE_MISC_SHARED,
    };
    const hr = com(this.device, VT.Device_CreateTexture2D, PROTO.CreateTexture2D, desc, null, tex);
    if (hr < 0) throw new Error(`CreateTexture2D ${width}x${height} failed ${hex(hr)}`);
    return tex[0];
  }

  /** Copies tightly packed BGRA pixels into the texture. */
  upload(tex, bgra, width) {
    com(this.context, VT.Context_UpdateSubresource, PROTO.UpdateSubresource, tex, 0, null, bgra, width * 4, 0);
    com(this.context, VT.Context_Flush, PROTO.Flush);
  }

  release(obj) {
    if (obj) com(obj, VT.Release, PROTO.Release);
  }

  destroy() {
    this.release(this.context);
    this.release(this.device);
    this.context = this.device = null;
  }
}

module.exports = { D3D11 };

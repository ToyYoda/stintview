import koffi from 'koffi';
import {
  Frame, HEADER_SIZE, STATUS_CONNECTED, VAR_HEADER_SIZE, readHeader, readVarHeaders,
  type Header, type TelemetrySource, type VarHeader,
} from './layout.ts';

const MEM_NAME = 'Local\\IRSDKMemMapFileName';
const FILE_MAP_READ = 0x0004;
/** The mapping outlives the sim with a frozen last frame; no new tick for this long = not running. */
const FROZEN_MS = 2000;

const kernel32 = koffi.load('kernel32.dll');
const OpenFileMappingW = kernel32.func('void* __stdcall OpenFileMappingW(uint32_t, bool, str16)');
const MapViewOfFile = kernel32.func('void* __stdcall MapViewOfFile(void*, uint32_t, uint32_t, uint32_t, size_t)');
const UnmapViewOfFile = kernel32.func('bool __stdcall UnmapViewOfFile(void*)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void*)');
// Copy out of the mapping instead of wrapping it in a Buffer: Electron's V8 memory cage
// forbids external ArrayBuffers (koffi.view), which crashes the recorder inside the app.
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void *dest, uintptr_t src, size_t len)');

interface Mapping { handle: unknown; view: unknown; base: bigint }

/**
 * Reads the iRacing live telemetry shared memory by polling at ~60 Hz.
 * Waits for iRacing to start and reconnects when it restarts.
 */
export class LiveSource implements TelemetrySource {
  private timer: NodeJS.Timeout | null = null;
  private map: Mapping | null = null;
  private vars: Map<string, VarHeader> | null = null;
  private lastTick = -1;
  private lastTickAt = 0;
  private lastSessionUpdate = -1;
  private connected = false;

  constructor(private readonly onConnection: (connected: boolean) => void = () => {}) {}

  start(onFrame: (f: Frame) => void, onSessionInfo: (yaml: string) => void) {
    this.timer = setInterval(() => this.poll(onFrame, onSessionInfo), 1000 / 60);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.close();
  }

  /** Copies `len` bytes at `offset` of the mapping into a new Buffer. */
  private read(offset: number, len: number): Buffer {
    const out = Buffer.alloc(len);
    RtlMoveMemory(out, this.map!.base + BigInt(offset), len);
    return out;
  }

  private header(): Header {
    return readHeader(this.read(0, HEADER_SIZE));
  }

  private poll(onFrame: (f: Frame) => void, onSessionInfo: (yaml: string) => void) {
    if (!this.map && !this.open()) return this.setConnected(false);
    const h = this.header();
    if (!(h.status & STATUS_CONNECTED) || h.numBuf < 1) {
      this.close(); // not in a session; the layout may differ next time
      return this.setConnected(false);
    }

    const now = Date.now();
    const newest = Math.max(...h.varBufs.map((b) => b.tickCount));
    if (newest !== this.lastTick) this.lastTickAt = now;
    else if (now - this.lastTickAt > FROZEN_MS) return this.setConnected(false);
    this.setConnected(true);

    if (!this.vars || h.sessionInfoUpdate !== this.lastSessionUpdate) {
      // Var layout can change between sessions; re-read together with the YAML.
      this.vars = readVarHeaders(this.read(h.varHeaderOffset, h.numVars * VAR_HEADER_SIZE), h.numVars);
      this.lastSessionUpdate = h.sessionInfoUpdate;
      const yaml = this.read(h.sessionInfoOffset, h.sessionInfoLen);
      const end = yaml.indexOf(0);
      onSessionInfo(yaml.subarray(0, end < 0 ? undefined : end).toString('latin1'));
    }

    const rec = this.latestRecord(h);
    if (rec) onFrame(new Frame(this.vars, rec));
  }

  /** Copies the newest buffer, retrying if iRacing overwrote it while copying. */
  private latestRecord(h: Header): Buffer | null {
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = h.varBufs.reduce((a, b) => (b.tickCount > a.tickCount ? b : a));
      if (latest.tickCount === this.lastTick) return null;
      const copy = this.read(latest.bufOffset, h.bufLen);
      const after = this.header().varBufs.find((b) => b.bufOffset === latest.bufOffset);
      if (after?.tickCount === latest.tickCount) {
        this.lastTick = latest.tickCount;
        return copy;
      }
      h = this.header();
    }
    return null;
  }

  private open(): boolean {
    const handle = OpenFileMappingW(FILE_MAP_READ, false, MEM_NAME);
    if (!handle) return false;
    const view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
    if (!view) {
      CloseHandle(handle);
      return false;
    }
    this.map = { handle, view, base: BigInt(koffi.address(view)) };
    return true;
  }

  private close() {
    if (!this.map) return;
    UnmapViewOfFile(this.map.view);
    CloseHandle(this.map.handle);
    this.map = null;
    this.vars = null;
  }

  private setConnected(c: boolean) {
    if (c === this.connected) return;
    this.connected = c;
    if (!c) this.lastSessionUpdate = -1;
    this.onConnection(c);
  }
}

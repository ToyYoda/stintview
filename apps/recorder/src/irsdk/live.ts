import koffi from 'koffi';
import {
  Frame, HEADER_SIZE, STATUS_CONNECTED, VAR_HEADER_SIZE, readHeader, readVarHeaders,
  type Header, type TelemetrySource, type VarHeader,
} from './layout.ts';

const MEM_NAME = 'Local\\IRSDKMemMapFileName';
const FILE_MAP_READ = 0x0004;

const kernel32 = koffi.load('kernel32.dll');
const OpenFileMappingW = kernel32.func('void* __stdcall OpenFileMappingW(uint32_t, bool, str16)');
const MapViewOfFile = kernel32.func('void* __stdcall MapViewOfFile(void*, uint32_t, uint32_t, uint32_t, size_t)');
const UnmapViewOfFile = kernel32.func('bool __stdcall UnmapViewOfFile(void*)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void*)');

function regionSize(h: Header) {
  return Math.max(
    h.sessionInfoOffset + h.sessionInfoLen,
    h.varHeaderOffset + h.numVars * VAR_HEADER_SIZE,
    ...h.varBufs.map((b) => b.bufOffset + h.bufLen),
  );
}

interface Mapping { handle: unknown; view: unknown; mem: Buffer }

/**
 * Reads the iRacing live telemetry shared memory by polling at ~60 Hz.
 * Waits for iRacing to start and reconnects when it restarts.
 */
export class LiveSource implements TelemetrySource {
  private timer: NodeJS.Timeout | null = null;
  private map: Mapping | null = null;
  private vars: Map<string, VarHeader> | null = null;
  private lastTick = -1;
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

  private poll(onFrame: (f: Frame) => void, onSessionInfo: (yaml: string) => void) {
    if (!this.map && !this.open()) return this.setConnected(false);
    const mem = this.map!.mem;
    const h = readHeader(mem);
    if (!(h.status & STATUS_CONNECTED) || h.numBuf < 1 || regionSize(h) > mem.length) {
      // Not in a session yet, or the layout grew: remap on the next poll.
      this.close();
      return this.setConnected(false);
    }
    this.setConnected(true);

    if (!this.vars || h.sessionInfoUpdate !== this.lastSessionUpdate) {
      // Var layout can change between sessions; re-read together with the YAML.
      this.vars = readVarHeaders(mem.subarray(h.varHeaderOffset, h.varHeaderOffset + h.numVars * VAR_HEADER_SIZE), h.numVars);
      this.lastSessionUpdate = h.sessionInfoUpdate;
      const yaml = mem.subarray(h.sessionInfoOffset, h.sessionInfoOffset + h.sessionInfoLen);
      const end = yaml.indexOf(0);
      onSessionInfo(yaml.subarray(0, end < 0 ? undefined : end).toString('latin1'));
    }

    const rec = this.latestRecord(mem, h);
    if (rec) onFrame(new Frame(this.vars, rec));
  }

  /** Copies the newest buffer, retrying if iRacing overwrote it while copying. */
  private latestRecord(mem: Buffer, h: Header): Buffer | null {
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = h.varBufs.reduce((a, b) => (b.tickCount > a.tickCount ? b : a));
      if (latest.tickCount === this.lastTick) return null;
      const copy = Buffer.from(mem.subarray(latest.bufOffset, latest.bufOffset + h.bufLen));
      const after = readHeader(mem).varBufs.find((b) => b.bufOffset === latest.bufOffset);
      if (after?.tickCount === latest.tickCount) {
        this.lastTick = latest.tickCount;
        return copy;
      }
      h = readHeader(mem);
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
    // Map the header first to learn the real size of the region.
    const head = Buffer.from(koffi.view(view, HEADER_SIZE));
    const size = Math.max(HEADER_SIZE, regionSize(readHeader(head)));
    this.map = { handle, view, mem: Buffer.from(koffi.view(view, size)) };
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

/**
 * Binary layout shared by the iRacing live shared memory and .ibt files.
 * See iRacing SDK irsdk_defines.h.
 */

export const HEADER_SIZE = 112;
export const DISK_SUBHEADER_SIZE = 32;
export const VAR_HEADER_SIZE = 144;
export const STATUS_CONNECTED = 1;

export interface Header {
  ver: number;
  status: number;
  tickRate: number;
  sessionInfoUpdate: number;
  sessionInfoLen: number;
  sessionInfoOffset: number;
  numVars: number;
  varHeaderOffset: number;
  numBuf: number;
  bufLen: number;
  /** tickCount + offset for each of the (up to 4) rotating buffers. */
  varBufs: { tickCount: number; bufOffset: number }[];
}

export function readHeader(b: Buffer): Header {
  const numBuf = b.readInt32LE(32);
  const varBufs = [];
  for (let i = 0; i < Math.min(numBuf, 4); i++) {
    varBufs.push({ tickCount: b.readInt32LE(48 + i * 16), bufOffset: b.readInt32LE(52 + i * 16) });
  }
  return {
    ver: b.readInt32LE(0),
    status: b.readInt32LE(4),
    tickRate: b.readInt32LE(8),
    sessionInfoUpdate: b.readInt32LE(12),
    sessionInfoLen: b.readInt32LE(16),
    sessionInfoOffset: b.readInt32LE(20),
    numVars: b.readInt32LE(24),
    varHeaderOffset: b.readInt32LE(28),
    numBuf,
    bufLen: b.readInt32LE(36),
    varBufs,
  };
}

export enum VarType { Char = 0, Bool = 1, Int = 2, BitField = 3, Float = 4, Double = 5 }

export interface VarHeader {
  type: VarType;
  offset: number;
  count: number;
  name: string;
  unit: string;
}

const cstr = (b: Buffer, start: number, len: number) => {
  const s = b.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? len : end).toString('latin1');
};

export function readVarHeaders(b: Buffer, count: number): Map<string, VarHeader> {
  const vars = new Map<string, VarHeader>();
  for (let i = 0; i < count; i++) {
    const o = i * VAR_HEADER_SIZE;
    const name = cstr(b, o + 16, 32);
    vars.set(name, {
      type: b.readInt32LE(o),
      offset: b.readInt32LE(o + 4),
      count: b.readInt32LE(o + 8),
      name,
      unit: cstr(b, o + 112, 32),
    });
  }
  return vars;
}

/** One telemetry tick. Values are read lazily from the record buffer. */
export class Frame {
  constructor(private readonly vars: Map<string, VarHeader>, private readonly buf: Buffer) {}

  has(name: string) {
    return this.vars.has(name);
  }

  /** Number of entries of an array variable (e.g. 64 for CarIdx*), 0 if missing. */
  count(name: string) {
    return this.vars.get(name)?.count ?? 0;
  }

  /** Numeric value of a scalar variable (bools as 0/1). Missing vars read as NaN. */
  num(name: string, index = 0): number {
    const v = this.vars.get(name);
    if (!v) return NaN;
    switch (v.type) {
      case VarType.Char:
      case VarType.Bool: return this.buf.readUInt8(v.offset + index);
      case VarType.Int: return this.buf.readInt32LE(v.offset + index * 4);
      case VarType.BitField: return this.buf.readUInt32LE(v.offset + index * 4);
      case VarType.Float: return this.buf.readFloatLE(v.offset + index * 4);
      case VarType.Double: return this.buf.readDoubleLE(v.offset + index * 8);
    }
  }

  bool(name: string) {
    return this.num(name) === 1;
  }
}

export interface TelemetrySource {
  /** Starts delivering frames. `onSessionInfo` fires on start and whenever the YAML changes. */
  start(onFrame: (f: Frame) => void, onSessionInfo: (yaml: string) => void): void;
  stop(): void;
}

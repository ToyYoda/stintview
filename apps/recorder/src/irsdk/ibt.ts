import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import {
  Frame, HEADER_SIZE, VAR_HEADER_SIZE, readHeader, readVarHeaders,
  type Header, type TelemetrySource, type VarHeader,
} from './layout.ts';

export interface ReplayOptions {
  /** Playback speed multiplier, 1 = real time. */
  speed?: number;
  /** Start position in minutes from the beginning of the file. */
  startMinutes?: number;
  loop?: boolean;
}

/** Plays back an .ibt telemetry file as if it were live. */
export class IbtSource implements TelemetrySource {
  private readonly fd: number;
  private readonly header: Header;
  private readonly vars: Map<string, VarHeader>;
  private readonly yaml: string;
  private readonly records: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly path: string, private readonly opts: ReplayOptions = {}) {
    this.fd = openSync(path, 'r');
    this.header = readHeader(this.read(0, HEADER_SIZE));
    const h = this.header;
    this.vars = readVarHeaders(this.read(h.varHeaderOffset, h.numVars * VAR_HEADER_SIZE), h.numVars);
    this.yaml = this.read(h.sessionInfoOffset, h.sessionInfoLen).toString('latin1').replace(/\0+$/, '');
    const dataStart = h.varBufs[0]!.bufOffset;
    this.records = Math.floor((fstatSync(this.fd).size - dataStart) / h.bufLen);
  }

  get durationMinutes() {
    return this.records / this.header.tickRate / 60;
  }

  start(onFrame: (f: Frame) => void, onSessionInfo: (yaml: string) => void) {
    onSessionInfo(this.yaml);
    const rate = this.header.tickRate;
    const speed = this.opts.speed ?? 1;
    const first = Math.min(Math.floor((this.opts.startMinutes ?? 0) * 60 * rate), this.records - 1);
    let startedAt = performance.now();
    let next = first;

    // Emit every record that is due according to wall clock; timers are coarse on Windows.
    this.timer = setInterval(() => {
      const due = first + Math.floor(((performance.now() - startedAt) / 1000) * rate * speed);
      for (; next <= due && next < this.records; next++) onFrame(this.frame(next));
      if (next >= this.records) {
        if (!this.opts.loop) return this.stop();
        next = first;
        startedAt = performance.now();
      }
    }, 1000 / 60);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close() {
    this.stop();
    closeSync(this.fd);
  }

  frame(i: number): Frame {
    const h = this.header;
    return new Frame(this.vars, this.read(h.varBufs[0]!.bufOffset + i * h.bufLen, h.bufLen));
  }

  private read(pos: number, len: number): Buffer {
    const b = Buffer.alloc(len);
    readSync(this.fd, b, 0, len, pos);
    return b;
  }
}

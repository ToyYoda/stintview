import { useEffect, useRef } from 'react';
import { t } from '../i18n.ts';
import type { InputBuffer } from '../feed.ts';

const WIDTH = 420;
const HEIGHT = 150;
const TRACE_SECONDS = 5;
const TRACE_W = 300;
const COLORS = { throttle: '#3ddc84', brake: '#ff4d4d', steer: '#e8e8e8', grid: 'rgba(255,255,255,0.12)', text: '#e8e8e8', muted: '#8a93a0' };

/** Live steering, throttle and brake: scrolling trace, pedal bars and a steering wheel. */
export function InputsWidget({ inputs }: { inputs: InputBuffer }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.current!.width = WIDTH * dpr;
    canvas.current!.height = HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      render(ctx, inputs);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [inputs]);

  return (
    <div className="panel inputs">
      <canvas ref={canvas} style={{ width: WIDTH, height: HEIGHT, display: 'block' }} />
    </div>
  );
}

function render(ctx: CanvasRenderingContext2D, buf: InputBuffer) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const now = buf.playhead();
  const pad = 6;
  const h = HEIGHT - pad * 2;

  // Trace grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (const y of [0, 0.5, 1]) line(ctx, pad, pad + h * y, TRACE_W, pad + h * y);

  if (now === null) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '13px system-ui';
    ctx.fillText(t('inputs.none'), pad + 8, HEIGHT / 2 + 4);
    return;
  }

  const x = (t: number) => pad + ((t - (now - TRACE_SECONDS)) / TRACE_SECONDS) * (TRACE_W - pad);
  const trace = (idx: number, color: string, y: (v: number) => number, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < buf.times.length; i++) {
      const t = buf.times[i]!;
      if (t < now - TRACE_SECONDS - 0.1 || t > now) continue;
      const px = x(t), py = y(buf.samples[i]![idx]!);
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    }
    ctx.stroke();
  };
  const pedal = (v: number) => pad + h * (1 - clamp(v));
  const steerNorm = (v: number) => pad + h * (0.5 - clamp(v / (buf.steerMax / 2), -1, 1) / 2);
  trace(0, 'rgba(232,232,232,0.55)', steerNorm, 1.5);
  trace(1, COLORS.throttle, pedal, 2);
  trace(2, COLORS.brake, pedal, 2);

  const cur = buf.at(now);
  if (!cur) return;
  const [steer, throttle, brake] = cur;

  // Pedal bars
  const barW = 16, barX = TRACE_W + 12;
  bar(ctx, barX, pad, barW, h, brake, COLORS.brake);
  bar(ctx, barX + barW + 6, pad, barW, h, throttle, COLORS.throttle);

  // Steering wheel (positive angle = counter-clockwise in iRacing)
  const cx = barX + barW * 2 + 6 + 36, cy = pad + 34, r = 26;
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-steer);
  ctx.fillStyle = '#ffb000';
  ctx.fillRect(-3, -r - 3, 6, 10);
  ctx.lineWidth = 3;
  line(ctx, -r, 0, r, 0);
  line(ctx, 0, 0, 0, r);
  ctx.restore();

  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.font = '600 14px ui-monospace, Consolas, monospace';
  ctx.fillText(`${Math.round((-steer * 180) / Math.PI)}°`, cx, cy + r + 20);
  ctx.font = '600 22px ui-monospace, Consolas, monospace';
  ctx.fillText(buf.gear === 0 ? 'N' : buf.gear < 0 ? 'R' : String(buf.gear), cx, cy + r + 46);
  ctx.font = '12px ui-monospace, Consolas, monospace';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(`${Math.round(buf.speed * 3.6)} km/h`, cx, cy + r + 62);
  ctx.textAlign = 'start';
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, color: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  const fh = h * clamp(v);
  ctx.fillRect(x, y + h - fh, w, fh);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

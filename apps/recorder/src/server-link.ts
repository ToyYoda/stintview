import { X509Certificate } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import tls, { type PeerCertificate } from 'node:tls';
import type { ClientOptions } from 'ws';

/**
 * Encrypted link to the team server (since 0.26, SPEC A27). The server has its own self-signed
 * certificate; the app remembers it when it first reaches the server (joining, or the first
 * connection after the update) and from then on accepts only that one ("pinning"). Old servers
 * without TLS are still reached unencrypted until they are updated – but never again once a
 * certificate is remembered. The team server on this PC (localhost) stays unencrypted.
 */

/** What config.json holds about the server. */
export interface ServerAccess { serverUrl: string; serverCert?: string }

/** local = server on this PC; plain = old server without TLS (not remembered yet). */
export type Security = 'local' | 'encrypted' | 'plain';

/** Where and how to reach the server for one connection. */
export interface Target { base: URL; tls?: { ca: string[]; checkServerIdentity: typeof tls.checkServerIdentity }; security: Security }

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const isLoopback = (host: string) => LOOPBACK.has(host.toLowerCase()) || host.startsWith('127.');

/** From the stored config alone (no network): what the next connection will be. */
export function security(access: ServerAccess): Security {
  const url = new URL(access.serverUrl);
  if (isLoopback(url.hostname)) return 'local';
  return access.serverCert || url.protocol === 'https:' ? 'encrypted' : 'plain';
}

/** SHA-256 fingerprint "AB:CD:…" of a PEM certificate. */
export const fingerprint = (pem: string) => new X509Certificate(pem).fingerprint256;

/** TLS options accepting exactly this certificate (whatever host name the server is reached by). */
export function pinned(pem: string): NonNullable<Target['tls']> {
  const expected = fingerprint(pem);
  return {
    ca: [pem],
    checkServerIdentity: (_host: string, cert: PeerCertificate) =>
      cert.fingerprint256 === expected ? undefined : Object.assign(new Error('certificate changed'), { code: 'CERT_CHANGED' }),
  };
}

/** The server presents another certificate than the remembered one (or an invalid one). */
export function isCertError(e: unknown) {
  const code = (e as { code?: string } | null)?.code ?? '';
  return code === 'CERT_CHANGED' || /CERT|SELF_SIGNED|ALTNAME/.test(code);
}

const pemOf = (raw: Buffer) => `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;

export type Probe = { tls: true; authorized: boolean; cert: string } | { tls: false };

/**
 * Asks the server for its certificate. `authorized`: valid for its host name by the system's
 * certificate authorities (e.g. behind a reverse proxy with Let's Encrypt). No TLS but the old
 * plain /health answers: `{ tls: false }`. Unreachable: throws.
 */
export async function probe(url: URL, timeoutMs = 8000): Promise<Probe> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const viaTls = await new Promise<Probe | null>((resolve) => {
    const socket = tls.connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      resolve(cert?.raw ? { tls: true, authorized: socket.authorized, cert: pemOf(cert.raw) } : null);
      socket.destroy();
    });
    socket.once('timeout', () => { socket.destroy(); resolve(null); });
    socket.once('error', () => resolve(null));
  });
  if (viaTls) return viaTls;
  const plain = await new Promise<boolean>((resolve) => {
    http.get({ host, port, path: '/health', signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    }).once('error', () => resolve(false));
  });
  if (plain) return { tls: false };
  throw new Error(`team server ${url.host} not reachable`);
}

/** Target and what to store for a server first reached at `serverUrl` (http:// or https://). */
export async function firstContact(serverUrl: string): Promise<{ target: Target; access: ServerAccess }> {
  const url = new URL(serverUrl);
  if (isLoopback(url.hostname)) return { target: { base: url, security: 'local' }, access: { serverUrl: url.origin } };
  const p = await probe(url);
  if (!p.tls) {
    url.protocol = 'http:';
    return { target: { base: url, security: 'plain' }, access: { serverUrl: url.origin } };
  }
  url.protocol = 'https:';
  const access: ServerAccess = p.authorized ? { serverUrl: url.origin } : { serverUrl: url.origin, serverCert: p.cert };
  return { target: targetFor(access), access };
}

/** Target from what is stored (remembered certificate, or https with a regular certificate). */
function targetFor(access: ServerAccess): Target {
  const base = new URL(access.serverUrl);
  if (isLoopback(base.hostname)) return { base, security: 'local' };
  if (access.serverCert) {
    base.protocol = 'https:';
    return { base, tls: pinned(access.serverCert), security: 'encrypted' };
  }
  return { base, security: base.protocol === 'https:' ? 'encrypted' : 'plain' };
}

/**
 * Target for the next connection. A config from before 0.26 (http://, no certificate) asks the
 * server first: if it speaks TLS now, its certificate is remembered via `remember` and used from
 * then on.
 */
export async function resolveServer(access: ServerAccess, remember?: (access: ServerAccess) => void): Promise<Target> {
  if (security(access) !== 'plain') return targetFor(access);
  const { target, access: upgraded } = await firstContact(access.serverUrl);
  if (target.security === 'encrypted') remember?.(upgraded);
  return target;
}

/** WebSocket URL and options for the relay path. */
export function wsTarget(t: Target): { url: string; options: ClientOptions } {
  const url = new URL('/ws', t.base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // ws hands these to tls.connect as they are (its typing of checkServerIdentity is not Node's).
  return { url: url.toString(), options: (t.tls ? { ...t.tls } : {}) as ClientOptions };
}

export interface Reply { status: number; ok: boolean; json<T = unknown>(): Promise<T> }

/** HTTP request to the server (JSON body if given) with the target's TLS settings. */
export function request(t: Target, path: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<Reply> {
  const url = new URL(path, t.base);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
      ...t.tls,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(text) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

/** Passes a browser's request (stint planner page via the app on localhost) on to the server. */
export function forward(t: Target, path: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(path, t.base);
  const headers: Record<string, string> = {};
  for (const h of ['content-type', 'authorization', 'accept', 'if-none-match']) {
    const v = req.headers[h];
    if (typeof v === 'string') headers[h] = v;
  }
  const out = (url.protocol === 'https:' ? https : http).request(url, { method: req.method, headers, ...t.tls }, (up) => {
    const pass: Record<string, string> = {};
    for (const h of ['content-type', 'cache-control', 'etag', 'last-modified']) {
      const v = up.headers[h];
      if (typeof v === 'string') pass[h] = v;
    }
    res.writeHead(up.statusCode ?? 502, pass);
    up.pipe(res);
  });
  out.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'team server not reachable' }));
  });
  req.pipe(out);
}

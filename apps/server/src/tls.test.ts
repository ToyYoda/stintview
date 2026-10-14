import { spawn, type ChildProcess } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, pack, unpack, type ServerMessage, type TeamCredentials } from '@stintview/protocol';
import { createCert } from './tls-cert.ts';
import {
  firstContact, fingerprint, isCertError, pinned, request, resolveServer, security, wsTarget, type ServerAccess, type Target,
} from '../../recorder/src/server-link.ts';

describe('createCert', () => {
  it('makes a self-signed certificate for its key', () => {
    const c = createCert();
    const x = new X509Certificate(c.cert);
    expect(x.subject).toBe('CN=StintView team server');
    expect(x.verify(x.publicKey)).toBe(true);
    expect(x.checkPrivateKey(createPrivateKey(c.key))).toBe(true);
    expect(new Date(x.validTo).getUTCFullYear()).toBe(9999);
    expect(fingerprint(c.cert)).toBe(c.fingerprint);
  });
});

describe('security', () => {
  it('comes from the stored config', () => {
    expect(security({ serverUrl: 'http://localhost:8787' })).toBe('local');
    expect(security({ serverUrl: 'http://team.example.org:8787' })).toBe('plain');
    expect(security({ serverUrl: 'https://team.example.org:8787', serverCert: 'x' })).toBe('encrypted');
    expect(security({ serverUrl: 'https://team.example.org' })).toBe('encrypted');
  });
});

/** This machine's address as others would reach it (not loopback: the server treats that as the team manager's own app). */
const lanIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

describe.skipIf(!lanIp)('relay over TLS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stintview-tls-'));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const remote = `http://${lanIp}:${port}`;
  let relay: ChildProcess;
  let chef: TeamCredentials;
  let certPem = '';

  beforeAll(async () => {
    relay = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: join(__dirname, '..'), env: { ...process.env, PORT: String(port), STINTVIEW_DATA: join(dir, 'teams.json') }, stdio: 'pipe',
    });
    await new Promise<void>((resolve, reject) => {
      relay.stdout!.on('data', (d: Buffer) => { if (String(d).includes('listening')) resolve(); });
      relay.once('exit', (code) => reject(new Error(`relay exited ${code}`)));
    });
    certPem = readFileSync(join(dir, 'tls-cert.pem'), 'utf8');
    // The team manager's own app: unencrypted over localhost.
    const local: Target = { base: new URL(`http://127.0.0.1:${port}`), security: 'local' };
    const res = await request(local, '/api/teams', { method: 'POST', body: JSON.stringify({ teamName: 'Outcast', memberName: 'Philipp' }) });
    expect(res.status).toBe(201);
    chef = await res.json<TeamCredentials>();
  }, 20_000);

  afterAll(() => {
    relay?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  /** First message the relay sends after our hello (or unasked). */
  function hello(t: Target, token: string) {
    const { url, options } = wsTarget(t);
    const ws = new WebSocket(url, options);
    return new Promise<ServerMessage | Error>((resolve) => {
      ws.on('open', () => ws.send(pack({ t: 'hello', v: PROTOCOL_VERSION, token, role: 'overlay' })));
      ws.on('message', (d: Buffer) => { resolve(unpack<ServerMessage>(d)); ws.close(); });
      ws.on('error', (e) => resolve(e));
    });
  }

  it('turns unencrypted requests from other PCs away', async () => {
    const plain: Target = { base: new URL(remote), security: 'plain' };
    const res = await request(plain, '/health');
    expect(res.status).toBe(426);
    const msg = await hello(plain, chef.token);
    expect(msg).toMatchObject({ t: 'error', code: 'version' });
  });

  it('remembers the certificate at the first contact and joins encrypted', async () => {
    const { target, access } = await firstContact(remote);
    expect(target.security).toBe('encrypted');
    expect(access.serverUrl).toBe(`https://${lanIp}:${port}`);
    expect(fingerprint(access.serverCert!)).toBe(fingerprint(certPem));
    const res = await request(target, '/api/join', { method: 'POST', body: JSON.stringify({ inviteCode: chef.inviteCode, memberName: 'Anna' }) });
    expect(res.status).toBe(200);
    const anna = await res.json<TeamCredentials>();
    expect(await hello(target, anna.token)).toMatchObject({ t: 'welcome', memberName: 'Anna' });
  });

  it('upgrades a config from before 0.26 on its next connection', async () => {
    let stored: ServerAccess | null = null;
    const target = await resolveServer({ serverUrl: remote }, (a) => { stored = a; });
    expect(target.security).toBe('encrypted');
    expect(stored!.serverCert).toBe(certPem);
    // From then on: no asking again, the remembered certificate only.
    let again = false;
    const next = await resolveServer(stored!, () => { again = true; });
    expect(again).toBe(false);
    expect(next.tls).toBeDefined();
    expect(await hello(next, chef.token)).toMatchObject({ t: 'welcome' });
  });

  it('refuses another certificate than the remembered one', async () => {
    const wrong: Target = { base: new URL(`https://${lanIp}:${port}`), tls: pinned(createCert().cert), security: 'encrypted' };
    const err = await request(wrong, '/health').then(() => null, (e: unknown) => e);
    expect(isCertError(err)).toBe(true);
    const ws = await hello(wrong, chef.token);
    expect(ws).toBeInstanceOf(Error);
    expect(isCertError(ws)).toBe(true);
  });
});

describe('old team server without TLS', () => {
  let server: Server;
  beforeAll(async () => {
    server = createServer((req, res) => res.writeHead(req.url === '/health' ? 200 : 404).end('{}'));
    await new Promise<void>((r) => server.listen(0, r));
  });
  afterAll(() => server.close());

  it.skipIf(!lanIp)('stays reachable unencrypted until it is updated', async () => {
    const url = `http://${lanIp}:${(server.address() as AddressInfo).port}`;
    let remembered = false;
    const target = await resolveServer({ serverUrl: url }, () => { remembered = true; });
    expect(target.security).toBe('plain');
    expect(target.base.protocol).toBe('http:');
    expect(remembered).toBe(false);
  });
});

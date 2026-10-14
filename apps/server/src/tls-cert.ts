import { X509Certificate, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The team server's own TLS certificate (since 0.26): self-signed, made once and kept next to
 * teams.json. The apps don't check it against a certificate authority – they remember it when they
 * first reach the server and from then on accept only this one (SPEC A27).
 */
export interface ServerCert { key: string; cert: string; fingerprint: string }

export function loadOrCreateCert(dir: string): ServerCert {
  const keyFile = join(dir, 'tls-key.pem');
  const certFile = join(dir, 'tls-cert.pem');
  try {
    const key = readFileSync(keyFile, 'utf8');
    const cert = readFileSync(certFile, 'utf8');
    createPrivateKey(key);
    return { key, cert, fingerprint: new X509Certificate(cert).fingerprint256 };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const made = createCert();
  mkdirSync(dir, { recursive: true });
  // Key first: a certificate without its key would be useless after a crash in between.
  for (const [file, text] of [[keyFile, made.key], [certFile, made.cert]] as const) {
    writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  return made;
}

/** ECDSA P-256 key and a self-signed certificate for it, valid from yesterday without an end. */
export function createCert(commonName = 'StintView team server'): ServerCert {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serial = randomBytes(16);
  serial[0]! &= 0x7f; // positive
  const name = seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName, 'utf8')))));
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), // v3
    int(serial),
    ecdsaSha256,
    name,
    seq(time(new Date(Date.now() - 86_400_000)), time(new Date(Date.UTC(9999, 11, 31, 23, 59, 59)))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(
      // Self-signed root that is also the server's certificate (as `openssl req -x509` makes it).
      seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), octets(seq(tlv(0x01, Buffer.from([0xff]))))),
      seq(oid('2.5.29.15'), tlv(0x01, Buffer.from([0xff])), octets(tlv(0x03, Buffer.from([0x02, 0x84])))), // digitalSignature, keyCertSign
      seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))), // serverAuth
    )),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert,
    fingerprint: new X509Certificate(cert).fingerprint256,
  };
}

// --- DER -------------------------------------------------------------------

function tlv(tag: number, ...content: Buffer[]) {
  const body = Buffer.concat(content);
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n])
    : n < 0x100 ? Buffer.from([0x81, n])
      : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

const seq = (...c: Buffer[]) => tlv(0x30, ...c);
const set = (...c: Buffer[]) => tlv(0x31, ...c);
const octets = (c: Buffer) => tlv(0x04, c);
const int = (b: Buffer) => tlv(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);

function oid(dotted: string) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a! * 40 + b!];
  for (const n of rest) {
    const part = [n & 0x7f];
    for (let v = n >>> 7; v; v >>>= 7) part.unshift((v & 0x7f) | 0x80);
    bytes.push(...part);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** UTCTime until 2049, GeneralizedTime from 2050 (RFC 5280). */
function time(d: Date) {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

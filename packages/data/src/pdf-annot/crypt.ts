// The Standard security handler for files the EMPTY user password opens (ARCHITETTURA-UI §8.3.3 step 3, D-375): file key (revisions 2-4
// from the padded password, 5-6 from /UE), per-object keys, RC4 / AESV2 / AESV3. Lazy chunk, loaded by `unlock` (refuse.ts) only for
// encrypted files. Owner passwords and non-empty user passwords are never tried: such files are refused by the caller.
// Only types and node:crypto are imported, on purpose: a lazy chunk that reached the shared modules would split the main chunks (D-449).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Crypt, CryptMethod as Method, CryptParams } from './doc.js';

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...b: Buffer[]) => b.reduce((h, x) => h.update(x), createHash('md5')).digest();

/** RC4, in code: OpenSSL 3 (and so Node, Electron) does not offer it. */
export function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

/** Algorithm 2.B of ISO 32000-2 (revision 6). `udata` (the 48 bytes of /U) is for the owner password only. */
export function hash2B(password: Buffer, salt: Buffer, udata: Buffer = Buffer.alloc(0)): Buffer {
  let k = createHash('sha256').update(password).update(salt).update(udata).digest();
  for (let round = 0; ; ) {
    const k1 = Buffer.concat(Array<Buffer>(64).fill(Buffer.concat([password, k, udata])));
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j]!;
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]!).update(e).digest();
    round++;
    if (round >= 64 && e[e.length - 1]! <= round - 32) return k.subarray(0, 32);
  }
}

/** AES-CBC with the IV in front and PKCS#7 padding; a wrong length or padding is tolerated (hostile files must not throw here). */
function aesOpen(key: Buffer, b: Buffer): Buffer {
  const n = Math.floor((b.length - 16) / 16) * 16;
  if (n <= 0) return Buffer.alloc(0);
  const d = createDecipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, b.subarray(0, 16)).setAutoPadding(false);
  const out = Buffer.concat([d.update(b.subarray(16, 16 + n)), d.final()]);
  const pad = out[out.length - 1]!;
  return pad >= 1 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
}
function aesSeal(key: Buffer, b: Buffer): Buffer {
  const iv = randomBytes(16);
  const c = createCipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, iv);
  return Buffer.concat([iv, c.update(b), c.final()]);
}

/**
 * Opens the file with the empty user password. `'password'`: it does not open it. On success the Crypt decrypts what is read and encrypts what
 * is written; the revision, the variant and the permissions were checked by the caller (refuse.ts).
 */
export function openCrypt(p: CryptParams, skip: number | undefined): Crypt | 'password' {
  const { R, P, n, stm, str, O, U, UE, id0, noMetadata } = p;
  let key: Buffer;
  if (R >= 5) {
    if (U.length < 48 || UE.length < 32) return 'password';
    const hash = (salt: Buffer) => (R === 5 ? createHash('sha256').update(salt).digest() : hash2B(Buffer.alloc(0), salt));
    if (!hash(U.subarray(32, 40)).equals(U.subarray(0, 32))) return 'password';
    const d = createDecipheriv('aes-256-cbc', hash(U.subarray(40, 48)), Buffer.alloc(16)).setAutoPadding(false);
    key = Buffer.concat([d.update(UE.subarray(0, 32)), d.final()]);
  } else {
    if (O.length < 32 || U.length < 16) return 'password';
    const pb = Buffer.alloc(4);
    pb.writeInt32LE(P);
    let k = md5(PAD, O.subarray(0, 32), pb, id0, noMetadata ? Buffer.alloc(4, 255) : Buffer.alloc(0));
    if (R >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, n));
    key = k.subarray(0, n);
    if (R === 2) { if (!rc4(key, PAD).equals(U.subarray(0, 32))) return 'password'; }
    else {
      let x = rc4(key, md5(PAD, id0));
      for (let i = 1; i < 20; i++) x = rc4(Buffer.from(key.map((c) => c ^ i)), x);
      if (!x.equals(U.subarray(0, 16))) return 'password';
    }
  }
  const objKey = (o: number, g: number, salt: boolean) =>
    md5(key, Buffer.from([o & 255, (o >> 8) & 255, (o >> 16) & 255, g & 255, (g >> 8) & 255]), salt ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, Math.min(key.length + 5, 16));
  const open = (m: Method, b: Buffer, o: number, g: number) => (m === 'none' ? b : m === 'rc4' ? rc4(objKey(o, g, false), b) : aesOpen(m === 'aes256' ? key : objKey(o, g, true), b));
  const seal = (m: Method, b: Buffer, o: number, g: number) => (m === 'none' ? b : m === 'rc4' ? rc4(objKey(o, g, false), b) : aesSeal(m === 'aes256' ? key : objKey(o, g, true), b));
  return {
    skip,
    str: (b, o, g) => open(str, b, o, g),
    stream: (raw, o, g, type) => (type === 'XRef' || (type === 'Metadata' && noMetadata) ? raw : open(stm, raw, o, g)),
    encStr: (b, o, g) => seal(str, b, o, g),
    encStream: (b, o, g) => seal(stm, b, o, g),
  };
}

// Classifier: can this file be annotated by an incremental update, or why not (spike S2).
import { createCipheriv, createHash } from 'node:crypto';
import { PdfError, Str, asDict, asNum, nameOf, type Dict, type Val } from './objects';
import { dictOf, getPage, loadDoc, resolve, type Doc, type Source } from './doc';

export type Reason = 'encrypted' | 'permission' | 'signed' | 'xfa' | 'damaged' | 'unsupported';
export type Classification =
  | { ok: true; doc: Doc; trailingBytes: number; revisions: number; hybrid: boolean; kind: 'table' | 'stream' }
  | { ok: false; reason: Reason; detail: string; emptyPassword?: boolean; trailingBytes?: number };

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...b: Buffer[]) => b.reduce((h, x) => h.update(x), createHash('md5')).digest();

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

function hash2B(salt: Buffer, udata: Buffer): Buffer {
  let k = createHash('sha256').update(salt).update(udata).digest();
  for (let i = 0; ; i++) {
    const k1 = Buffer.concat(Array<Buffer>(64).fill(Buffer.concat([k, udata])));
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j]!;
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]!).update(e).digest();
    if (i >= 63 && e[e.length - 1]! <= i - 32) return k.subarray(0, 32);
  }
}

/** Standard security handler: does the empty user password open the file? (R2-R6; no decryption of content.) */
export function emptyUserPassword(enc: Dict, id0: Buffer, doc: Doc): boolean {
  const R = asNum(resolve(doc, enc.get('R'))) ?? 0, P = asNum(resolve(doc, enc.get('P'))) ?? 0;
  const bytes = (k: string) => { const v = resolve(doc, enc.get(k)); return v instanceof Str ? v.b : Buffer.alloc(0); };
  const U = bytes('U'), O = bytes('O');
  if (R >= 5) {
    const vsalt = U.subarray(32, 40);
    const h = R === 5 ? createHash('sha256').update(vsalt).digest() : hash2B(vsalt, Buffer.alloc(0));
    return U.length >= 48 && h.equals(U.subarray(0, 32));
  }
  if (R < 2 || R > 4 || O.length < 32) return false;
  const n = R === 2 ? 5 : Math.min(16, (asNum(resolve(doc, enc.get('Length'))) ?? 40) / 8);
  const pb = Buffer.alloc(4);
  pb.writeInt32LE(P | 0);
  const noMeta = R >= 4 && resolve(doc, enc.get('EncryptMetadata')) === false;
  let key = md5(PAD, O.subarray(0, 32), pb, id0, noMeta ? Buffer.alloc(4, 255) : Buffer.alloc(0));
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  key = key.subarray(0, n);
  if (R === 2) return rc4(key, PAD).equals(U.subarray(0, 32));
  let x = rc4(key, md5(PAD, id0));
  for (let i = 1; i < 20; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  return x.equals(U.subarray(0, 16));
}

function hasSignature(doc: Doc, root: Dict): boolean {
  const perms = dictOf(doc, root.get('Perms'));
  if (perms && (perms.has('DocMDP') || perms.has('UR3'))) return true;
  const form = dictOf(doc, root.get('AcroForm'));
  const seen = new Set<Dict>();
  let budget = 5000;
  const walk = (fields: Val | undefined, ft: string | undefined, depth: number): boolean => {
    const a = resolve(doc, fields);
    if (!Array.isArray(a) || depth > 32) return false;
    for (const f of a) {
      const d = dictOf(doc, f);
      if (!d || seen.has(d) || --budget < 0) continue;
      seen.add(d);
      const t = nameOf(resolve(doc, d.get('FT'))) ?? ft;
      if (t === 'Sig' && resolve(doc, d.get('V')) != null) return true;
      if (walk(d.get('Kids'), t, depth + 1)) return true;
    }
    return false;
  };
  return form ? walk(form.get('Fields'), undefined, 0) : false;
}

export function classify(src: Source): Classification {
  let doc: Doc;
  try {
    doc = loadDoc(src);
    const t = doc.trailer;
    const root = dictOf(doc, t.get('Root'));
    if (t.has('Encrypt')) {
      const enc = dictOf(doc, t.get('Encrypt'));
      const ids = resolve(doc, t.get('ID'));
      const id0 = Array.isArray(ids) && ids[0] instanceof Str ? ids[0].b : Buffer.alloc(0);
      if (!enc || nameOf(resolve(doc, enc.get('Filter'))) !== 'Standard') return { ok: false, reason: 'encrypted', detail: 'handler', emptyPassword: false, trailingBytes: doc.trailing };
      if (!emptyUserPassword(enc, id0, doc)) return { ok: false, reason: 'encrypted', detail: 'password', emptyPassword: false, trailingBytes: doc.trailing };
      const P = asNum(resolve(doc, enc.get('P'))) ?? 0;
      if ((P & 32) === 0) return { ok: false, reason: 'permission', detail: 'no-annotate-bit', emptyPassword: true, trailingBytes: doc.trailing };
      return { ok: false, reason: 'encrypted', detail: 'empty-password', emptyPassword: true, trailingBytes: doc.trailing };
    }
    if (!root) return { ok: false, reason: 'damaged', detail: 'no-root' };
    if (asDict(resolve(doc, root.get('AcroForm')))?.has('XFA')) return { ok: false, reason: 'xfa', detail: 'xfa' };
    if (hasSignature(doc, root)) return { ok: false, reason: 'signed', detail: 'signature' };
    if (!getPage(doc, 0)) return { ok: false, reason: 'damaged', detail: 'no-pages' };
    return { ok: true, doc, trailingBytes: doc.trailing, revisions: doc.sections, hybrid: doc.hybrid, kind: doc.lastKind };
  } catch (e) {
    if (e instanceof PdfError) return { ok: false, reason: e.kind === 'unsupported' ? 'unsupported' : 'damaged', detail: e.code };
    return { ok: false, reason: 'damaged', detail: 'internal' };
  }
}

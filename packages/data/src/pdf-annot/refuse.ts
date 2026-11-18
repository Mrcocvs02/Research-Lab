// Can this file be annotated by an incremental update, and if not why (ARCHITETTURA-UI §8.3.5)? Encrypted files open with the empty user password only (G4c).
import { PDF_WRITE_LIMITS as LIM } from '@rl/core';
import { PdfError, Ref, Str, asDict, asNum, nameOf, type Dict, type Val } from './objects.js';
import { dictOf, getPage, loadDoc, resolve, type CryptMethod, type CryptParams, type Doc, type SyncSource } from './doc.js';

export type Reason = 'encrypted' | 'permission' | 'signed' | 'xfa' | 'damaged' | 'too-many-revisions';
export type Classification =
  | { ok: true; doc: Doc; trailingBytes: number; revisions: number; hybrid: boolean; kind: 'table' | 'stream' }
  | { ok: false; reason: Reason; detail: string; emptyPassword?: boolean; trailingBytes?: number };

/**
 * An encrypted file: does the empty user password open it, may annotations be added (`/P` bit 6) and is the handler one we know?
 * Yes: `doc.crypt` is set (crypt.ts, a lazy chunk loaded only here) and every read decrypts, every write encrypts.
 */
export async function unlock(doc: Doc): Promise<{ ok: true } | { ok: false; reason: Reason; detail: string; emptyPassword: boolean }> {
  const t = doc.trailer;
  const enc = dictOf(doc, t.get('Encrypt'));
  const no = (reason: Reason, detail: string, emptyPassword = false) => ({ ok: false as const, reason, detail, emptyPassword });
  if (!enc || nameOf(resolve(doc, enc.get('Filter'))) !== 'Standard') return no('encrypted', 'handler');
  const num = (k: string) => asNum(resolve(doc, enc.get(k)));
  const bytes = (k: string) => { const v = resolve(doc, enc.get(k)); return v instanceof Str ? v.b : Buffer.alloc(0); };
  const ids = resolve(doc, t.get('ID'));
  const V = num('V') ?? 0, R = num('R') ?? 0;
  let stm: CryptMethod = 'rc4', str: CryptMethod = 'rc4', n = 5;
  if (V === 4 || V === 5) {
    // Crypt filters: V4 allows RC4, AESV2 and none; V5 AESV3 and none.
    const cf = asDict(resolve(doc, enc.get('CF')));
    const method = (k: string): CryptMethod | undefined => {
      const name = nameOf(resolve(doc, enc.get(k))) ?? 'Identity';
      const m = name === 'Identity' ? 'None' : nameOf(resolve(doc, asDict(resolve(doc, cf?.get(name)))?.get('CFM')));
      return m === 'None' ? 'none' : V === 4 ? (m === 'V2' ? 'rc4' : m === 'AESV2' ? 'aes128' : undefined) : m === 'AESV3' ? 'aes256' : undefined;
    };
    const a = method('StmF'), b = method('StrF');
    if (!a || !b || (V === 4 ? R !== 4 : R !== 5 && R !== 6)) return no('encrypted', 'handler');
    [stm, str, n] = [a, b, V === 4 ? 16 : 32];
  } else if (V === 1 || V === 2) {
    if (V === 1 ? R !== 2 : R !== 3) return no('encrypted', 'handler');
    n = V === 1 ? 5 : Math.min(16, Math.max(5, Math.floor((num('Length') ?? 40) / 8)));
  } else return no('encrypted', 'handler');
  const P = (num('P') ?? 0) | 0;
  const params: CryptParams = { R, P, n, stm, str, O: bytes('O'), U: bytes('U'), UE: bytes('UE'), id0: Array.isArray(ids) && ids[0] instanceof Str ? ids[0].b : Buffer.alloc(0), noMetadata: R >= 4 && resolve(doc, enc.get('EncryptMetadata')) === false };
  const ref = t.get('Encrypt');
  const c = (await import('./crypt.js')).openCrypt(params, ref instanceof Ref ? ref.n : undefined);
  if (c === 'password') return no('encrypted', 'password');
  if ((P & 32) === 0) return no('permission', 'no-annotate-bit', true);
  doc.crypt = c;
  return { ok: true };
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

export async function analyze(src: SyncSource, opts: { allowManyRevisions?: boolean } = {}): Promise<Classification> {
  let doc: Doc;
  try {
    doc = loadDoc(src);
    const t = doc.trailer;
    if (t.has('Encrypt')) {
      const u = await unlock(doc);
      if (!u.ok) return { ...u, trailingBytes: doc.trailing };
    }
    const root = dictOf(doc, t.get('Root'));
    if (!root) return { ok: false, reason: 'damaged', detail: 'no-root' };
    if (asDict(resolve(doc, root.get('AcroForm')))?.has('XFA')) return { ok: false, reason: 'xfa', detail: 'xfa' };
    if (hasSignature(doc, root)) return { ok: false, reason: 'signed', detail: 'signature' };
    if (!getPage(doc, 0)) return { ok: false, reason: 'damaged', detail: 'no-pages' };
    if (doc.sections > LIM.maxRevisions && !opts.allowManyRevisions) return { ok: false, reason: 'too-many-revisions', detail: 'revisions' };
    return { ok: true, doc, trailingBytes: doc.trailing, revisions: doc.sections, hybrid: doc.hybrid, kind: doc.lastKind };
  } catch (e) {
    if (e instanceof PdfError) return { ok: false, reason: 'damaged', detail: e.code };
    return { ok: false, reason: 'damaged', detail: 'internal' };
  }
}

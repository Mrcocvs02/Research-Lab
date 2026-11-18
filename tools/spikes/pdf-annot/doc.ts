// Random-access reader: xref chain (table, stream, hybrid), object streams, page tree (spike S2).
import { closeSync, openSync, readSync, fstatSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Eof, Lexer, PdfError, Ref, asDict, asNum, damaged, nameOf, type Dict, type Indirect, type Val } from './objects';

export interface Source { size: number; read(off: number, len: number): Buffer }
export const bufSource = (b: Buffer): Source => ({ size: b.length, read: (o, l) => b.subarray(o, Math.min(b.length, o + l)) });
export function fileSource(path: string): Source & { close(): void } {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  return {
    size,
    read(off, len) {
      const b = Buffer.alloc(Math.max(0, Math.min(len, size - off)));
      let got = 0;
      while (got < b.length) { const n = readSync(fd, b, got, b.length - got, off + got); if (n === 0) break; got += n; }
      return b.subarray(0, got);
    },
    close: () => closeSync(fd),
  };
}

export const LIMITS = { prevChain: 1000, inflate: 64 * 1024 * 1024, objects: 100_000, window: 64 * 1024 * 1024, tail: 65536 };

export type XEnt = { t: 0 } | { t: 1; off: number; gen: number } | { t: 2; stm: number; idx: number };
export interface Doc {
  src: Source;
  xref: Map<number, XEnt>;
  trailer: Dict;
  lastKind: 'table' | 'stream';
  lastStartxref: number;
  sections: number;
  hybrid: boolean;
  size: number;
  trailing: number;
  objstm: Map<number, { objs: Buffer; nums: number[]; offs: number[]; first: number }>;
}

/** Parse one value at `off`, doubling the window until the token fits. */
function parseAt<T>(src: Source, off: number, f: (lx: Lexer) => T): T {
  if (off < 0 || off >= src.size) return damaged('offset');
  for (let len = 8192; ; len *= 4) {
    const buf = src.read(off, len);
    try { return f(new Lexer(buf, 0, off)); } catch (e) {
      if (!(e instanceof Eof) || buf.length < len || len >= LIMITS.window) throw e instanceof Eof ? new PdfError('damaged', 'eof') : e;
    }
  }
}
export const readIndirectAt = (src: Source, off: number): Indirect => parseAt(src, off, (lx) => lx.indirect());

function flate(b: Buffer): Buffer {
  try { return inflateSync(b, { maxOutputLength: LIMITS.inflate }); } catch { try { return inflateSync(b, { maxOutputLength: LIMITS.inflate, finishFlush: 2 }); } catch { return damaged('inflate'); } }
}
function unpredict(b: Buffer, p: number, cols: number, colors: number, bpc: number): Buffer {
  if (p < 10) return p === 1 ? b : damaged('predictor');
  const bpp = Math.max(1, (colors * bpc) >> 3), row = ((cols * colors * bpc) + 7) >> 3;
  const rows = Math.floor(b.length / (row + 1));
  const out = Buffer.alloc(rows * row);
  for (let r = 0; r < rows; r++) {
    const ft = b[r * (row + 1)]!;
    for (let i = 0; i < row; i++) {
      const x = b[r * (row + 1) + 1 + i]!;
      const a = i >= bpp ? out[r * row + i - bpp]! : 0;
      const up = r ? out[(r - 1) * row + i]! : 0;
      const c = r && i >= bpp ? out[(r - 1) * row + i - bpp]! : 0;
      let v: number;
      if (ft === 0) v = x; else if (ft === 1) v = x + a; else if (ft === 2) v = x + up; else if (ft === 3) v = x + ((a + up) >> 1);
      else if (ft === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      else return damaged('png-filter');
      out[r * row + i] = v & 255;
    }
  }
  return out;
}

export function streamData(doc: Pick<Doc, 'src' | 'xref'> & Partial<Doc>, ind: Indirect): Buffer {
  const d = asDict(ind.val);
  if (!d || ind.dataStart < 0) return damaged('not-stream');
  const { src } = doc;
  let len = asNum(d.get('Length'));
  if (d.get('Length') instanceof Ref && doc.trailer) len = asNum(resolve(doc as Doc, d.get('Length') as Ref));
  let raw: Buffer | undefined;
  if (len !== undefined && len >= 0 && ind.dataStart + len <= src.size && /^\s*endstream/.test(src.read(ind.dataStart + len, 24).toString('latin1'))) raw = src.read(ind.dataStart, len);
  else {
    const rest = src.read(ind.dataStart, Math.min(src.size - ind.dataStart, LIMITS.inflate));
    const e = rest.indexOf('endstream');
    if (e < 0) return damaged('endstream');
    let end = e;
    if (rest[end - 1] === 10) end--;
    if (rest[end - 1] === 13) end--;
    raw = rest.subarray(0, end);
  }
  const f = d.get('Filter');
  const parms: Val | undefined = d.get('DecodeParms');
  const filters = Array.isArray(f) ? f : f === undefined ? [] : [f];
  if (filters.length > 1 || (filters[0] !== undefined && nameOf(filters[0]) !== 'FlateDecode' && nameOf(filters[0]) !== 'Fl')) throw new PdfError('unsupported', 'filter');
  if (filters.length === 0) return raw;
  const out = flate(raw);
  const dp = asDict(Array.isArray(parms) ? parms[0] : parms);
  const pr = asNum(dp?.get('Predictor')) ?? 1;
  return pr === 1 ? out : unpredict(out, pr, asNum(dp?.get('Columns')) ?? 1, asNum(dp?.get('Colors')) ?? 1, asNum(dp?.get('BitsPerComponent')) ?? 8);
}

function mergeEntries(x: Map<number, XEnt>, n: number, e: XEnt): void { if (!x.has(n)) x.set(n, e); }

function readTable(src: Source, off: number, xref: Map<number, XEnt>): Dict {
  return parseAt(src, off, (lx) => {
    lx.pos = 0;
    if (lx.word() !== 'xref') return damaged('xref-kw');
    const found: [number, XEnt][] = [];
    for (;;) {
      const w = lx.word();
      if (w === 'trailer') break;
      const start = Number(w), count = Number(lx.word());
      if (!Number.isInteger(start) || !Number.isInteger(count) || count < 0 || count > 10_000_000) return damaged('xref-subsection');
      for (let i = 0; i < count; i++) {
        const o = Number(lx.word()), g = Number(lx.word()), t = lx.word();
        if (!Number.isFinite(o) || !Number.isFinite(g)) return damaged('xref-entry');
        found.push([start + i, t === 'n' ? { t: 1, off: o, gen: g } : t === 'f' ? { t: 0 } : (damaged('xref-flag') as never)]);
      }
    }
    for (const [n, e] of found) mergeEntries(xref, n, e);
    const t = asDict(lx.value());
    return t ?? damaged('trailer');
  });
}

function readStreamSection(src: Source, off: number, xref: Map<number, XEnt>): Dict {
  const ind = readIndirectAt(src, off);
  const d = asDict(ind.val);
  if (!d || nameOf(d.get('Type')) !== 'XRef') return damaged('xref-stream');
  const w = (d.get('W') as Val[] | undefined)?.map((x) => asNum(x) ?? -1);
  if (!w || w.length !== 3 || w.some((x) => x < 0 || x > 8)) return damaged('xref-W');
  const [w0, w1, w2] = w as [number, number, number];
  const size = asNum(d.get('Size')) ?? damaged('xref-size');
  const idx = (d.get('Index') as Val[] | undefined)?.map((x) => asNum(x) ?? 0) ?? [0, size];
  const data = streamData({ src, xref }, ind);
  const rl = w0 + w1 + w2;
  let p = 0;
  const rd = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + data[p++]!; return v; };
  for (let k = 0; k + 1 < idx.length; k += 2) {
    for (let i = 0; i < idx[k + 1]!; i++) {
      if (p + rl > data.length) return damaged('xref-short');
      const t = w0 ? rd(w0) : 1, a = rd(w1), b = rd(w2);
      mergeEntries(xref, idx[k]! + i, t === 0 ? { t: 0 } : t === 1 ? { t: 1, off: a, gen: b } : t === 2 ? { t: 2, stm: a, idx: b } : { t: 0 });
    }
  }
  return d;
}

export function loadDoc(src: Source): Doc {
  const tailLen = Math.min(src.size, LIMITS.tail);
  const tail = src.read(src.size - tailLen, tailLen);
  const sx = tail.lastIndexOf('startxref');
  if (sx < 0) return damaged('no-startxref');
  const m = /^startxref\s+(\d+)/.exec(tail.toString('latin1', sx, sx + 40));
  if (!m) return damaged('startxref-value');
  const eof = tail.lastIndexOf('%%EOF');
  const trailing = eof < 0 ? 0 : Math.max(0, tail.toString('latin1', eof + 5).replace(/\s+$/, '').length);
  let off = Number(m[1]);
  const xref = new Map<number, XEnt>();
  const seen = new Set<number>();
  let trailer: Dict | undefined, lastKind: 'table' | 'stream' = 'table', sections = 0, hybrid = false;
  const first = off;
  while (off !== undefined) {
    if (seen.has(off)) return damaged('prev-cycle');
    seen.add(off);
    if (++sections > LIMITS.prevChain) return damaged('prev-chain');
    if (off >= src.size) return damaged('xref-offset');
    const isTable = src.read(off, 24).toString('latin1').trimStart().startsWith('xref');
    const own = new Map<number, XEnt>();
    const t = isTable ? readTable(src, off, own) : readStreamSection(src, off, own);
    if (!trailer) { trailer = t; lastKind = isTable ? 'table' : 'stream'; }
    const xs = asNum(t.get('XRefStm'));
    const stm = new Map<number, XEnt>();
    if (isTable && xs !== undefined) {
      hybrid = true;
      if (seen.has(xs)) return damaged('prev-cycle');
      seen.add(xs);
      readStreamSection(src, xs, stm);
    }
    // Hybrid precedence: table entries in use, then the XRefStm (objects in streams are 'free' in the table), then table frees.
    for (const [n, e] of own) if (e.t !== 0) mergeEntries(xref, n, e);
    for (const [n, e] of stm) mergeEntries(xref, n, e);
    for (const [n, e] of own) if (e.t === 0) mergeEntries(xref, n, e);
    const prev = asNum(t.get('Prev'));
    if (prev === undefined) break;
    off = prev;
  }
  if (!trailer) return damaged('no-trailer');
  let size = asNum(trailer.get('Size')) ?? 0;
  for (const n of xref.keys()) size = Math.max(size, n + 1);
  return { src, xref, trailer, lastKind, lastStartxref: first, sections, hybrid, size, trailing, objstm: new Map() };
}

export function resolveObj(doc: Doc, n: number): Indirect | undefined {
  const e = doc.xref.get(n);
  if (!e || e.t === 0) return undefined;
  if (e.t === 1) {
    const ind = readIndirectAt(doc.src, e.off);
    if (ind.num !== n) return damaged('obj-mismatch');
    return ind;
  }
  let os = doc.objstm.get(e.stm);
  if (!os) {
    const so = doc.xref.get(e.stm);
    if (!so || so.t !== 1) return damaged('objstm-missing');
    const ind = readIndirectAt(doc.src, so.off);
    const d = asDict(ind.val);
    const N = asNum(d?.get('N')) ?? -1, first = asNum(d?.get('First')) ?? -1;
    if (!d || nameOf(d.get('Type')) !== 'ObjStm' || N < 0 || N > LIMITS.objects || first < 0) return damaged('objstm');
    const objs = streamData(doc, ind);
    const lx = new Lexer(objs.subarray(0, first));
    const nums: number[] = [], offs: number[] = [];
    for (let i = 0; i < N; i++) { nums.push(Number(lx.word())); offs.push(Number(lx.word())); }
    os = { objs, nums, offs, first };
    if (doc.objstm.size > 4) doc.objstm.clear();
    doc.objstm.set(e.stm, os);
  }
  if (os.nums[e.idx] !== n) return damaged('objstm-index');
  const val = new Lexer(os.objs, os.first + os.offs[e.idx]!).value();
  return { num: n, gen: 0, val, dataStart: -1 };
}

export function resolve(doc: Doc, v: Val | undefined, depth = 0): Val | undefined {
  while (v instanceof Ref) {
    if (depth++ > 32) return damaged('ref-chain');
    v = resolveObj(doc, v.n)?.val;
  }
  return v;
}
export const dictOf = (doc: Doc, v: Val | undefined) => asDict(resolve(doc, v));

export interface Page { ref: Ref; dict: Dict; inh: { MediaBox?: Val; CropBox?: Val; Rotate?: Val } }

/** Page `index` (0-based) by walking /Pages with /Count; cycles and depth are bounded. */
export function getPage(doc: Doc, index: number): Page | undefined {
  const root = dictOf(doc, doc.trailer.get('Root')) ?? damaged('no-root');
  const seen = new Set<number>();
  let want = index;
  const walk = (ref: Ref, node: Dict, inh: Page['inh'], depth: number): Page | undefined => {
    if (depth > 64 || seen.has(ref.n)) return damaged('pages-cycle');
    seen.add(ref.n);
    const next = { ...inh };
    for (const k of ['MediaBox', 'CropBox', 'Rotate'] as const) { const v = resolve(doc, node.get(k)); if (v !== undefined) next[k] = v; }
    const kids = resolve(doc, node.get('Kids'));
    if (!Array.isArray(kids)) return want-- === 0 ? { ref, dict: node, inh: next } : undefined;
    for (const k of kids) {
      if (!(k instanceof Ref)) return damaged('kid-not-ref');
      const kd = dictOf(doc, k) ?? damaged('kid-missing');
      const cnt = Array.isArray(resolve(doc, kd.get('Kids'))) ? asNum(resolve(doc, kd.get('Count'))) : undefined;
      if (cnt !== undefined && cnt >= 0 && want >= cnt) { want -= cnt; continue; }
      const r = walk(k, kd, next, depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  const pr = root.get('Pages');
  if (!(pr instanceof Ref)) return damaged('no-pages');
  return walk(pr, dictOf(doc, pr) ?? damaged('pages-missing'), {}, 0);
}

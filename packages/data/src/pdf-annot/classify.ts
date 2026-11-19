// Classifies what was appended to a PDF by an incremental update (ARCHITETTURA-UI §8.3.6, D-350): the CONTENT of the added
// revision is judged, not who wrote it. "annotations" means the page content cannot have changed; anything else, or anything
// that cannot be read with certainty, is "content" (the caller then treats the file as changed, as it always did).
// G4a extends this file (writer-side readers) without changing `classifyIncrement`, `Source` or the lexer helpers.
import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

export interface Source {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

export const bufSource = (b: Buffer): Source => ({ size: b.length, read: async (o, n) => b.subarray(o, o + n) });

/** Runs `fn` with a `Source` over a file; the handle is always closed. */
export async function withFileSource<T>(file: string, fn: (s: Source) => Promise<T>): Promise<T> {
  const h = await open(file, 'r');
  try {
    const size = (await h.stat()).size;
    return await fn({
      size,
      read: async (o, n) => {
        const len = Math.max(0, Math.min(n, size - o));
        const r = await h.read(Buffer.alloc(len), 0, len, o);
        return r.buffer.subarray(0, r.bytesRead);
      },
    });
  } finally {
    await h.close();
  }
}

/** `annotations`: nothing but annotations (and what they need); `content`: anything else, or not provable. */
export type IncrementKind = 'annotations' | 'content';

export const INCREMENT_LIMITS = { region: 16 * 1024 * 1024, objStm: 16 * 1024 * 1024, scan: 1024 * 1024 * 1024, chunk: 4 * 1024 * 1024, oldBody: 16 * 1024 };

/* ------------------------------------------------ lexer ------------------------------------------------ */

const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;

function skipString(t: string, i: number): number {
  let depth = 0;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') i++;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

const nameLen = (t: string, i: number): number => {
  let n = 0;
  while (i + n < t.length && !WS.test(t[i + n]!) && !DELIM.test(t[i + n]!)) n++;
  return n;
};

/** Reads one value starting at `i`: `[end, text]`, or null. Handles nested dictionaries, arrays, strings and `N G R`. */
function readValue(t: string, i: number): [number, string] | null {
  while (i < t.length && WS.test(t[i]!)) i++;
  const c = t[i];
  let e = -1;
  if (c === '(') e = skipString(t, i);
  else if (c === '<' && t[i + 1] !== '<') e = t.indexOf('>', i) + 1 || -1;
  else if (c === '<') {
    let d = 0;
    for (e = i; e < t.length; e++) {
      if (t[e] === '(') { e = skipString(t, e) - 1; if (e < 0) return null; }
      else if (t[e] === '<' && t[e + 1] === '<') { d++; e++; }
      else if (t[e] === '>' && t[e + 1] === '>' && --d === 0) { e += 2; break; }
      else if (t[e] === '>' && t[e + 1] === '>') e++;
    }
    if (d !== 0) return null;
  } else if (c === '[') {
    let d = 0;
    for (e = i; e < t.length; e++) {
      if (t[e] === '(') { e = skipString(t, e) - 1; if (e < 0) return null; }
      else if (t[e] === '[') d++;
      else if (t[e] === ']' && --d === 0) { e++; break; }
    }
    if (d !== 0) return null;
  } else if (c === '/') e = i + 1 + nameLen(t, i + 1);
  else if (c !== undefined) {
    const m = /^[+-]?\d+(?:\.\d*)?(?:\s+\d+\s+R(?![A-Za-z]))?|^[A-Za-z]+/.exec(t.slice(i, i + 64));
    if (m) e = i + m[0].length;
  }
  return e < 0 ? null : [e, t.slice(i, e).replace(/\s+/g, ' ')];
}

/** Top-level keys of the dictionary that starts at `i` (`<<`): name -> value text (whitespace collapsed); end index. */
export function readDict(t: string, i: number): { d: Map<string, string>; end: number } | null {
  while (i < t.length && WS.test(t[i]!)) i++;
  if (!t.startsWith('<<', i)) return null;
  const d = new Map<string, string>();
  i += 2;
  for (;;) {
    while (i < t.length && WS.test(t[i]!)) i++;
    if (t.startsWith('>>', i)) return { d, end: i + 2 };
    if (t[i] !== '/') return null;
    const k = t.slice(i + 1, i + 1 + nameLen(t, i + 1));
    const v = readValue(t, i + 1 + k.length);
    if (!v) return null;
    d.set(k, v[1]);
    i = v[0];
  }
}

/* ------------------------------------------------ objects ------------------------------------------------ */

type Entry = { type: 'dict'; d: Map<string, string>; stream?: Buffer } | { type: 'array'; refsOnly: boolean } | { type: 'other' };
const REF = /(\d+) \d+ R/g;
const refsIn = (s: string | undefined): number[] => (s ? [...s.matchAll(REF)].map((m) => Number(m[1])) : []);
const nm = (d: Map<string, string>, k: string): string | undefined => /^\/(.+)$/.exec(d.get(k) ?? '')?.[1];

function entryOf(body: string): Entry | null {
  let i = 0;
  while (i < body.length && WS.test(body[i]!)) i++;
  if (body.startsWith('<<', i)) {
    const r = readDict(body, i);
    return r ? { type: 'dict', d: r.d } : null;
  }
  if (body[i] === '[') {
    const v = readValue(body, i);
    return v ? { type: 'array', refsOnly: /^\[(?: ?\d+ \d+ R)* ?\]$/.test(v[1]) } : null;
  }
  return { type: 'other' };
}

interface Obj {
  num: number;
  entry: Entry;
}

/** Objects of a stretch of file (a whole revision, or one object): stream data is kept only for object streams. */
function parseObjects(t: string): Obj[] | null {
  const out: Obj[] = [];
  const head = /(?:^|[\r\n])[ \t]*(\d{1,10})[ \t]+\d{1,5}[ \t]+obj\b/g;
  for (let m = head.exec(t); m; m = head.exec(t)) {
    const start = m.index + m[0].length;
    const entry = entryOf(t.slice(start, start + INCREMENT_LIMITS.oldBody));
    if (!entry) return null;
    let next = t.indexOf('endobj', start);
    if (entry.type === 'dict') {
      const r = readDict(t, start);
      const s = r ? /^[\t\n\f\r ]*stream(\r\n|\n|\r)/.exec(t.slice(r.end, r.end + 24)) : null;
      if (r && s) {
        const from = r.end + s[0].length;
        const len = /^\d+$/.test(r.d.get('Length') ?? '') ? Number(r.d.get('Length')) : -1;
        const to = len >= 0 && t.startsWith('endstream', from + len + (/^[\r\n]/.test(t[from + len] ?? '') ? t[from + len] === '\r' && t[from + len + 1] === '\n' ? 2 : 1 : 0)) ? from + len : t.indexOf('endstream', from);
        if (to < 0) return null;
        if (nm(r.d, 'Type') === 'ObjStm' || nm(r.d, 'Type') === 'XRef') entry.stream = Buffer.from(t.slice(from, to), 'latin1');
        else entry.stream = Buffer.alloc(0);
        next = t.indexOf('endobj', to);
        head.lastIndex = Math.max(head.lastIndex, to);
      }
    }
    if (next < 0) return null;
    out.push({ num: Number(m[1]), entry });
    head.lastIndex = Math.max(head.lastIndex, next);
  }
  return out;
}

/** The objects stored inside an object stream (decoded, no predictor); null when it cannot be read. */
function objStmObjects(e: Entry & { type: 'dict' }): Obj[] | null {
  if (!e.stream || e.d.has('DecodeParms') || e.d.has('Extends') || (e.d.get('Filter') ?? '/FlateDecode') !== '/FlateDecode') return null;
  const n = Number(e.d.get('N')), first = Number(e.d.get('First'));
  if (!(n >= 0 && n <= 100_000 && first >= 0)) return null;
  let text: string;
  try {
    text = inflateSync(e.stream, { maxOutputLength: INCREMENT_LIMITS.objStm }).toString('latin1');
  } catch {
    return null;
  }
  const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
  const out: Obj[] = [];
  for (let k = 0; k < n; k++) {
    const num = nums[2 * k], off = nums[2 * k + 1];
    if (num === undefined || off === undefined || !(num >= 0 && off >= 0)) return null;
    const end = k + 1 < n ? first + (nums[2 * k + 3] ?? 0) : text.length;
    const entry = entryOf(text.slice(first + off, end));
    if (!entry) return null;
    out.push({ num, entry });
  }
  return out;
}

/* ------------------------------------------------ the old revision ------------------------------------------------ */

/** `/Size` of the last trailer of the first `end` bytes (classic trailer or xref stream dictionary). */
async function trailerAt(src: Source, end: number): Promise<string | null> {
  const tail = (await src.read(Math.max(0, end - 1024), Math.min(end, 1024))).toString('latin1');
  const sx = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!sx) return null;
  const at = Number(sx[1]);
  if (!(at >= 0 && at < end)) return null;
  const head = (await src.read(at, 2048)).toString('latin1');
  // Classic table: the trailer is the last one in the tail; xref stream: its dictionary sits at `startxref`.
  return /^\s*xref/.test(head) ? tail.slice(tail.lastIndexOf('trailer')) : head;
}
async function sizeAt(src: Source, end: number): Promise<number | null> {
  const m = /\/Size\s+(\d+)/.exec((await trailerAt(src, end)) ?? '');
  return m ? Number(m[1]) : null;
}
/** `/Root` of the last trailer of the first `end` bytes, as "n g". */
async function rootAt(src: Source, end: number): Promise<string | null> {
  const m = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec((await trailerAt(src, end)) ?? '');
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Latest plain (not compressed) definition of each wanted object number in the first `end` bytes: number -> entry. */
async function oldEntries(src: Source, end: number, wanted: Set<number>): Promise<Map<number, Entry | null> | null> {
  const found = new Map<number, number>();
  const re = /(?:^|[\r\n])[ \t]*(\d{1,10})[ \t]+\d{1,5}[ \t]+obj\b/g;
  const KEEP = 48;
  let seen = 0, carry = '';
  for (let off = 0; off < end; off += INCREMENT_LIMITS.chunk) {
    if (off > INCREMENT_LIMITS.scan) return null;
    const text = carry + (await src.read(off, Math.min(INCREMENT_LIMITS.chunk, end - off))).toString('latin1');
    const base = off - carry.length;
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const abs = base + m.index + m[0].length;
      if (abs <= seen) continue;
      if (wanted.has(Number(m[1]))) found.set(Number(m[1]), abs);
    }
    seen = base + text.length - KEEP;
    carry = text.slice(-KEEP);
  }
  const out = new Map<number, Entry | null>();
  for (const [num, at] of found) out.set(num, entryOf((await src.read(at, INCREMENT_LIMITS.oldBody)).toString('latin1')));
  return out;
}

/* ------------------------------------------------ the added xref sections ------------------------------------------------ */

/** One entry of an added xref section: type 0 free, 1 at an offset, 2 inside an object stream. */
interface Row { num: number; t: 0 | 1 | 2; a: number }
const MAX_ROWS = 1_000_000;
const rootOf = (v: string | undefined): string | null => {
  const m = /^(\d+) (\d+) R$/.exec(v ?? '');
  return m ? `${m[1]} ${m[2]}` : null;
};

/** Every classic `xref` section of the text: its rows and the `/Root` of its trailer; null when one cannot be read. */
function tableSections(t: string): { rows: Row[]; roots: Array<string | null> } | null {
  const rows: Row[] = [], roots: Array<string | null> = [];
  const kw = /(?:^|[\r\n])xref[ \t]*[\r\n]/g;
  for (let m = kw.exec(t); m; m = kw.exec(t)) {
    let pos = m.index + m[0].length;
    const sub = /\s*(\d+)\s+(\d+)[ \t]*[\r\n]/y, ent = /\s*(\d{1,10})\s+(\d{1,5})\s+([nf])/y;
    for (;;) {
      sub.lastIndex = pos;
      const h = sub.exec(t);
      if (!h) break;
      const start = Number(h[1]), count = Number(h[2]);
      pos = sub.lastIndex;
      if (rows.length + count > MAX_ROWS) return null;
      for (let i = 0; i < count; i++) {
        ent.lastIndex = pos;
        const e = ent.exec(t);
        if (!e) return null;
        rows.push({ num: start + i, t: e[3] === 'n' ? 1 : 0, a: Number(e[1]) });
        pos = ent.lastIndex;
      }
    }
    const tr = /\s*trailer/y;
    tr.lastIndex = pos;
    if (!tr.exec(t)) return null;
    const d = readDict(t, tr.lastIndex);
    if (!d) return null;
    roots.push(rootOf(d.d.get('Root')));
  }
  return { rows, roots };
}

/** The rows of an xref stream (Flate or none; no predictor or the PNG ones None, Sub, Up); null when it cannot be read with certainty. */
function streamRows(e: Entry & { type: 'dict' }): Row[] | null {
  const w = (e.d.get('W') ?? '').match(/\d+/g)?.map(Number);
  if (!w || w.length !== 3 || w.some((x) => x > 8)) return null;
  const [w0, w1, w2] = w as [number, number, number];
  const rl = w0 + w1 + w2;
  let data = e.stream;
  if (!data || rl === 0) return null;
  const filter = e.d.get('Filter');
  if (filter !== undefined) {
    if (filter !== '/FlateDecode') return null;
    try {
      data = inflateSync(data, { maxOutputLength: INCREMENT_LIMITS.objStm });
    } catch {
      return null;
    }
  }
  const dp = e.d.has('DecodeParms') ? readDict(e.d.get('DecodeParms')!, 0)?.d : undefined;
  const pred = Number(dp?.get('Predictor') ?? 1);
  if (pred >= 10) {
    if (Number(dp?.get('Columns') ?? 1) !== rl) return null;
    const n = Math.floor(data.length / (rl + 1));
    const out = Buffer.alloc(n * rl);
    for (let r = 0; r < n; r++) {
      const f = data[r * (rl + 1)]!;
      if (f > 2) return null;
      for (let i = 0, o = r * rl; i < rl; i++, o++) out[o] = (data[r * (rl + 1) + 1 + i]! + (f === 1 && i ? out[o - 1]! : 0) + (f === 2 && r ? out[o - rl]! : 0)) & 255;
    }
    data = out;
  } else if (pred !== 1) return null;
  const idx = (e.d.get('Index') ?? `[0 ${e.d.get('Size') ?? 0}]`).match(/\d+/g)?.map(Number) ?? [];
  const rows: Row[] = [];
  let p = 0;
  const rd = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + data![p++]!;
    return v;
  };
  for (let k = 0; k + 1 < idx.length; k += 2) {
    for (let i = 0; i < idx[k + 1]!; i++) {
      if (p + rl > data.length || rows.length >= MAX_ROWS) return null;
      const t = w0 ? rd(w0) : 1, a = rd(w1);
      p += w2;
      if (t > 2) return null;
      rows.push({ num: idx[k]! + i, t: t as 0 | 1 | 2, a });
    }
  }
  return rows;
}

/* ------------------------------------------------ the verdict ------------------------------------------------ */

const ANNOT_SUBTYPES = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment']);
type Kind = 'annot' | 'page' | 'catalog' | 'info' | 'meta' | 'form' | 'array' | 'xref' | 'objstm' | 'other';

function kindOf(e: Entry, info: boolean): Kind {
  if (e.type === 'array') return e.refsOnly ? 'array' : 'other';
  if (e.type !== 'dict') return 'other';
  const type = nm(e.d, 'Type'), sub = nm(e.d, 'Subtype');
  if (type === 'Annot' || (type === undefined && sub !== undefined && e.d.has('Rect'))) return sub !== undefined && ANNOT_SUBTYPES.has(sub) ? 'annot' : 'other';
  if (type === 'Page') return 'page';
  if (type === 'Catalog') return 'catalog';
  if (type === 'Metadata') return 'meta';
  if (type === 'XRef') return 'xref';
  if (type === 'ObjStm') return 'objstm';
  if (info) return 'info';
  return type === 'XObject' && sub === 'Form' ? 'form' : 'other';
}

/** Equal after dropping the keys an annotation-only revision may change. */
function sameWithout(a: Entry, b: Entry, keys: string[]): boolean {
  if (a.type !== 'dict' || b.type !== 'dict') return false;
  const strip = (d: Map<string, string>) => [...d].filter(([k]) => !keys.includes(k)).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  return strip(a.d) === strip(b.d);
}

/**
 * Judges the bytes appended after the first `oldSize` bytes of `src` (the previous version, whose own bytes are
 * untouched). Reads only the added region plus, for objects redefined by it, their previous definition.
 */
export async function classifyIncrement(src: Source, oldSize: number): Promise<IncrementKind> {
  try {
    if (!(oldSize > 0 && oldSize < src.size) || src.size - oldSize > INCREMENT_LIMITS.region) return 'content';
    const t = (await src.read(oldSize, src.size - oldSize)).toString('latin1');
    if (!/startxref\s+\d+\s+%%EOF/.test(t)) return 'content'; // not a revision: data after %%EOF
    const parsed = parseObjects(t);
    if (!parsed) return 'content';
    const objs: Obj[] = [];
    for (const o of parsed) {
      const inner = o.entry.type === 'dict' && nm(o.entry.d, 'Type') === 'ObjStm' ? objStmObjects(o.entry) : undefined;
      if (inner === null) return 'content';
      objs.push(...(inner ?? [o]));
    }
    const info = new Set<number>();
    for (const m of t.matchAll(/\/Info\s+(\d+) \d+ R/g)) info.add(Number(m[1]));
    const size = await sizeAt(src, oldSize);
    if (size === null) return 'content';
    const aps = new Set<number>();
    for (const o of objs) if (o.entry.type === 'dict' && kindOf(o.entry, false) === 'annot') refsIn(o.entry.d.get('AP')).forEach((n) => aps.add(n));
    // The added xref sections must not free or redirect anything that is not an annotation, a page, the catalog or metadata, and /Root stays.
    const tbl = tableSections(t);
    if (!tbl) return 'content';
    const rows = [...tbl.rows], roots = [...tbl.roots];
    for (const o of parsed) {
      if (o.entry.type !== 'dict' || nm(o.entry.d, 'Type') !== 'XRef') continue;
      const r = streamRows(o.entry);
      if (!r) return 'content';
      rows.push(...r);
      roots.push(rootOf(o.entry.d.get('Root')));
    }
    const oldRoot = await rootAt(src, oldSize);
    if (roots.length === 0 || !oldRoot || roots.some((r) => r !== oldRoot)) return 'content';
    const heads = new Map<number, Array<[number, number]>>();
    for (const m of t.matchAll(/(?:^|[\r\n])[ \t]*(\d{1,10})[ \t]+\d{1,5}[ \t]+obj\b/g)) {
      const lo = oldSize + m.index, k = Number(m[1]);
      heads.set(k, [...(heads.get(k) ?? []), [lo, lo + m[0].search(/\d/)]]);
    }
    const stmNums = new Set(parsed.filter((o) => o.entry.type === 'dict' && nm(o.entry.d, 'Type') === 'ObjStm').map((o) => o.num));
    const innerNums = new Set(objs.map((o) => o.num));
    const freed = new Set<number>();
    for (const r of rows) {
      if (r.t === 1 && !(heads.get(r.num) ?? []).some(([lo, hi]) => r.a >= lo && r.a <= hi)) return 'content';
      if (r.t === 2 && !(stmNums.has(r.a) && innerNums.has(r.num))) return 'content';
      if (r.t === 0 && r.num !== 0) freed.add(r.num);
    }
    const redefined = new Set([...objs.filter((o) => o.num < size).map((o) => o.num), ...freed]);
    const old = redefined.size ? await oldEntries(src, oldSize, redefined) : new Map<number, Entry | null>();
    if (!old) return 'content';
    for (const n of freed) {
      const before = old.get(n);
      if (!before || !['annot', 'page', 'catalog', 'meta', 'info'].includes(kindOf(before, info.has(n)))) return 'content';
    }
    for (const o of objs) {
      const k = kindOf(o.entry, info.has(o.num));
      const before = old.get(o.num);
      if (k === 'other' || (k === 'form' && !aps.has(o.num))) return 'content';
      if (k === 'xref' || k === 'objstm') continue;
      if (o.num < size && k !== 'meta' && k !== 'info') {
        if (!before || kindOf(before, false) !== k) return 'content';
        if (k === 'page' && !sameWithout(o.entry, before, ['Annots'])) return 'content';
        if (k === 'catalog' && !sameWithout(o.entry, before, ['Metadata'])) return 'content';
      }
      if (k === 'catalog' && o.num >= size) return 'content';
    }
    return 'annotations';
  } catch {
    return 'content';
  }
}

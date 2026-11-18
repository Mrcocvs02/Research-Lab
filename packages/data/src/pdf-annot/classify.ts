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
        if (nm(r.d, 'Type') === 'ObjStm') entry.stream = Buffer.from(t.slice(from, to), 'latin1');
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
async function sizeAt(src: Source, end: number): Promise<number | null> {
  const tail = (await src.read(Math.max(0, end - 1024), Math.min(end, 1024))).toString('latin1');
  const sx = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!sx) return null;
  const at = Number(sx[1]);
  if (!(at >= 0 && at < end)) return null;
  const head = (await src.read(at, 2048)).toString('latin1');
  // Classic table: the trailer is the last one in the tail; xref stream: its dictionary sits at `startxref`.
  const m = /\/Size\s+(\d+)/.exec(/^\s*xref/.test(head) ? tail.slice(tail.lastIndexOf('trailer')) : head);
  return m ? Number(m[1]) : null;
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
    const redefined = new Set(objs.filter((o) => o.num < size).map((o) => o.num));
    const old = redefined.size ? await oldEntries(src, oldSize, redefined) : new Map<number, Entry | null>();
    if (!old) return 'content';
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

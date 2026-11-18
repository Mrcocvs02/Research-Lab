// Analysis, reconciliation and the bytes of one incremental update (ARCHITETTURA-UI §8.3.3 step 3). Runs in the worker only.
// The original bytes stay an exact prefix of the result: `buildUpdate` produces what is appended at `src.size`, nothing else.
import { randomBytes } from 'node:crypto';
import { PDF_WRITE_LIMITS as LIM } from '@rl/core';
import { Name, PdfError, Ref, Str, asNum, damaged, ser, type Dict, type Val } from './objects.js';
import { dictOf, fileSource, getPage, resolve, setDeadline, tick, type Doc, type Page } from './doc.js';
import { analyze, type Reason } from './refuse.js';
import { annotObjects, colorName, COLORS, readAnnot, revOf, semOf, type AnnotSpec, type Rgb } from './annot.js';
import { fromPdfRects, pageGeometry, toPdfRects, type Rect } from './geometry.js';
import { reconcile, type AppItem, type PdfItem, type Verdict } from './reconcile.js';

export interface PlanAnnot {
  id: string;
  kind: 'highlight' | 'underline';
  /** 1-based. */
  page: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  color: string;
  comment?: string | undefined;
  createdAt: string;
  pdf?: { objNum: number; gen: number; rev: string; missing?: true } | undefined;
}

export interface SyncRequest {
  /** Absolute path of the PDF (the main process resolved and confined it). */
  path: string;
  mode: 'sync' | 'remove-all';
  /** Annotations that may be written (geom 2, aligned with the file). */
  annotations: PlanAnnot[];
  /** The other annotations of the app (never written now, but known: their objects are not orphans). */
  otherIds: string[];
  /** Ids this computer wrote, with their page (1-based): orphans among them were deleted here. */
  known: Record<string, number>;
  /** Name for `/T` (only with `annotations.author = 'profile'`). */
  author?: string | undefined;
  now: string;
}

/** What the verification (§8.3.3 step 6) expects on a touched page (0-based): the other references in order, and all of ours with their `rev`. */
export interface PageExpect { page: number; others: string[]; ours: Array<{ id: string; rev: string }> }

export interface AdoptItem { id: string; color?: string; comment?: string; rects?: Array<{ x: number; y: number; w: number; h: number }> }
export interface Mark { id: string; objNum: number; gen: number; rev: string }

export type SyncResult =
  | { ok: false; reason: Reason; detail: string; emptyPassword?: boolean | undefined }
  | {
      ok: true;
      /** null: nothing to append. */
      update: { bytes: Buffer; oldSize: number; newSize: number } | null;
      expect: PageExpect[];
      marks: Mark[];
      /** Ids whose `pdf` mark is cleared (taken out of the PDF). */
      cleared: string[];
      adopt: AdoptItem[];
      missing: string[];
      conflicts: number;
      foreign: number;
      external: number;
      revisions: number;
      /** Pages of the file (`/Count`). */
      pages: number;
      size: number;
      trailingBytes: number;
    };

const refKey = (r: Ref) => `${r.n} ${r.g}`;
const rgbOf = (name: string): Rgb => COLORS[name] ?? COLORS['yellow']!;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** The `/Annots` of a page as the original elements (non-references are kept as they are), and its own reference when it is indirect. */
function annotsOf(doc: Doc, page: Page): { arr: Val[]; ref: Ref | undefined } {
  const cur = page.dict.get('Annots');
  const v = resolve(doc, cur);
  if (v !== undefined && !Array.isArray(v)) return damaged('annots-type');
  if (v && v.length > LIM.maxObjStmObjects) return damaged('annots-size');
  return { arr: v ?? [], ref: cur instanceof Ref ? cur : undefined };
}

/** Our annotations (and the count of the others) on the given 0-based pages. */
function scanPages(doc: Doc, pages: number[]): { items: PdfItem[]; external: number } {
  const items: PdfItem[] = [];
  let external = 0;
  for (const idx of pages) {
    tick();
    const page = getPage(doc, idx);
    if (!page) continue;
    for (const el of annotsOf(doc, page).arr) {
      const f = el instanceof Ref ? readAnnot(doc, el) : null;
      if (f?.nm?.startsWith('rl-') && el instanceof Ref) items.push({ id: f.nm.slice(3), page: idx + 1, ref: el, sem: f.sem, rev: revOf(f.sem) });
      else external++;
    }
  }
  return { items, external };
}

/** `/Count` of the root of the page tree. */
export function pageCountOf(doc: Doc): number {
  const root = dictOf(doc, doc.trailer.get('Root'));
  const n = asNum(resolve(doc, dictOf(doc, root?.get('Pages'))?.get('Count')));
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Reads the file, reconciles and, when there is something to write, builds the update. Never throws for a bad file: the result says why. */
export async function planSync(req: SyncRequest): Promise<SyncResult> {
  const src = fileSource(req.path);
  setDeadline(LIM.workerTimeoutMs);
  try {
    const a = await analyze(src);
    if (!a.ok) return { ok: false, reason: a.reason, detail: a.detail, emptyPassword: a.emptyPassword };
    const doc = a.doc;
    const total = pageCountOf(doc);
    // A `/Count` that the tree does not bear out means a damaged file (§8.3.13): nothing is written to it.
    if (total === 0 || !getPage(doc, total - 1) || getPage(doc, total)) return { ok: false, reason: 'damaged', detail: 'page-count' };
    const wanted = new Set<number>();
    if (req.mode === 'remove-all') for (let i = 0; i < Math.min(total, 100_000); i++) wanted.add(i);
    else {
      for (const x of req.annotations) wanted.add(x.page - 1);
      for (const p of Object.values(req.known)) wanted.add(p - 1);
    }
    const pages = [...wanted].filter((i) => i >= 0 && i < total).sort((x, y) => x - y);
    const scan = scanPages(doc, pages);

    let verdict: Verdict;
    const specs = new Map<string, AnnotSpec>();
    if (req.mode === 'remove-all') verdict = { add: [], modify: [], remove: scan.items, adopt: [], missing: [], relink: [], conflicts: 0, foreign: 0 };
    else {
      const items: AppItem[] = [];
      for (const x of req.annotations) {
        const page = x.page - 1 < total ? getPage(doc, x.page - 1) : undefined;
        if (!page) continue; // a page the file does not have: the annotation stays in the app only
        const g = pageGeometry(page);
        if (!(g.box[2] - g.box[0] > 0 && g.box[3] - g.box[1] > 0)) return { ok: false, reason: 'damaged', detail: 'page-box' };
        const rects = toPdfRects(x.rects.map((r): Rect => [r.x, r.y, r.x + r.w, r.y + r.h]), g);
        const spec: AnnotSpec = { nm: `rl-${x.id}`, subtype: x.kind === 'underline' ? 'Underline' : 'Highlight', rects, color: rgbOf(x.color), contents: x.comment || undefined, author: req.author, created: x.createdAt };
        specs.set(x.id, spec);
        const sem = semOf(spec);
        items.push({ id: x.id, page: x.page, sem, rev: revOf(sem), pdf: x.pdf });
      }
      const ids = new Set([...req.otherIds, ...req.annotations.map((x) => x.id)]);
      verdict = reconcile(items, scan.items, ids, new Set(Object.keys(req.known)));
    }

    const marks: Mark[] = verdict.relink.map((r) => ({ id: r.id, objNum: r.ref.n, gen: r.ref.g, rev: r.rev }));
    const adopt: AdoptItem[] = verdict.adopt.map((p) => {
      const g = pageGeometry(getPage(doc, p.page - 1)!);
      const c = colorName(p.sem.c);
      const rects = fromPdfRects(readAnnot(doc, p.ref)?.rects ?? [], g).map(([u0, v0, u1, v1]) => ({ x: clamp(u0), y: clamp(v0), w: clamp(u1) - clamp(u0), h: clamp(v1) - clamp(v0) }));
      return { id: p.id, ...(c ? { color: c } : {}), comment: p.sem.t, ...(rects.length ? { rects } : {}) };
    });
    const common = { cleared: verdict.remove.map((p) => p.id), adopt, missing: verdict.missing, conflicts: verdict.conflicts, foreign: verdict.foreign, external: scan.external, revisions: doc.sections, pages: total, size: src.size, trailingBytes: doc.trailing };
    if (verdict.add.length + verdict.modify.length + verdict.remove.length === 0) return { ok: true, update: null, expect: [], marks, ...common };

    const built = buildUpdate(doc, verdict, specs, scan.items, req.now);
    return { ok: true, update: built.update, expect: built.expect, marks: [...marks, ...built.marks], ...common };
  } catch (e) {
    if (e instanceof PdfError) return { ok: false, reason: 'damaged', detail: e.code };
    return { ok: false, reason: 'damaged', detail: 'internal' };
  } finally {
    src.close();
    setDeadline(0);
  }
}

/** The bytes appended to the file: new and changed objects, one new xref section of the same kind as the last, trailer, `startxref`. */
function buildUpdate(doc: Doc, v: Verdict, specs: Map<string, AnnotSpec>, found: PdfItem[], now: string): { update: { bytes: Buffer; oldSize: number; newSize: number }; expect: PageExpect[]; marks: Mark[] } {
  const oldSize = doc.src.size;
  const parts: Buffer[] = [doc.src.read(oldSize - 1, 1)[0] === 10 ? Buffer.alloc(0) : Buffer.from('\n')];
  let pos = oldSize + parts[0]!.length;
  let next = doc.size;
  const written: Array<{ n: number; g: number; off: number }> = [];
  const emit = (n: number, g: number, body: Buffer | string) => {
    const b = Buffer.concat([Buffer.from(`${n} ${g} obj\n`), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n')]);
    written.push({ n, g, off: pos });
    parts.push(b);
    pos += b.length;
  };
  const cr = doc.crypt;
  const strSeal = (n: number, g: number) => (cr ? (b: Buffer) => cr.encStr(b, n, g) : undefined);
  const sealFor = (n: number, g: number, ap: number) => (cr ? { str: strSeal(n, g)!, stream: (b: Buffer) => cr.encStream(b, ap, 0) } : undefined);
  const pageSet = new Set<number>([...v.add.map((a) => a.page), ...v.modify.map((m) => m.item.page), ...v.remove.map((r) => r.page)]);
  const expect: PageExpect[] = [];
  const marks: Mark[] = [];
  for (const num of [...pageSet].sort((a, b) => a - b)) {
    tick();
    const page = getPage(doc, num - 1) ?? damaged('page-missing');
    const { arr: cur, ref: arrRef } = annotsOf(doc, page);
    const dropped = new Set(v.remove.filter((r) => r.page === num).map((r) => refKey(r.ref)));
    const oursHere = found.filter((f) => f.page === num);
    const oursRefs = new Set(oursHere.map((f) => refKey(f.ref)));
    // The other references stay where they are, in the same order; the new ones of ours go to the end.
    const arr: Val[] = cur.filter((el) => !(el instanceof Ref && dropped.has(refKey(el))));
    const others = arr.map((el) => (el instanceof Ref ? refKey(el) : '?')).filter((k) => !oursRefs.has(k));
    const ours = new Map(oursHere.filter((f) => !dropped.has(refKey(f.ref))).map((f) => [f.id, f.rev]));
    const place = (ref: Ref | undefined, item: AppItem) => {
      const ap = next++;
      const objNum = ref?.n ?? next++;
      const gen = ref?.g ?? 0;
      const o = annotObjects(specs.get(item.id)!, page.ref, ap, now, sealFor(objNum, gen, ap));
      emit(ap, 0, o.ap);
      emit(objNum, gen, o.dict);
      if (!ref) arr.push(new Ref(objNum, gen));
      ours.set(item.id, item.rev);
      marks.push({ id: item.id, objNum, gen, rev: item.rev });
    };
    for (const a of v.add.filter((x) => x.page === num)) place(undefined, a);
    for (const m of v.modify.filter((x) => x.item.page === num)) place(m.ref, m.item);
    const arrNum = arrRef?.n ?? next++;
    emit(arrNum, arrRef?.g ?? 0, ser(arr, [], strSeal(arrNum, arrRef?.g ?? 0)));
    if (!arrRef) {
      const d: Dict = new Map(page.dict);
      d.set('Annots', new Ref(arrNum, 0));
      emit(page.ref.n, page.ref.g, ser(d, [], strSeal(page.ref.n, page.ref.g)));
    }
    expect.push({ page: num - 1, others, ours: [...ours].map(([id, rev]) => ({ id, rev })) });
  }
  const sz = Math.max(doc.size, next);
  if (sz > 0xffffffff - 2) damaged('size');
  const t = doc.trailer;
  const common: Array<[string, Val]> = [['Root', t.get('Root') ?? null]];
  if (t.has('Info')) common.push(['Info', t.get('Info') ?? null]);
  if (t.has('Encrypt')) common.push(['Encrypt', t.get('Encrypt') ?? null]);
  const id = resolve(doc, t.get('ID'));
  if (Array.isArray(id) && id[0] instanceof Str) common.push(['ID', [id[0], new Str(randomBytes(16))]]);
  const entries = written.sort((a, b) => a.n - b.n);
  const xrefPos = pos;
  const tail: Buffer[] = [];
  if (doc.lastKind === 'table') {
    let s = 'xref\n';
    for (let i = 0; i < entries.length; ) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1]!.n === entries[j]!.n + 1) j++;
      s += `${entries[i]!.n} ${j - i + 1}\n` + entries.slice(i, j + 1).map((e) => `${String(e.off).padStart(10, '0')} ${String(e.g).padStart(5, '0')} n \n`).join('');
      i = j + 1;
    }
    s += 'trailer\n' + ser(new Map<string, Val>([['Size', sz], ...common, ['Prev', doc.lastStartxref]])) + '\n';
    tail.push(Buffer.from(s, 'latin1'));
  } else {
    const all = [...entries, { n: sz, g: 0, off: xrefPos }].sort((a, b) => a.n - b.n);
    const index: number[] = [];
    const rows: Buffer[] = [];
    for (let i = 0; i < all.length; i++) {
      const e = all[i]!;
      if (i === 0 || e.n !== all[i - 1]!.n + 1) index.push(e.n, 0);
      index[index.length - 1] = (index.at(-1) ?? 0) + 1;
      const r = Buffer.alloc(7);
      r[0] = 1;
      r.writeUInt32BE(e.off, 1);
      r.writeUInt16BE(e.g, 5);
      rows.push(r);
    }
    const data = Buffer.concat(rows);
    const d = new Map<string, Val>([['Type', new Name('XRef')], ['Size', sz + 1], ['W', [1, 4, 2]], ['Index', index], ...common, ['Prev', doc.lastStartxref], ['Length', data.length]]);
    tail.push(Buffer.concat([Buffer.from(`${sz} 0 obj\n${ser(d)}\nstream\n`), data, Buffer.from('\nendstream\nendobj\n')]));
  }
  tail.push(Buffer.from(`startxref\n${xrefPos}\n%%EOF\n`));
  const bytes = Buffer.concat([...parts, ...tail]);
  return { update: { bytes, oldSize, newSize: oldSize + bytes.length }, expect, marks };
}

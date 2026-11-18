// Incremental-update writer: appends or removes Highlight / Underline annotations (spike S2).
// The original bytes stay an exact prefix; the result of buildUpdate() is appended at src.size.
import { randomBytes } from 'node:crypto';
import { Name, Ref, Str, asDict, asNum, damaged, pdfText, ser, type Dict, type Val } from './objects';
import { dictOf, getPage, resolve, type Doc } from './doc';

export type Rect = [number, number, number, number];
export interface AnnotSpec {
  nm: string;
  subtype: 'Highlight' | 'Underline';
  page: number;
  rects: Rect[];
  color: [number, number, number];
  contents?: string;
  /** Present when replacing an existing annotation: same object number, new content. */
  ref?: Ref;
}
export interface Ops { add?: AnnotSpec[]; remove?: { page: number; nm: string }[] }
export interface Update { bytes: Buffer; oldSize: number; objects: number; newObjects: number }

const f2 = (n: number) => n.toFixed(2).replace(/\.?0+$/, '') || '0';
const pdfDate = (d: Date) => 'D:' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';

const union = (rs: Rect[]): Rect => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];

function appearance(a: AnnotSpec, box: Rect): Buffer {
  const [r, g, b] = a.color.map(f2);
  let ops: string;
  if (a.subtype === 'Highlight') ops = `/G0 gs ${r} ${g} ${b} rg\n` + a.rects.map((q) => `${f2(q[0])} ${f2(q[1])} ${f2(q[2] - q[0])} ${f2(q[3] - q[1])} re f`).join('\n');
  else ops = `${r} ${g} ${b} RG\n` + a.rects.map((q) => { const h = q[3] - q[1]; return `${f2(Math.max(0.75, h / 14))} w ${f2(q[0])} ${f2(q[1] + h / 7)} m ${f2(q[2])} ${f2(q[1] + h / 7)} l S`; }).join('\n');
  const dict = `<< /Type /XObject /Subtype /Form /BBox [${box.map(f2).join(' ')}] /Resources << /ExtGState << /G0 << /BM /Multiply /CA 1 /ca 1 >> >> >> /Length ${Buffer.byteLength(ops)} >>`;
  return Buffer.from(`${dict}\nstream\n${ops}\nendstream`, 'latin1');
}

function annotDict(a: AnnotSpec, page: Ref, ap: number, now: Date): string {
  const box = union(a.rects);
  const quads = a.rects.map((q) => `${f2(q[0])} ${f2(q[3])} ${f2(q[2])} ${f2(q[3])} ${f2(q[0])} ${f2(q[1])} ${f2(q[2])} ${f2(q[1])}`).join(' ');
  const date = pdfDate(now);
  return `<< /Type /Annot /Subtype /${a.subtype} /Rect [${box.map(f2).join(' ')}] /QuadPoints [${quads}] /C [${a.color.map(f2).join(' ')}] /CA 1 /F 4 /P ${page.n} ${page.g} R /NM ${pdfText(a.nm)}${a.contents ? ' /Contents ' + pdfText(a.contents.slice(0, 8000)) : ''} /CreationDate (${date}) /M (${date}) /AP << /N ${ap} 0 R >> >>`;
}

const nmOf = (doc: Doc, v: Val | undefined): string | undefined => {
  const s = dictOf(doc, v)?.get('NM');
  return s instanceof Str ? s.b.toString('latin1') : undefined;
};

/** Our annotations (NM starting with rl-) on a page: reference, name and subtype. */
export function listOurs(doc: Doc, pageIndex: number): { ref: Ref; nm: string; subtype: string }[] {
  const p = getPage(doc, pageIndex);
  const arr = p && resolve(doc, p.dict.get('Annots'));
  if (!Array.isArray(arr)) return [];
  const out: { ref: Ref; nm: string; subtype: string }[] = [];
  for (const r of arr) {
    const nm = nmOf(doc, r);
    if (r instanceof Ref && nm?.startsWith('rl-')) out.push({ ref: r, nm, subtype: (dictOf(doc, r)?.get('Subtype') as Name).v });
  }
  return out;
}

export function buildUpdate(doc: Doc, ops: Ops, now = new Date()): Update {
  const oldSize = doc.src.size;
  const last = doc.src.read(oldSize - 1, 1);
  const parts: Buffer[] = [last[0] === 10 ? Buffer.alloc(0) : Buffer.from('\n')];
  let pos = oldSize + parts[0]!.length;
  let next = doc.size;
  const written: { n: number; g: number; off: number }[] = [];
  const emit = (n: number, g: number, body: Buffer | string) => {
    const b = Buffer.concat([Buffer.from(`${n} ${g} obj\n`), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n')]);
    written.push({ n, g, off: pos });
    parts.push(b);
    pos += b.length;
  };
  const pages = new Set([...(ops.add ?? []).map((a) => a.page), ...(ops.remove ?? []).map((r) => r.page)]);
  for (const idx of [...pages].sort((a, b) => a - b)) {
    const page = getPage(doc, idx) ?? damaged('page-missing');
    const cur = page.dict.get('Annots');
    const val = resolve(doc, cur);
    if (val !== undefined && !Array.isArray(val)) return damaged('annots-type');
    const removeNm = new Set((ops.remove ?? []).filter((r) => r.page === idx).map((r) => r.nm));
    const adds = (ops.add ?? []).filter((a) => a.page === idx);
    const arr: Val[] = (val ?? []).filter((r) => { const nm = nmOf(doc, r); return !(nm !== undefined && nm.startsWith('rl-') && removeNm.has(nm)); });
    const arrNum = cur instanceof Ref ? cur.n : next++;
    const arrGen = cur instanceof Ref ? cur.g : 0;
    for (const a of adds) {
      const num = a.ref?.n ?? next++;
      const ap = next++;
      emit(ap, 0, appearance(a, union(a.rects)));
      emit(num, a.ref?.g ?? 0, annotDict(a, page.ref, ap, now));
      const at = arr.findIndex((r) => r instanceof Ref && r.n === num);
      if (at < 0) arr.push(new Ref(num, a.ref?.g ?? 0));
    }
    emit(arrNum, arrGen, ser(arr));
    if (!(cur instanceof Ref)) {
      const d: Dict = new Map(page.dict);
      d.set('Annots', new Ref(arrNum, 0));
      emit(page.ref.n, page.ref.g, ser(d));
    }
  }
  const sz = Math.max(doc.size, next);
  const t = doc.trailer;
  const common: [string, Val][] = [['Root', t.get('Root') ?? null]];
  if (t.has('Info')) common.push(['Info', t.get('Info') ?? null]);
  const id = resolve(doc, t.get('ID'));
  if (Array.isArray(id) && id[0] instanceof Str) common.push(['ID', [id[0], new Str(randomBytes(16))]]);
  const entries = written.sort((a, b) => a.n - b.n);
  let xrefPos = pos;
  let size = sz;
  const tail: Buffer[] = [];
  if (doc.lastKind === 'table') {
    let s = 'xref\n';
    for (let i = 0; i < entries.length;) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1]!.n === entries[j]!.n + 1) j++;
      s += `${entries[i]!.n} ${j - i + 1}\n` + entries.slice(i, j + 1).map((e) => `${String(e.off).padStart(10, '0')} ${String(e.g).padStart(5, '0')} n \n`).join('');
      i = j + 1;
    }
    const tr = new Map<string, Val>([['Size', size], ...common, ['Prev', doc.lastStartxref]]);
    s += 'trailer\n' + ser(tr) + '\n';
    tail.push(Buffer.from(s, 'latin1'));
  } else {
    const xnum = sz;
    size = sz + 1;
    const all = [...entries, { n: xnum, g: 0, off: xrefPos }].sort((a, b) => a.n - b.n);
    const index: number[] = [];
    const rows: Buffer[] = [];
    for (let i = 0; i < all.length; i++) {
      const e = all[i]!;
      if (i === 0 || e.n !== all[i - 1]!.n + 1) index.push(e.n, 0);
      index[index.length - 1] = (index.at(-1) ?? 0) + 1;
      const r = Buffer.alloc(7);
      r[0] = 1; r.writeUInt32BE(e.off, 1); r.writeUInt16BE(e.g, 5);
      rows.push(r);
    }
    const data = Buffer.concat(rows);
    const d = new Map<string, Val>([['Type', new Name('XRef')], ['Size', size], ['W', [1, 4, 2]], ['Index', index], ...common, ['Prev', doc.lastStartxref], ['Length', data.length]]);
    tail.push(Buffer.concat([Buffer.from(`${xnum} 0 obj\n${ser(d)}\nstream\n`), data, Buffer.from('\nendstream\nendobj\n')]));
  }
  tail.push(Buffer.from(`startxref\n${xrefPos}\n%%EOF\n`));
  const bytes = Buffer.concat([...parts, ...tail]);
  return { bytes, oldSize, objects: written.length, newObjects: next - doc.size };
}

// The annotation objects we write (ARCHITETTURA-UI §8.3.2) and their semantic content, the basis of the three-way
// comparison of §8.3.7: subtype, QuadPoints rounded to 0.01, colour, contents and author, hashed in a canonical form.
import { createHash } from 'node:crypto';
import { PDF_WRITE_LIMITS as LIM } from '@rl/core';
import { Name, Ref, Str, asNum, nameOf, pdfText, type Val } from './objects.js';
import { dictOf, type Doc } from './doc.js';
import type { Rect } from './geometry.js';

export type Subtype = 'Highlight' | 'Underline';
export type Rgb = [number, number, number];

/** Colour names of the app and the RGB they are written with. */
export const COLORS: Record<string, Rgb> = { yellow: [1, 0.92, 0.23], green: [0.55, 0.9, 0.45], blue: [0.55, 0.75, 1], pink: [1, 0.65, 0.8], orange: [1, 0.72, 0.3] };

/** The name of the app colour closest to an RGB found in a PDF, or undefined when none is close (another programme's colour). */
export function colorName(c: number[]): string | undefined {
  let best: string | undefined, bd = 0.2;
  for (const [n, v] of Object.entries(COLORS)) {
    const d = Math.hypot(v[0] - (c[0] ?? 0), v[1] - (c[1] ?? 0), v[2] - (c[2] ?? 0));
    if (d < bd) (best = n), (bd = d);
  }
  return best;
}

/** What one annotation of the app becomes in the PDF; `rects` are in user space, `[x0 y0 x1 y1]`. */
export interface AnnotSpec {
  nm: string;
  subtype: Subtype;
  rects: Rect[];
  color: Rgb;
  contents?: string;
  author?: string;
  created: string;
}

const f2 = (n: number) => n.toFixed(2).replace(/\.?0+$/, '') || '0';
const r2 = (n: number) => Number(n.toFixed(2));
const union = (rs: Rect[]): Rect => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
export const pdfDate = (iso: string) => 'D:' + new Date(iso).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';

/** A comment as written: cut at the limit with an ellipsis. */
export const cutContents = (s: string): string => (s.length > LIM.maxContentsChars ? s.slice(0, LIM.maxContentsChars - 1) + '…' : s);

export const quadsOf = (rects: Rect[]): number[] => rects.flatMap((q) => [q[0], q[3], q[2], q[3], q[0], q[1], q[2], q[1]].map(r2));

/** The semantic content (§8.3.7) as a canonical string, and its hash `rev`. */
export interface Sem { s: string; q: number[]; c: number[]; t: string; a: string }
export const semOf = (a: Pick<AnnotSpec, 'subtype' | 'rects' | 'color' | 'contents' | 'author'>): Sem => ({ s: a.subtype, q: quadsOf(a.rects), c: a.color.map(r2), t: a.contents ? cutContents(a.contents) : '', a: a.author ?? '' });
export const revOf = (m: Sem): string => createHash('sha256').update(JSON.stringify([m.s, m.q, m.c, m.t, m.a])).digest('hex');

function appearance(a: AnnotSpec, box: Rect): Buffer {
  const [r, g, b] = a.color.map(f2);
  let ops: string;
  if (a.subtype === 'Highlight') ops = `/G0 gs ${r} ${g} ${b} rg\n` + a.rects.map((q) => `${f2(q[0])} ${f2(q[1])} ${f2(q[2] - q[0])} ${f2(q[3] - q[1])} re f`).join('\n');
  else ops = `${r} ${g} ${b} RG\n` + a.rects.map((q) => { const h = q[3] - q[1]; return `${f2(Math.max(0.75, h / 14))} w ${f2(q[0])} ${f2(q[1] + h / 7)} m ${f2(q[2])} ${f2(q[1] + h / 7)} l S`; }).join('\n');
  const dict = `<< /Type /XObject /Subtype /Form /BBox [${box.map(f2).join(' ')}] /Resources << /ExtGState << /G0 << /BM /Multiply /CA 1 /ca 1 >> >> >> /Length ${Buffer.byteLength(ops)} >>`;
  return Buffer.from(`${dict}\nstream\n${ops}\nendstream`, 'latin1');
}

/** Dictionary text and appearance stream of an annotation; `page` is the page object, `ap` the object number of the appearance. */
export function annotObjects(a: AnnotSpec, page: Ref, ap: number, now: string): { dict: string; ap: Buffer } {
  const box = union(a.rects);
  const q = quadsOf(a.rects).map(f2);
  const quads = Array.from({ length: a.rects.length }, (_, i) => q.slice(i * 8, i * 8 + 8).join(' ')).join(' ');
  const dict =
    `<< /Type /Annot /Subtype /${a.subtype} /Rect [${box.map(f2).join(' ')}] /QuadPoints [${quads}] /C [${a.color.map((n) => f2(r2(n))).join(' ')}] /CA 1 /F 4 /P ${page.n} ${page.g} R` +
    ` /NM ${pdfText(a.nm)}${a.author ? ' /T ' + pdfText(a.author) : ''}${a.contents ? ' /Contents ' + pdfText(cutContents(a.contents)) : ''}` +
    ` /CreationDate (${pdfDate(a.created)}) /M (${pdfDate(now)}) /AP << /N ${ap} 0 R >> >>`;
  return { dict, ap: appearance(a, box) };
}

const textOf = (v: Val | undefined): string => {
  if (!(v instanceof Str)) return '';
  const b = v.b;
  return b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString('utf16le') : b.toString('latin1');
};

/** An annotation object of the PDF read back: our fields only. `null` when it is not a dictionary. */
export interface Found { ref: Ref; nm: string | undefined; subtype: string | undefined; sem: Sem; rects: Rect[] }
export function readAnnot(doc: Doc, ref: Ref): Found | null {
  const d = dictOf(doc, ref);
  if (!d) return null;
  const arr = (v: Val | undefined): number[] => (Array.isArray(v) ? v.map((x) => asNum(x) ?? NaN).filter((x) => Number.isFinite(x)) : []);
  const quads = arr(d.get('QuadPoints'));
  const rects: Rect[] = [];
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const xs = [quads[i]!, quads[i + 2]!, quads[i + 4]!, quads[i + 6]!], ys = [quads[i + 1]!, quads[i + 3]!, quads[i + 5]!, quads[i + 7]!];
    rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  const subtype = d.get('Subtype') instanceof Name ? nameOf(d.get('Subtype')) : undefined;
  const nmv = d.get('NM');
  return { ref, nm: nmv instanceof Str ? textOf(nmv) : undefined, subtype, rects, sem: { s: subtype ?? '', q: quads.map(r2), c: arr(d.get('C')).map(r2), t: textOf(d.get('Contents')), a: textOf(d.get('T')) } };
}

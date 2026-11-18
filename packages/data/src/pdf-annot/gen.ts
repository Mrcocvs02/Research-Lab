// Synthetic PDFs for the tests of the annotation writer (no real files): classic table, xref stream (with object streams and the PNG
// predictor), hybrid `/XRefStm`, nested page trees, rotated / shifted-CropBox / UserUnit pages, and the files the writer refuses.
// Written by hand (not pdf-lib) so that the structure of every case is exactly the one the test names.
import { deflateSync } from 'node:zlib';
import { PAGE_WITH_ANNOTS } from './test-pdfs.js';

export type XKind = 'table' | 'stream' | 'hybrid';
export interface GenObj { n: number; body: string | Buffer }
export interface GenOpts {
  kind?: XKind;
  /** Object numbers stored in one object stream (dictionaries and arrays only; ignored for `table`). */
  compress?: number[];
  /** Extra trailer entries, e.g. `/Encrypt 9 0 R /ID [<aa> <bb>]`. */
  trailer?: string;
  /** Bytes after the final `%%EOF`. */
  junk?: string;
  /** PNG "Up" predictor on the xref stream. */
  predictor?: boolean;
  /** Encrypted files: seals the data of the object stream (number, deflated data). */
  sealStm?: (n: number, data: Buffer) => Buffer;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Assembles a file from its objects (object 1 is the catalog). The xref section is of the requested kind. */
export function assemble(objs: GenObj[], o: GenOpts = {}): Buffer {
  const kind = o.kind ?? 'table';
  const inStm = new Set(kind === 'table' ? [] : (o.compress ?? []));
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = parts[0]!.length;
  const offs = new Map<number, number>();
  const put = (n: number, body: string | Buffer) => {
    offs.set(n, pos);
    const b = Buffer.concat([Buffer.from(`${n} 0 obj\n`), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n')]);
    parts.push(b);
    pos += b.length;
  };
  for (const x of objs) if (!inStm.has(x.n)) put(x.n, x.body);
  let size = Math.max(...objs.map((x) => x.n)) + 1;
  const idx = new Map<number, number>();
  let stmNum = 0;
  if (inStm.size > 0) {
    stmNum = size++;
    let head = '', data = '', i = 0;
    for (const x of objs) {
      if (!inStm.has(x.n)) continue;
      head += `${x.n} ${data.length} `;
      data += `${x.body as string}\n`;
      idx.set(x.n, i++);
    }
    const deflated = deflateSync(Buffer.from(head + data, 'latin1'));
    const z = o.sealStm ? o.sealStm(stmNum, deflated) : deflated;
    put(stmNum, Buffer.concat([Buffer.from(`<< /Type /ObjStm /N ${i} /First ${head.length} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, Buffer.from('\nendstream')]));
  }
  const extra = o.trailer ? ` ${o.trailer}` : '';
  const row = (t: number, a: number, b: number) => Buffer.from([t, (a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (b >> 8) & 255, b & 255]);
  const xstream = (num: number, rows: Buffer[], index: number[], dictExtra: string): Buffer => {
    let data = Buffer.concat(rows);
    let parms = '';
    if (o.predictor) {
      const out: Buffer[] = [];
      for (let r = 0; r < rows.length; r++) {
        const cur = rows[r]!, prev = r ? rows[r - 1]! : Buffer.alloc(7);
        out.push(Buffer.concat([Buffer.from([2]), Buffer.from(cur.map((v, i) => (v - prev[i]! + 256) & 255))]));
      }
      data = Buffer.concat(out);
      parms = ' /DecodeParms << /Predictor 12 /Columns 7 >>';
    }
    const z = deflateSync(data);
    const d = `<< /Type /XRef /W [1 4 2] /Index [${index.join(' ')}] ${dictExtra} /Filter /FlateDecode${parms} /Length ${z.length} >>`;
    return Buffer.concat([Buffer.from(`${num} 0 obj\n${d}\nstream\n`), z, Buffer.from('\nendstream\nendobj\n')]);
  };

  if (kind === 'table' || kind === 'hybrid') {
    let xs = 0;
    if (kind === 'hybrid') {
      // The XRefStm lists the compressed objects; the table calls them free.
      xs = pos;
      const nums = [...idx.keys()];
      const b = xstream(size, nums.map((n) => row(2, stmNum, idx.get(n)!)), nums.flatMap((n) => [n, 1]), `/Size ${size + 1} /Root 1 0 R`);
      parts.push(b);
      pos += b.length;
      offs.set(size, xs);
      size++;
    }
    const xr = pos;
    let s = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let n = 1; n < size; n++) s += offs.has(n) ? `${pad(offs.get(n)!, 10)} 00000 n \n` : '0000000000 00000 f \n';
    s += `trailer\n<< /Size ${size} /Root 1 0 R${kind === 'hybrid' ? ` /XRefStm ${xs}` : ''}${extra} >>\nstartxref\n${xr}\n%%EOF\n${o.junk ?? ''}`;
    parts.push(Buffer.from(s, 'latin1'));
    return Buffer.concat(parts);
  }
  const xnum = size;
  const rows: Buffer[] = [row(0, 0, 65535)];
  for (let n = 1; n <= xnum; n++) rows.push(n === xnum ? row(1, pos, 0) : offs.has(n) ? row(1, offs.get(n)!, 0) : idx.has(n) ? row(2, stmNum, idx.get(n)!) : row(0, 0, 0));
  const xr = pos;
  parts.push(xstream(xnum, rows, [0, xnum + 1], `/Size ${xnum + 1} /Root 1 0 R${extra}`));
  parts.push(Buffer.from(`startxref\n${xr}\n%%EOF\n${o.junk ?? ''}`, 'latin1'));
  return Buffer.concat(parts);
}

export interface PageSpec { mediaBox?: string; cropBox?: string; rotate?: number; userUnit?: number; annots?: string }
export interface DocSpec extends GenOpts {
  pages?: Array<PageSpec> | number;
  /** `nested`: the pages sit under an intermediate node and inherit `/MediaBox` and `/Rotate` from the root. */
  tree?: 'flat' | 'nested';
  catalogExtra?: string;
  /** More objects (a signature field, an /Encrypt dictionary...), numbered from 20. */
  extraObjs?: GenObj[];
}

/** A document of `pages` pages. Objects: 1 catalog, 2 page-tree root, pages `3..2+N`, contents after them (page `i` is object `3+i`). */
export function docPdf(spec: DocSpec = {}): Buffer {
  const pages: PageSpec[] = typeof spec.pages === 'number' ? Array.from({ length: spec.pages }, () => ({})) : (spec.pages ?? [{}]);
  const N = pages.length;
  const nested = spec.tree === 'nested';
  const mid = 3 + 2 * N;
  const parent = nested ? mid : 2;
  const objs: GenObj[] = [{ n: 1, body: `<< /Type /Catalog /Pages 2 0 R${spec.catalogExtra ? ' ' + spec.catalogExtra : ''} >>` }];
  const kids = pages.map((_, i) => `${3 + i} 0 R`).join(' ');
  objs.push(nested ? { n: 2, body: `<< /Type /Pages /Kids [${mid} 0 R] /Count ${N} /MediaBox [0 0 300 400] /Rotate 90 >>` } : { n: 2, body: `<< /Type /Pages /Kids [${kids}] /Count ${N} >>` });
  pages.forEach((p, i) => {
    const bits = [`/Type /Page /Parent ${parent} 0 R /Contents ${3 + N + i} 0 R`];
    if (!nested) bits.push(`/MediaBox ${p.mediaBox ?? '[0 0 200 200]'}`);
    else if (p.mediaBox) bits.push(`/MediaBox ${p.mediaBox}`);
    if (p.cropBox) bits.push(`/CropBox ${p.cropBox}`);
    if (p.rotate !== undefined) bits.push(`/Rotate ${p.rotate}`);
    if (p.userUnit !== undefined) bits.push(`/UserUnit ${p.userUnit}`);
    if (p.annots) bits.push(`/Annots ${p.annots}`);
    objs.push({ n: 3 + i, body: `<< ${bits.join(' ')} >>` });
  });
  pages.forEach((_, i) => {
    const text = `BT /F1 12 Tf 20 100 Td (Page ${i + 1}) Tj ET`;
    objs.push({ n: 3 + N + i, body: Buffer.from(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`, 'latin1') });
  });
  objs.push(...(spec.extraObjs ?? []));
  if (nested) objs.push({ n: mid, body: `<< /Type /Pages /Parent 2 0 R /Kids [${kids}] /Count ${N} >>` });
  // Dictionaries and arrays may live in an object stream; the contents streams may not.
  const compress = spec.compress ?? (spec.kind && spec.kind !== 'table' ? [1, 2, ...pages.map((_, i) => 3 + i), ...(nested ? [mid] : [])] : []);
  return assemble(objs, { ...spec, compress });
}

/** The first page with an existing inline `/Annots` array holding a foreign annotation (object `extra`), for "other programs' annotations stay". */
export const FOREIGN = (n: number): string => `<< /Type /Annot /Subtype /Text /Rect [5 5 20 20] /Contents (other program) /NM (other-${n}) /T (someone) >>`;
export { PAGE_WITH_ANNOTS };

/** Deterministic pseudo-random numbers (mulberry32), for the mutation tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

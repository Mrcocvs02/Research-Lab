// Synthetic PDFs for tests (no real files): a one-page base file and incremental revisions "written by another program".
import { deflateSync } from 'node:zlib';

const OBJ_BASE = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>'];

/** A valid classic-table PDF with one page (objects 1-4, `/Size` 5). `text` is the page's content. */
export function basePdf(text = 'BT /F1 12 Tf 20 100 Td (Hello) Tj ET'): Buffer {
  const objs = [...OBJ_BASE, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((b, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xr = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Appends one revision with the given objects (`[number, body]`), as an incremental update with a classic xref section. */
export function appendRevision(prev: Buffer, objs: Array<[number, string]>, o: { size?: number; info?: number } = {}): Buffer {
  const text = prev.toString('latin1');
  const last = Number([...text.matchAll(/startxref\s+(\d+)/g)].pop()![1]);
  let out = '';
  const offs: Array<[number, number]> = [];
  for (const [n, body] of objs) {
    offs.push([n, prev.length + out.length]);
    out += `${n} 0 obj\n${body}\nendobj\n`;
  }
  const xr = prev.length + out.length;
  const oldSize = Number(/\/Size (\d+)/.exec(text.slice(text.lastIndexOf('trailer')))?.[1] ?? 5);
  const size = o.size ?? Math.max(oldSize, ...objs.map(([n]) => n + 1));
  out += `xref\n${offs.map(([n, off]) => `${n} 1\n${String(off).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${size} /Root 1 0 R /Prev ${last}${o.info ? ` /Info ${o.info} 0 R` : ''} >>\nstartxref\n${xr}\n%%EOF\n`;
  return Buffer.concat([prev, Buffer.from(out, 'latin1')]);
}

export const stream = (dict: string, data: string | Buffer): string => {
  const b = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  return `<< ${dict} /Length ${b.length} >>\nstream\n${b.toString('latin1')}\nendstream`;
};

export const PAGE_WITH_ANNOTS = (annots: string): string => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots ${annots} >>`;
export const HIGHLIGHT = (nm: string, extra = ''): string => `<< /Type /Annot /Subtype /Highlight /Rect [10 10 80 30] /QuadPoints [10 30 80 30 10 10 80 10] /C [1 1 0] /NM (${nm}) /Contents (note \\(1\\)) ${extra} >>`;

/** An object stream holding `inner` objects (`[number, body]`), Flate compressed. */
export function objStm(inner: Array<[number, string]>): string {
  let head = '';
  let body = '';
  for (const [n, b] of inner) {
    head += `${n} ${body.length} `;
    body += `${b}\n`;
  }
  return stream(`/Type /ObjStm /N ${inner.length} /First ${head.length} /Filter /FlateDecode`, deflateSync(Buffer.from(head + body, 'latin1')));
}

/** An annotation revision as Acrobat writes it: annotation + popup + appearance form, page with /Annots, /Info and /Metadata. */
export function acrobatStyle(prev: Buffer): Buffer {
  return appendRevision(
    prev,
    [
      [3, PAGE_WITH_ANNOTS('[5 0 R 6 0 R]')],
      [5, HIGHLIGHT('acro-1', '/AP << /N 7 0 R >> /Popup 6 0 R')],
      [6, '<< /Type /Annot /Subtype /Popup /Rect [90 10 190 60] /Parent 5 0 R >>'],
      [7, stream('/Type /XObject /Subtype /Form /BBox [0 0 70 20]', '1 1 0 rg 0 0 70 20 re f')],
      [8, '<< /Producer (Other Program) /ModDate (D:20260101000000) >>'],
      [9, stream('/Type /Metadata /Subtype /XML', '<x:xmpmeta/>')],
    ],
    { info: 8 },
  );
}

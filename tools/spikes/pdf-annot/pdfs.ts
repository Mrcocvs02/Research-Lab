// Synthetic PDF generators for the spike tests (pdf-lib for structure-rich files, text for hostile ones).
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from 'pdf-lib';

export interface LibOpts { pages?: number; objectStreams?: boolean; rotate?: number; crop?: [number, number, number, number]; userUnit?: number; pad?: number }

/** A text page with pdf-lib: classic table (objectStreams false) or xref stream + object streams (true). */
export async function libPdf(o: LibOpts = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (o.pages ?? 1); i++) {
    const p = doc.addPage([300, 400]);
    p.drawText(`Synthetic page ${i + 1}`, { x: 30, y: 350, size: 14, font });
    if (o.rotate) p.setRotation(degrees(o.rotate));
    if (o.crop) p.setCropBox(...o.crop);
    if (o.userUnit) p.node.set(PDFName.of('UserUnit'), PDFNumber.of(o.userUnit));
  }
  if (o.pad) {
    // An uncompressed filler stream to reach a size (timing tests); it is never referenced by a page.
    const s = doc.context.stream(Buffer.alloc(o.pad, 0x20), {});
    doc.context.register(s);
  }
  const bytes = await doc.save({ useObjectStreams: o.objectStreams ?? false });
  return Buffer.from(bytes);
}

const pad10 = (n: number) => String(n).padStart(10, '0');
export interface HandOpts { trailerExtra?: string; catalogExtra?: string; pageExtra?: string; id?: boolean; eofTail?: string; omitFinal?: boolean }

const PAGE = (extra = '') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R ${extra} >>`;
const CONTENT = '<< /Length 40 >>\nstream\nBT /F1 12 Tf 30 350 Td (Hand written) Tj ET\nendstream';

/** Classic-table PDF written by hand: objects 1 catalog, 2 pages, 3 page, 4 content. */
export function handClassic(o: HandOpts = {}): Buffer {
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R ${o.catalogExtra ?? ''} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    PAGE(o.pageExtra),
    CONTENT,
  ];
  return assemble(objs, o);
}

function assemble(objs: string[], o: HandOpts, firstNum = 1): Buffer {
  let s = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((b, i) => { offs.push(s.length); s += `${firstNum + i} 0 obj\n${b}\nendobj\n`; });
  const xr = s.length;
  s += `xref\n0 ${objs.length + firstNum}\n0000000000 65535 f \n`;
  for (let i = 1; i < firstNum; i++) s += '0000000000 00000 f \n';
  s += offs.map((x) => `${pad10(x)} 00000 n \n`).join('');
  const id = o.id === false ? '' : '/ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]';
  s += `trailer\n<< /Size ${objs.length + firstNum} /Root 1 0 R ${id} ${o.trailerExtra ?? ''} >>\nstartxref\n${xr}\n%%EOF\n`;
  return Buffer.from(s + (o.eofTail ?? ''), 'latin1');
}

export const handEncrypt = (encryptDict: string, id = true): Buffer => handClassic({ trailerExtra: `/Encrypt ${encryptDict}`, id });
export const handSigned = (valued: boolean): Buffer =>
  withExtraObject(`<< /FT /Sig /T (Signature1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] ${valued ? '/V << /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 1 2 3] /Contents <00> >>' : ''} >>`, '/AcroForm << /SigFlags 3 /Fields [5 0 R] >>');
export const handXfa = (): Buffer => handClassic({ catalogExtra: '/AcroForm << /XFA [(template) 4 0 R] /Fields [] >>' });

function withExtraObject(obj5: string, catalogExtra: string): Buffer {
  const objs = ['<< /Type /Catalog /Pages 2 0 R ' + catalogExtra + ' >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', PAGE(), CONTENT, obj5];
  return assemble(objs, {});
}

/** Hybrid file: page object 3 lives in an object stream listed only in the /XRefStm; the table marks it free. */
export function handHybrid(): Buffer {
  let s = '%PDF-1.7\n';
  const at: Record<number, number> = {};
  const add = (n: number, body: string) => { at[n] = s.length; s += `${n} 0 obj\n${body}\nendobj\n`; };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(4, CONTENT);
  const inner = PAGE();
  const head = '3 0 ';
  add(5, `<< /Type /ObjStm /N 1 /First ${head.length} /Length ${head.length + inner.length} >>\nstream\n${head}${inner}\nendstream`);
  // xref stream (object 6): W [1 2 1], entries for 3 (type 2: stream 5, index 0) and 5 (type 1) and 6 itself.
  const row = (t: number, a: number, b: number) => Buffer.from([t, a >> 8, a & 255, b]);
  const xs = s.length;
  const rows = Buffer.concat([row(2, 5, 0), row(1, at[5]!, 0), row(1, xs, 0)]);
  s += `6 0 obj\n<< /Type /XRef /Size 7 /W [1 2 1] /Index [3 1 5 2] /Root 1 0 R /Length ${rows.length} >>\nstream\n`;
  const pre = Buffer.from(s, 'latin1');
  const post = Buffer.from('\nendstream\nendobj\n', 'latin1');
  let body = Buffer.concat([pre, rows, post]);
  const xr = body.length;
  const tbl = `xref\n0 5\n0000000000 65535 f \n${pad10(at[1]!)} 00000 n \n${pad10(at[2]!)} 00000 n \n0000000000 00000 f \n${pad10(at[4]!)} 00000 n \n`;
  body = Buffer.concat([body, Buffer.from(`${tbl}trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${xs} /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n${xr}\n%%EOF\n`, 'latin1')]);
  return body;
}

/** Minimal linearized layout: first-page xref near the start (with /Prev), main xref at the end, final startxref pointing to the first one. */
export function handLinearized(): Buffer {
  const objText = (n: number, b: string) => `${n} 0 obj\n${b}\nendobj\n`;
  const header = '%PDF-1.7\n';
  const lin = (len: number) => objText(1, `<< /Linearized 1 /L ${pad10(len)} /H [0 0] /O 4 /E 0 /N 1 /T 0 >>`);
  const catalog = objText(2, '<< /Type /Catalog /Pages 3 0 R >>');
  const pages = objText(3, '<< /Type /Pages /Kids [4 0 R] /Count 1 >>');
  const page = objText(4, PAGE());
  const firstXrefLen = (`xref\n1 4\n` + '0000000000 00000 n \n'.repeat(4) + `trailer\n<< /Size 6 /Root 2 0 R /Prev 0000000000 >>\nstartxref\n0\n%%EOF\n`).length;
  const linText = lin(0);
  let pos = header.length + linText.length;
  const xr1 = pos;
  pos += firstXrefLen;
  const o2 = pos; pos += catalog.length;
  const o3 = pos; pos += pages.length;
  const o4 = pos; pos += page.length;
  const o5 = pos; const content = objText(5, CONTENT); pos += content.length;
  const xr2 = pos;
  const first = `xref\n1 4\n${pad10(header.length)} 00000 n \n${pad10(o2)} 00000 n \n${pad10(o3)} 00000 n \n${pad10(o4)} 00000 n \ntrailer\n<< /Size 6 /Root 2 0 R /Prev ${pad10(xr2)} >>\nstartxref\n0\n%%EOF\n`;
  const main = `xref\n0 1\n0000000000 65535 f \n5 1\n${pad10(o5)} 00000 n \ntrailer\n<< /Size 6 >>\nstartxref\n${xr1}\n%%EOF\n`;
  const total = xr2 + main.length;
  return Buffer.from(header + lin(total).padEnd(linText.length, ' ') + first + catalog + pages + page + content + main, 'latin1');
}

// Standard security handler (R3, RC4-128) values for the empty user password, written from the spec for the tests.
const PADB = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...b: Buffer[]) => b.reduce((h, x) => h.update(x), createHash('md5')).digest();
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = [...Array(256).keys()];
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; const t = s[i]!; s[i] = s[j]!; s[j] = t; }
  let i = 0; j = 0;
  return Buffer.from(data.map((c) => { i = (i + 1) & 255; j = (j + s[i]!) & 255; const t = s[i]!; s[i] = s[j]!; s[j] = t; return c ^ s[(s[i]! + s[j]!) & 255]!; }));
}
export function encryptDictR3(P: number, userPassword = ''): string {
  const id0 = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const O = Buffer.alloc(32, 7);
  const pb = Buffer.alloc(4);
  pb.writeInt32LE(P);
  // U is computed for the EMPTY password; a non-empty user password is simulated by corrupting it.
  let k = md5(PADB, O, pb, id0);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16));
  const key = k.subarray(0, 16);
  let x = rc4(key, md5(PADB, id0));
  for (let i = 1; i < 20; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  const U = Buffer.concat([x, Buffer.alloc(16)]);
  if (userPassword) U[0] = U[0]! ^ 0xff;
  return `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${O.toString('hex')}> /U <${U.toString('hex')}> >>`;
}

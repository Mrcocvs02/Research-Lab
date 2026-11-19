import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDir, tempDir } from '../test-utils.js';
import { docPdf, type DocSpec } from './gen.js';
import { planSync, type PlanAnnot, type SyncResult } from './plan.js';
import { appendRevision } from './test-pdfs.js';

let dir: string;
let n = 0;
beforeAll(async () => {
  dir = await tempDir('rl-refuse-');
});
afterAll(() => removeDir(dir));

const annot: PlanAnnot = { id: 'a1', kind: 'highlight', page: 1, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.05 }], color: 'yellow', createdAt: '2026-02-01T00:00:00.000Z' };
async function plan(buf: Buffer): Promise<SyncResult> {
  const p = path.join(dir, `r${++n}.pdf`);
  await writeFile(p, buf);
  return planSync({ path: p, mode: 'sync', annotations: [annot], otherIds: [], known: {}, now: annot.createdAt });
}
const refusal = (r: SyncResult) => (r.ok ? 'ok' : r.reason);

// A standard security handler dictionary the empty user password opens (R2, RC4 40 bit), built the way the specification says.
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...b: Buffer[]) => createHash('md5').update(Buffer.concat(b)).digest();
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}
const ID0 = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const idEntry = `/ID [<${ID0.toString('hex')}> <${ID0.toString('hex')}>]`;
function encryptedR2(P: number, wrongPassword = false): DocSpec {
  const O = Buffer.alloc(32, 7);
  const pb = Buffer.alloc(4);
  pb.writeInt32LE(P);
  const key = md5(PAD, O, pb, ID0).subarray(0, 5);
  const U = wrongPassword ? Buffer.alloc(32, 1) : rc4(key, PAD);
  return { trailer: `/Encrypt 20 0 R ${idEntry}`, extraObjs: [{ n: 20, body: `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>` }] };
}
/** /Perms as the specification says: P, 0xffffffff, T, "adb", filler, encrypted with AES-256-ECB under the file key. */
const permsOf = (key: Buffer, P: number, bad = false): Buffer => {
  const b = Buffer.alloc(16, 5);
  b.writeInt32LE(bad ? P ^ 8 : P, 0);
  b.fill(255, 4, 8);
  b.write('Tadb', 8, 'latin1');
  return createCipheriv('aes-256-ecb', key, null).setAutoPadding(false).update(b);
};
function encryptedR5(P: number, perms: 'ok' | 'bad' | 'none' = 'ok'): DocSpec {
  const vsalt = Buffer.alloc(8, 3), ksalt = Buffer.alloc(8, 4);
  const key = createDecipheriv('aes-256-cbc', createHash('sha256').update(ksalt).digest(), Buffer.alloc(16)).setAutoPadding(false).update(Buffer.alloc(32));
  const U = Buffer.concat([createHash('sha256').update(vsalt).digest(), vsalt, ksalt]);
  return { trailer: `/Encrypt 20 0 R ${idEntry}`, extraObjs: [{ n: 20, body: `<< /Filter /Standard /V 5 /R 5 /O <${'00'.repeat(48)}> /U <${U.toString('hex')}> /OE <${'00'.repeat(32)}> /UE <${'00'.repeat(32)}> /P ${P}${perms === 'none' ? '' : ` /Perms <${permsOf(key, P, perms === 'bad').toString('hex')}>`} >>` }] };
}

describe('refusals, one per reason of §8.3.5 (nothing is written to a refused file)', () => {
  it('encrypted: a password that is not empty, an unknown handler', async () => {
    expect(await plan(docPdf(encryptedR2(-4, true)))).toMatchObject({ ok: false, reason: 'encrypted', detail: 'password', emptyPassword: false });
    expect(await plan(docPdf({ trailer: `/Encrypt 20 0 R ${idEntry}`, extraObjs: [{ n: 20, body: '<< /Filter /Custom /V 4 >>' }] }))).toMatchObject({ ok: false, reason: 'encrypted', detail: 'handler' });
  });

  it('encrypted with an empty user password is written (G4c; the round trips are in crypt.test.ts)', async () => {
    expect(refusal(await plan(docPdf(encryptedR2(-4))))).toBe('ok');
    expect(refusal(await plan(docPdf(encryptedR5(-4))))).toBe('ok');
  });

  it('/P without the annotation bit (bit 6): permission, even with an empty password', async () => {
    expect(await plan(docPdf(encryptedR2(-36)))).toMatchObject({ ok: false, reason: 'permission', emptyPassword: true });
    expect(await plan(docPdf(encryptedR5(-36)))).toMatchObject({ ok: false, reason: 'permission' });
  });

  it('signed: a signature with a value, or /Perms with DocMDP', async () => {
    const signed: DocSpec = { catalogExtra: '/AcroForm << /Fields [20 0 R] /SigFlags 3 >>', extraObjs: [{ n: 20, body: '<< /FT /Sig /T (s1) /V 21 0 R >>' }, { n: 21, body: '<< /Type /Sig /Filter /Adobe.PPKLite >>' }] };
    expect(refusal(await plan(docPdf(signed)))).toBe('signed');
    expect(refusal(await plan(docPdf({ catalogExtra: '/Perms << /DocMDP 21 0 R >>', extraObjs: [{ n: 21, body: '<< /Type /Sig >>' }] })))).toBe('signed');
  });

  it('xfa', async () => {
    expect(refusal(await plan(docPdf({ catalogExtra: '/AcroForm << /XFA [(template) 21 0 R] >>', extraObjs: [{ n: 21, body: '<< /Length 0 >>' }] })))).toBe('xfa');
  });

  it('damaged: truncated, no startxref, a broken cross-reference, no pages, a page count the tree does not bear out', async () => {
    const whole = docPdf({ pages: 2 });
    expect(refusal(await plan(whole.subarray(0, Math.floor(whole.length / 2))))).toBe('damaged');
    expect(refusal(await plan(whole.subarray(0, whole.length - 40)))).toBe('damaged');
    expect(refusal(await plan(Buffer.from('%PDF-1.7\nnot really a pdf\n')))).toBe('damaged');
    expect(refusal(await plan(Buffer.from(whole.toString('latin1').replace('/Count 2', '/Count 5'), 'latin1')))).toBe('damaged');
    expect(refusal(await plan(Buffer.from(whole.toString('latin1').replace('/Kids [3 0 R 4 0 R] /Count 2', '/Kids [] /Count 0'), 'latin1')))).toBe('damaged');
    expect(refusal(await plan(Buffer.from(whole.toString('latin1').replace(/startxref\s+\d+/, 'startxref\n7'), 'latin1')))).toBe('damaged');
  });

  it('a /Prev that loops is damaged', async () => {
    const base = docPdf();
    const x = Number(/startxref\s+(\d+)/.exec(base.toString('latin1'))![1]);
    expect(refusal(await plan(Buffer.from(base.toString('latin1').replace('/Root 1 0 R', `/Root 1 0 R /Prev ${x}`), 'latin1')))).toBe('damaged');
  });

  it('too many revisions of the file (more than 200)', async () => {
    let b = docPdf();
    for (let i = 0; i < 201; i++) b = appendRevision(b, [[9, `<< /N ${i} >>`]]);
    expect(refusal(await plan(b))).toBe('too-many-revisions');
  });
});

describe('accepted: what must not be refused (D-351)', () => {
  it('data after %%EOF', async () => {
    expect(refusal(await plan(docPdf({ junk: 'some trailing text from a scanner\n' })))).toBe('ok');
  });

  it('empty signature fields with /SigFlags', async () => {
    const empty: DocSpec = { catalogExtra: '/AcroForm << /Fields [20 0 R] /SigFlags 3 >>', extraObjs: [{ n: 20, body: '<< /FT /Sig /T (s1) >>' }] };
    expect(refusal(await plan(docPdf(empty)))).toBe('ok');
  });

  it('a hybrid file, an xref stream, a nested page tree, a classic table', async () => {
    for (const spec of [{ kind: 'hybrid' }, { kind: 'stream', predictor: true }, { tree: 'nested', pages: 2 }, {}] as DocSpec[]) expect(refusal(await plan(docPdf(spec)))).toBe('ok');
  });

  it('an /AcroForm without signatures and without XFA', async () => {
    expect(refusal(await plan(docPdf({ catalogExtra: '/AcroForm << /Fields [] >>' })))).toBe('ok');
  });
});

describe('fail-safe signature check and /Perms (I4, M4)', () => {
  const sigPdf = (fields: number, extra: Array<{ n: number; body: string }>): DocSpec => ({ catalogExtra: `/AcroForm << /Fields [${Array.from({ length: fields }, (_, i) => `${100 + i} 0 R`).join(' ')}] >>`, extraObjs: extra });

  it('more than 5000 form fields cannot be judged: refused as signed, not written', async () => {
    const many = Array.from({ length: 5100 }, (_, i) => ({ n: 100 + i, body: '<< /FT /Tx /T (x) >>' }));
    expect(refusal(await plan(docPdf(sigPdf(5100, many))))).toBe('signed');
  });

  it('fields nested deeper than 32 levels cannot be judged: refused as signed', async () => {
    const deep = Array.from({ length: 40 }, (_, i) => ({ n: 100 + i, body: i < 39 ? `<< /FT /Tx /Kids [${101 + i} 0 R] >>` : '<< /FT /Tx >>' }));
    expect(refusal(await plan(docPdf(sigPdf(1, deep))))).toBe('signed');
  });

  it('a few ordinary fields are still annotated', async () => {
    expect(refusal(await plan(docPdf(sigPdf(2, [{ n: 100, body: '<< /FT /Tx /T (a) >>' }, { n: 101, body: '<< /FT /Tx /T (b) >>' }]))))).toBe('ok');
  });

  it('R5: a valid /Perms or none is accepted, a /Perms that disagrees with /P is damaged', async () => {
    expect(refusal(await plan(docPdf(encryptedR5(-4, 'ok'))))).toBe('ok');
    expect(refusal(await plan(docPdf(encryptedR5(-4, 'none'))))).toBe('ok');
    expect(await plan(docPdf(encryptedR5(-4, 'bad')))).toMatchObject({ ok: false, reason: 'damaged', detail: 'perms' });
  });
});

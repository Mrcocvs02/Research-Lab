// Encrypted files the empty user password opens (G4c, ARCHITETTURA-UI §8.3.13): RC4 40 and 128 bit, AES-128, AES-256 (revisions 5 and 6),
// table and xref-stream layouts. The fixtures are built here from the specification (not by the code under test, apart from RC4 and the
// revision 6 hash, which have no other implementation in Node): every string and stream of the original objects is sealed with the key of
// its object, as a real producer does. Never run against real files.
import { createCipheriv, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDir, tempDir } from '../test-utils.js';
import { Ref, asDict, nameOf } from './objects.js';
import { bufSyncSource, dictOf, getPage, loadDoc, resolve, resolveObj, streamData, type Doc } from './doc.js';
import { assemble, type GenObj } from './gen.js';
import { readAnnot } from './annot.js';
import { hash2B, rc4 } from './crypt.js';
import { inspectFile } from './inspect.js';
import { planSync, type PlanAnnot, type SyncResult } from './plan.js';
import { unlock } from './refuse.js';
import { verifyFile } from './verify.js';

let dir: string;
let n = 0;
beforeAll(async () => {
  dir = await tempDir('rl-crypt-');
});
afterAll(() => removeDir(dir));

const NOW = '2026-03-01T00:00:00.000Z';
const annot: PlanAnnot = { id: 'a1', kind: 'highlight', page: 1, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.05 }], color: 'yellow', comment: 'Fresh comment', createdAt: NOW };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const md5 = (...b: Buffer[]) => createHash('md5').update(Buffer.concat(b)).digest();

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const ID0 = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const FILL = (len: number, v: number) => Buffer.alloc(len, v);

type Kind = 'rc4-40' | 'rc4-128' | 'aes-128' | 'aes-256-r5' | 'aes-256-r6';
const KINDS: Kind[] = ['rc4-40', 'rc4-128', 'aes-128', 'aes-256-r5', 'aes-256-r6'];
interface Opts { P?: number; password?: string; layout?: 'table' | 'stream'; perms?: 'ok' | 'bad' | 'none' }

/** A one-page file with a foreign annotation, encrypted as the revision of `kind` says, opened by the user password `opts.password` ('' by default). */
function encrypted(kind: Kind, opts: Opts = {}): Buffer {
  const P = opts.P ?? -4, pw = Buffer.from(opts.password ?? '', 'latin1');
  const aes256 = kind.startsWith('aes-256');
  const R = kind === 'rc4-40' ? 2 : kind === 'rc4-128' ? 3 : kind === 'aes-128' ? 4 : kind === 'aes-256-r5' ? 5 : 6;
  const keyLen = kind === 'rc4-40' ? 5 : 16;
  let fileKey: Buffer;
  let encDict: string;
  const hex = (b: Buffer) => b.toString('hex');
  if (aes256) {
    fileKey = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255));
    const vsalt = FILL(8, 0x11), ksalt = FILL(8, 0x22);
    const h = (salt: Buffer) => (R === 5 ? createHash('sha256').update(pw).update(salt).digest() : hash2B(pw, salt));
    const c = createCipheriv('aes-256-cbc', h(ksalt), FILL(16, 0)).setAutoPadding(false);
    const UE = Buffer.concat([c.update(fileKey), c.final()]);
    const U = Buffer.concat([h(vsalt), vsalt, ksalt]);
    const pm = FILL(16, 3);
    pm.writeInt32LE(opts.perms === 'bad' ? P ^ 8 : P, 0);
    pm.fill(255, 4, 8);
    pm.write('Tadb', 8, 'latin1');
    const perms = createCipheriv('aes-256-ecb', fileKey, null).setAutoPadding(false).update(pm);
    encDict = `<< /Filter /Standard /V 5 /R ${R} /Length 256 /P ${P} /O <${hex(FILL(48, 1))}> /U <${hex(U)}> /OE <${hex(FILL(32, 2))}> /UE <${hex(UE)}>${opts.perms === 'none' ? '' : ` /Perms <${hex(perms)}>`} /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF >>`;
  } else {
    const O = FILL(32, 0x5a);
    const pb = Buffer.alloc(4);
    pb.writeInt32LE(P);
    let k = md5(Buffer.concat([pw, PAD]).subarray(0, 32), O, pb, ID0);
    if (R >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, keyLen));
    fileKey = k.subarray(0, keyLen);
    let U: Buffer;
    if (R === 2) U = rc4(fileKey, PAD);
    else {
      let x = rc4(fileKey, md5(PAD, ID0));
      for (let i = 1; i < 20; i++) x = rc4(Buffer.from(fileKey.map((b) => b ^ i)), x);
      U = Buffer.concat([x, FILL(16, 9)]);
    }
    const v = R === 2 ? '/V 1' : R === 3 ? '/V 2 /Length 128' : '/V 4 /Length 128 /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF';
    encDict = `<< /Filter /Standard ${v} /R ${R} /P ${P} /O <${hex(O)}> /U <${hex(U)}> >>`;
  }
  const key = fileKey;
  const seal = (num: number, b: Buffer): Buffer => {
    if (aes256) {
      const c = createCipheriv('aes-256-cbc', key, FILL(16, 7));
      return Buffer.concat([FILL(16, 7), c.update(b), c.final()]);
    }
    const ok = md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]), kind === 'aes-128' ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, Math.min(key.length + 5, 16));
    if (kind !== 'aes-128') return rc4(ok, b);
    const c = createCipheriv('aes-128-cbc', ok, FILL(16, 7));
    return Buffer.concat([FILL(16, 7), c.update(b), c.final()]);
  };
  const layout = opts.layout ?? 'table';
  // In an object stream the strings are plain (the stream as a whole is sealed); as indirect objects they are sealed one by one.
  const s = (num: number, text: string) => (layout === 'table' ? `<${seal(num, Buffer.from(text, 'latin1')).toString('hex')}>` : `(${text})`);
  const content = Buffer.from('BT /F1 12 Tf 20 100 Td (Page 1) Tj ET', 'latin1');
  const sealed = seal(4, content);
  const objs: GenObj[] = [
    { n: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { n: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { n: 3, body: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 200 200] /Annots [5 0 R] >>' },
    { n: 4, body: Buffer.concat([Buffer.from(`<< /Length ${sealed.length} >>\nstream\n`), sealed, Buffer.from('\nendstream')]) },
    { n: 5, body: `<< /Type /Annot /Subtype /Text /Rect [5 5 20 20] /Contents ${s(5, 'other program')} /NM ${s(5, 'other-1')} /T ${s(5, 'someone')} >>` },
    { n: 20, body: encDict },
  ];
  return assemble(objs, {
    kind: layout,
    compress: layout === 'stream' ? [1, 2, 3, 5] : [],
    trailer: `/Encrypt 20 0 R /ID [<${ID0.toString('hex')}> <${ID0.toString('hex')}>]`,
    sealStm: seal,
  });
}

async function put(buf: Buffer): Promise<string> {
  const p = path.join(dir, `c${++n}.pdf`);
  await writeFile(p, buf);
  return p;
}
async function plan(buf: Buffer, over: Partial<Parameters<typeof planSync>[0]> = {}): Promise<{ res: SyncResult; path: string }> {
  const p = await put(buf);
  return { res: await planSync({ path: p, mode: 'sync', annotations: [annot], otherIds: [], known: {}, now: NOW, ...over }), path: p };
}
/** The file after the update; the original is checked to be its exact prefix. */
async function write(buf: Buffer, over: Partial<Parameters<typeof planSync>[0]> = {}) {
  const { res } = await plan(buf, over);
  if (!res.ok || !res.update) throw new Error(`not written: ${res.ok ? 'nothing' : res.reason + ' ' + res.detail}`);
  expect(res.update.oldSize).toBe(buf.length);
  const out = Buffer.concat([buf, res.update.bytes]);
  expect(out.subarray(0, buf.length).equals(buf)).toBe(true);
  return { res, out, tail: res.update.bytes };
}
async function open(buf: Buffer): Promise<Doc> {
  const doc = loadDoc(bufSyncSource(buf));
  expect((await unlock(doc)).ok).toBe(true);
  return doc;
}
const annotsOf = (doc: Doc): Ref[] => (resolve(doc, getPage(doc, 0)!.dict.get('Annots')) as Ref[]) ?? [];

describe('primitives', () => {
  it('RC4 matches the published vector', () => {
    expect(rc4(Buffer.from('Key'), Buffer.from('Plaintext')).toString('hex')).toBe('bbf316e8d940af0ad3');
  });
});

describe.each(KINDS)('%s', (kind) => {
  for (const layout of ['table', 'stream'] as const) {
    describe(layout, () => {
      const base = () => encrypted(kind, { layout });

      it('the original objects read back decrypted (strings, streams, object streams)', async () => {
        const doc = await open(base());
        const f = readAnnot(doc, annotsOf(doc)[0]!)!;
        expect(f.nm).toBe('other-1');
        expect(f.sem.t).toBe('other program');
        expect(f.sem.a).toBe('someone');
        const ind = resolveObj(doc, 4)!;
        expect(streamData(doc, ind).toString('latin1')).toBe('BT /F1 12 Tf 20 100 Td (Page 1) Tj ET');
      });

      it('writes: the prefix is intact, new strings and streams are sealed, the trailer keeps /Encrypt, and everything reads back', async () => {
        const buf = base();
        const { res, out, tail } = await write(buf);
        expect(res.ok && res.marks).toHaveLength(1);
        // nothing of ours in the clear
        const text = tail.toString('latin1');
        expect(text).not.toContain('Fresh comment');
        expect(text).not.toContain('rl-a1');
        expect(text).not.toContain('/G0 gs');
        expect(text).not.toContain('(D:2026');
        expect(text).toContain('/Encrypt 20 0 R');
        // decrypt what we wrote
        const doc = await open(out);
        const refs = annotsOf(doc);
        expect(refs).toHaveLength(2);
        expect(readAnnot(doc, refs[0]!)!.nm).toBe('other-1'); // the foreign annotation is untouched and still readable
        const mine = readAnnot(doc, refs[1]!)!;
        expect(mine.nm).toBe('rl-a1');
        expect(mine.sem.t).toBe('Fresh comment');
        const d = dictOf(doc, refs[1])!;
        const ap = asDict(resolve(doc, d.get('AP')))!.get('N') as Ref;
        const apInd = resolveObj(doc, ap.n)!;
        expect(nameOf(asDict(apInd.val)!.get('Subtype'))).toBe('Form');
        expect(streamData(doc, apInd).toString('latin1')).toContain('/G0 gs');
        // and the verification of §8.3.3 step 6 accepts the file
        const p = await put(out);
        if (!res.ok) throw new Error('unreachable');
        await expect(verifyFile({ path: p, oldSize: buf.length, oldHash: sha(buf), expect: res.expect, pages: res.pages })).resolves.toMatchObject({ ok: true });
        await expect(inspectFile(p, buf.length)).resolves.toMatchObject({ ok: true, external: 1, externalAtBase: 1, pages: 1 });
      });

      it('a non-ASCII comment and an author name survive (UTF-16BE, sealed)', async () => {
        const { out } = await write(base(), { annotations: [{ ...annot, comment: 'Évidence — 研究' }], author: 'Zoë' });
        const doc = await open(out);
        const f = readAnnot(doc, annotsOf(doc)[1]!)!;
        expect(f.sem.t).toBe('Évidence — 研究');
        expect(f.sem.a).toBe('Zoë');
      });

      it('edits and removes it again in later updates (the same object, the same key)', async () => {
        const first = await write(base());
        if (!first.res.ok) throw new Error('unreachable');
        const mark = first.res.marks[0]!;
        const edited = await write(first.out, { annotations: [{ ...annot, comment: 'Edited', pdf: { objNum: mark.objNum, gen: mark.gen, rev: mark.rev } }], known: { a1: 1 } });
        const doc = await open(edited.out);
        expect(annotsOf(doc)).toHaveLength(2);
        expect(readAnnot(doc, annotsOf(doc)[1]!)!.sem.t).toBe('Edited');
        const gone = await write(edited.out, { mode: 'remove-all', annotations: [], known: { a1: 1 } });
        if (!gone.res.ok) throw new Error('unreachable');
        expect(gone.res.cleared).toEqual(['a1']);
        const doc2 = await open(gone.out);
        expect(annotsOf(doc2)).toHaveLength(1);
        expect(readAnnot(doc2, annotsOf(doc2)[0]!)!.nm).toBe('other-1');
      });

      it('the annotation bit of /P is respected, the other permissions are not needed', async () => {
        expect(await plan(encrypted(kind, { layout, P: -36 })).then((x) => x.res)).toMatchObject({ ok: false, reason: 'permission', emptyPassword: true });
        const noPrintNoModify = -4 & ~(4 | 8 | 16);
        expect(await plan(encrypted(kind, { layout, P: noPrintNoModify })).then((x) => x.res)).toMatchObject({ ok: true });
      });

      it('a user password that is not empty is refused, and nothing is written', async () => {
        const { res } = await plan(encrypted(kind, { layout, password: 'secret' }));
        expect(res).toMatchObject({ ok: false, reason: 'encrypted', detail: 'password', emptyPassword: false });
      });
    });
  }
});

describe('what stays refused or tolerated', () => {
  it('handlers and variants this does not handle are refused with the handler detail', async () => {
    const id = `/ID [<${ID0.toString('hex')}> <${ID0.toString('hex')}>]`;
    const withEnc = (body: string) => assemble([{ n: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' }, { n: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' }, { n: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 9 9] >>' }, { n: 20, body }], { trailer: `/Encrypt 20 0 R ${id}` });
    for (const body of [
      '<< /Filter /Custom /V 4 >>',
      `<< /Filter /Standard /V 3 /R 3 /P -4 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> >>`,
      `<< /Filter /Standard /V 4 /R 4 /P -4 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /CF << /C << /CFM /AESV3 >> >> /StmF /C /StrF /C >>`,
      `<< /Filter /Standard /V 5 /R 6 /P -4 /O <${'00'.repeat(48)}> /U <${'00'.repeat(48)}> /UE <${'00'.repeat(32)}> /CF << /C << /CFM /AESV2 >> >> /StmF /C /StrF /C >>`,
    ]) {
      const { res } = await plan(withEnc(body));
      expect(res).toMatchObject({ ok: false, reason: 'encrypted', detail: 'handler' });
    }
  });

  it('truncated or oddly padded AES data and a wrong-length key never throw while decrypting', async () => {
    const doc = await open(encrypted('aes-128'));
    for (const len of [0, 1, 15, 16, 17, 31, 32, 33, 100]) expect(() => doc.crypt!.str(Buffer.alloc(len, 5), 7, 0)).not.toThrow();
    const rc = await open(encrypted('rc4-128'));
    expect(rc.crypt!.encStr(Buffer.alloc(0), 7, 0)).toHaveLength(0);
  });
});

describe('/Perms of revisions 5 and 6 (M4)', () => {
  for (const kind of ['aes-256-r5', 'aes-256-r6'] as const) {
    it(`${kind}: a /Perms that agrees with /P, or none, opens; one that does not is refused as damaged`, async () => {
      expect((await plan(encrypted(kind))).res).toMatchObject({ ok: true });
      expect((await plan(encrypted(kind, { perms: 'none' }))).res).toMatchObject({ ok: true });
      expect((await plan(encrypted(kind, { perms: 'bad' }))).res).toMatchObject({ ok: false, reason: 'damaged', detail: 'perms' });
    });
  }
});

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, annotationFileSchema, annotationSchema, defaultLibraryConfig, type AnnotationFile, type DocumentRecord, type LibraryConfig } from '@rl/core';
import { appendRevision, bufSyncSource, docPdf, getPage, inspectFile, loadDoc, planSync, resolve, verifyFile } from '@rl/data/pdf-annot-testkit';
import type { MainServices } from '../ipc/handlers/services.js';
import { PdfSync } from './pdf-sync.js';

// Rename failures of the replacement are simulated here (a file another program holds open): only the temporary PDFs of a write.
const fail = vi.hoisted(() => ({ eperm: 0 }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return {
    ...real,
    default: real,
    rename: async (from: string, to: string) => {
      if (fail.eperm > 0 && /\.pdf\.rl-[0-9a-f]{8}\.tmp$/.test(from) && !from.includes('pdf-originals')) {
        fail.eperm--;
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return real.rename(from, to);
    },
  };
});

const DOC = '0123456789abcdef';
const LIB = 'lib-test';
const NOW = '2026-02-01T00:00:00.000Z';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface World {
  dir: string;
  root: string;
  local: string;
  data: string;
  file: string;
  original: Buffer;
  rec: Map<string, DocumentRecord>;
  anns: Map<string, AnnotationFile>;
  cfg: LibraryConfig;
  events: Array<[string, unknown]>;
  hooks: { beforeVerify?: () => Promise<void> };
  rt: unknown;
  s: MainServices;
}

const ann = (id: string, over: Record<string, unknown> = {}) =>
  annotationSchema.parse({ id, kind: 'highlight', page: 1, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.05 }], text: 'quoted', color: 'yellow', geom: 2, createdAt: NOW, updatedAt: NOW, ...over });

async function world(over: { pdf?: Buffer; confirmed?: boolean } = {}): Promise<World> {
  const dir = await mkdtemp();
  const root = path.join(dir, 'lib'), local = path.join(dir, 'local'), data = path.join(root, '.lab');
  await mkdir(data, { recursive: true });
  await mkdir(local, { recursive: true });
  const original = over.pdf ?? docPdf({ pages: 2 });
  const file = path.join(root, 'paper.pdf');
  await writeFile(file, original);
  const st = await stat(file);
  const w = { dir, root, local, data, file, original, rec: new Map<string, DocumentRecord>(), anns: new Map<string, AnnotationFile>(), events: [] as Array<[string, unknown]>, hooks: {} } as World;
  w.rec.set(DOC, { id: DOC, hash: sha(original), path: 'paper.pdf', size: st.size, mtimeMs: st.mtimeMs, missing: false, updatedAt: NOW, previousHashes: [], revision: 0 } as unknown as DocumentRecord);
  w.cfg = defaultLibraryConfig({ name: 'test' });
  w.cfg.annotations.writeToPdf = true;
  w.cfg.annotations.writeToPdfConfirmedAt = over.confirmed === false ? null : NOW;
  const store = {
    rootPath: root,
    dataDir: data,
    annotations: {
      get: async (id: string) => structuredClone(w.anns.get(id) ?? null),
      update: async (id: string, fn: (cur: AnnotationFile | null) => AnnotationFile) => {
        const next = fn(structuredClone(w.anns.get(id) ?? null));
        w.anns.set(id, next);
        return next;
      },
    },
    documents: {
      listIds: async () => [...w.rec.keys()],
      get: async (id: string) => structuredClone(w.rec.get(id) ?? null),
      update: async (id: string, fn: (cur: DocumentRecord | null) => DocumentRecord) => {
        const next = fn(structuredClone(w.rec.get(id) ?? null));
        w.rec.set(id, next);
        return next;
      },
    },
  };
  w.rt = {
    libraryId: LIB,
    store,
    getDocument: async (id: string) => structuredClone(w.rec.get(id)!),
    organizer: { syncUnderlined: async () => {} },
    pdf: {
      pdfSync: async (a: Parameters<typeof planSync>[0]) => planSync(a),
      pdfVerify: async (a: Parameters<typeof verifyFile>[0]) => {
        await w.hooks.beforeVerify?.();
        return verifyFile(a);
      },
      pdfInspect: async (a: { path: string; baseSize?: number; list?: boolean }) => inspectFile(a.path, a.baseSize, a.list),
    },
  };
  w.s = {
    localDataDir: local,
    log: { warn() {}, info() {}, error() {}, debug() {} },
    emit: (ch: string, p: unknown) => void w.events.push([ch, p]),
    settings: { get: async () => ({ user: { name: '' } }) },
    libraries: {
      getConfig: async () => w.cfg,
      profile: async () => ({ id: LIB, rootPath: root }),
      updateConfig: async (fn: (c: LibraryConfig) => LibraryConfig) => (w.cfg = fn(w.cfg)),
    },
    runtime: { require: async () => w.rt },
  } as unknown as MainServices;
  return w;
}
const mkdtemp = () => import('node:fs/promises').then((m) => m.mkdtemp(path.join(os.tmpdir(), 'rl-sync-')));
const bytes = (w: World) => readFile(w.file);
const docOf = (b: Buffer) => loadDoc(bufSyncSource(b));
const annotsCount = (b: Buffer) => {
  const d = docOf(b);
  const arr = resolve(d, getPage(d, 0)!.dict.get('Annots'));
  return Array.isArray(arr) ? arr.length : 0;
};
const tmps = async (w: World) => (await readdir(w.root)).filter((n) => /\.rl-[0-9a-f]{8}\.tmp$/.test(n));
/** Waits (real time) until the check holds; fake timers only replace `setTimeout`. */
async function until(check: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const t0 = Date.now();
  const ok = async () => {
    try {
      return await check();
    } catch {
      return false; // the file may be in the middle of its replacement
    }
  };
  while (!(await ok())) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for the write');
    await new Promise((r) => setImmediate(r));
  }
}

let w: World;
beforeEach(async () => {
  fail.eperm = 0;
  w = await world();
  w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1'), ann('a2', { rects: [{ x: 0.3, y: 0.5, w: 0.2, h: 0.05 }] })] }));
});
const rmWorld = (x: World) => import('node:fs/promises').then((m) => m.rm(x.dir, { recursive: true, force: true }));
/** A new world in place of the one `beforeEach` made (the old folder is removed). */
async function fresh(over: Parameters<typeof world>[0]): Promise<void> {
  await rmWorld(w);
  w = await world(over);
}
afterEach(async () => {
  vi.useRealTimers();
  await rmWorld(w);
});

describe('consent and switches (D-348, D-354): nothing is written without them', () => {
  it('without writeToPdfConfirmedAt nothing is written, even with writeToPdf on; the state asks for consent', async () => {
    await fresh({ confirmed: false });
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1')] }));
    const ps = new PdfSync(w.s, true);
    const st = await ps.writeNow(DOC);
    expect(st.needsConsent).toBe(true);
    expect((await bytes(w)).equals(w.original)).toBe(true);
    expect(w.rec.get(DOC)!.pdfWrite).toBeUndefined();
    expect(await readdir(w.data)).not.toContain('pdf-originals');
  });

  it('the answer "Yes, also in the PDF" sets the confirmation and writes what waited', async () => {
    await fresh({ confirmed: false });
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1')] }));
    const ps = new PdfSync(w.s, true);
    const r = await ps.confirm('pdf');
    expect(r.confirmedAt).not.toBeNull();
    await ps.flushAll();
    await ps.writeNow(DOC);
    expect((await bytes(w)).length).toBeGreaterThan(w.original.length);
  });

  it('"Only in the app" turns writing off and nothing is written', async () => {
    await fresh({ confirmed: false });
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1')] }));
    const ps = new PdfSync(w.s, true);
    expect((await ps.confirm('app-only')).choice).toBe('app-only');
    const st = await ps.writeNow(DOC);
    expect(st.mode).toBe('off');
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });

  it('with PDF_WRITE_ENABLED off (the constant of the build) nothing is written and the state says off', async () => {
    const ps = new PdfSync(w.s, false);
    const st = await ps.writeNow(DOC);
    expect(st.mode).toBe('off');
    expect(st.needsConsent).toBe(false);
    expect((await bytes(w)).equals(w.original)).toBe(true);
    ps.touch(LIB, DOC);
    await ps.flushAll();
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });

  it('a document set to app-only is never written', async () => {
    w.anns.set(DOC, { ...w.anns.get(DOC)!, pdfMode: 'app-only' });
    const ps = new PdfSync(w.s, true);
    expect((await ps.writeNow(DOC)).mode).toBe('app-only');
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });
});

describe('repair (D-347): an annotation without geom 2 never enters the plan', () => {
  it('only the annotations with geom 2 are written; the state counts the others', async () => {
    const { geom: _g, ...legacy } = ann('old');
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1'), legacy] }));
    const ps = new PdfSync(w.s, true);
    const st = await ps.writeNow(DOC);
    expect(st.needsRepair).toBe(1);
    expect(annotsCount(await bytes(w))).toBe(1);
    expect(w.anns.get(DOC)!.annotations.find((a) => a.id === 'old')!.pdf).toBeUndefined();
    expect(w.anns.get(DOC)!.annotations.find((a) => a.id === 'a1')!.pdf).toBeDefined();
  });

  it('an annotation placed on another version of the file (forHash differs) is not written', async () => {
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1', { forHash: 'e'.repeat(64) })] }));
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });
});

describe('one write: copy, append, verify, replace (D-316, §8.3.3)', () => {
  it('the first write keeps the original as an exact prefix, makes the safety copy first and marks the annotations', async () => {
    const ps = new PdfSync(w.s, true);
    const st = await ps.writeNow(DOC);
    const out = await bytes(w);
    expect(out.subarray(0, w.original.length).equals(w.original)).toBe(true);
    expect(annotsCount(out)).toBe(2);
    expect(st.state).toBe('synced');
    const rec = w.rec.get(DOC)!;
    expect(rec.hash).toBe(sha(out));
    expect(rec.size).toBe(out.length);
    expect(rec.pdfWrite!.base).toEqual({ hash: sha(w.original), size: w.original.length });
    expect(rec.pdfWrite!.own.at(-1)!.hash).toBe(sha(out));
    // the copy is in the synced data folder and is the original, byte for byte
    const copy = path.join(w.data, 'pdf-originals', rec.pdfWrite!.backup!.file);
    expect((await readFile(copy)).equals(w.original)).toBe(true);
    expect(rec.pdfWrite!.backup!.location).toBe('data');
    // nothing else is left next to the original, and the original was neither moved nor renamed
    expect(await tmps(w)).toEqual([]);
    expect((await readdir(w.root)).sort()).toEqual(['.lab', 'paper.pdf']);
    expect(w.anns.get(DOC)!.annotations.every((a) => a.pdf)).toBe(true);
  });

  it('the copy is made once per content, and is in the local folder when the library says so', async () => {
    w.cfg.annotations.backupLocation = 'local';
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    // a second write (a changed annotation) does not make another copy
    w.anns.set(DOC, { ...w.anns.get(DOC)!, annotations: w.anns.get(DOC)!.annotations.map((a) => (a.id === 'a1' ? { ...a, color: 'green', updatedAt: '2026-02-02T00:00:00.000Z' } : a)) });
    await ps.writeNow(DOC);
    const dir = path.join(w.local, 'libraries', LIB, 'pdf-originals');
    expect((await readdir(dir)).filter((n) => n.endsWith('.pdf'))).toHaveLength(1);
    expect(await readdir(w.data)).not.toContain('pdf-originals');
    expect(w.rec.get(DOC)!.pdfWrite!.backup!.location).toBe('local');
    expect(w.rec.get(DOC)!.pdfWrite!.own.length).toBe(2);
    expect(w.rec.get(DOC)!.pdfWrite!.base.hash).toBe(sha(w.original));
  });

  it('the same state a second time writes nothing (the three-way comparison finds nothing to do)', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    const once = await bytes(w);
    await ps.writeNow(DOC);
    expect((await bytes(w)).equals(once)).toBe(true);
  });

  it('a refused file is reported with its reason and left alone', async () => {
    await fresh({ pdf: docPdf({ catalogExtra: '/AcroForm << /XFA [(x) 21 0 R] >>', extraObjs: [{ n: 21, body: '<< /Length 0 >>' }] }) });
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1')] }));
    const ps = new PdfSync(w.s, true);
    const st = await ps.writeNow(DOC);
    expect(st).toMatchObject({ state: 'refused', reason: 'xfa' });
    expect((await bytes(w)).equals(w.original)).toBe(true);
    expect(w.events.some(([c, p]) => c === 'annotations:pdfProgress' && (p as { state: string }).state === 'refused')).toBe(true);
  });

  it('a read-only file is refused with that reason', async () => {
    const ps = new PdfSync(w.s, true);
    const { chmod } = await import('node:fs/promises');
    await chmod(w.file, 0o444);
    try {
      const st = await ps.writeNow(DOC);
      // on a system that honours the flag (Windows read-only attribute included)
      if (st.state === 'refused') expect(st.reason).toBe('read-only');
    } finally {
      await chmod(w.file, 0o666);
    }
  });
});

describe('atomicity and the temporary (§8.3.3, D-200)', () => {
  it('EPERM at the replacement: the write waits (pending, locked) and succeeds on the next attempt', async () => {
    fail.eperm = 99; // the first attempt and its three retries all fail
    const ps = new PdfSync(w.s, true);
    const st = await ps.writeNow(DOC);
    expect(st).toMatchObject({ state: 'pending', reason: 'locked' });
    expect((await bytes(w)).equals(w.original)).toBe(true);
    expect(await tmps(w)).toEqual([]);
    expect(w.rec.get(DOC)!.pdfWrite!.own).toEqual([]); // the record forgot the file that never became visible
    fail.eperm = 0;
    expect((await ps.writeNow(DOC)).state).toBe('synced');
    expect((await bytes(w)).length).toBeGreaterThan(w.original.length);
  }, 30_000);

  it('a retry that works: one EPERM, then the replacement goes through', async () => {
    fail.eperm = 1;
    const ps = new PdfSync(w.s, true);
    expect((await ps.writeNow(DOC)).state).toBe('synced');
  });

  it('the file changed between the analysis and the replacement: nothing replaces it and no temporary stays', async () => {
    const ps = new PdfSync(w.s, true);
    w.hooks.beforeVerify = async () => {
      const b = await bytes(w);
      await writeFile(w.file, Buffer.concat([b, Buffer.from('\n% another program was here\n')]));
      w.hooks.beforeVerify = undefined;
    };
    await ps.writeNow(DOC);
    const now = await bytes(w);
    expect(now.subarray(0, w.original.length).equals(w.original)).toBe(true);
    expect(now.toString('latin1')).toContain('another program was here');
    expect(annotsCount(now)).toBe(0);
    expect(await tmps(w)).toEqual([]);
  });

  it('CONFLICT is what an explicit action reports when the file changed meanwhile', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    w.hooks.beforeVerify = async () => {
      const b = await bytes(w);
      await writeFile(w.file, Buffer.concat([b, Buffer.from('\n% changed\n')]));
    };
    await expect(ps.removeFromPdf(DOC).catch((e: unknown) => e)).resolves.toMatchObject({ code: 'CONFLICT' });
    expect(await tmps(w)).toEqual([]);
  });

  it('after a stop in the middle of a write only the registered temporaries are deleted', async () => {
    const dirj = path.join(w.local, 'pdf-write');
    await mkdir(dirj, { recursive: true });
    const registered = path.join(w.root, '.paper.pdf.rl-deadbeef.tmp');
    const stray = path.join(w.root, '.other.pdf.rl-cafebabe.tmp');
    const important = path.join(w.root, 'important.pdf');
    await writeFile(registered, 'half a write');
    await writeFile(stray, 'not ours to delete');
    await writeFile(important, 'a real document');
    await writeFile(
      path.join(dirj, 'journal.json'),
      JSON.stringify({ v: 1, entries: [{ tmp: registered, docId: DOC, libraryId: LIB, at: NOW }, { tmp: important, docId: DOC, libraryId: LIB, at: NOW }, { tmp: path.join(os.tmpdir(), '.outside.pdf.rl-01234567.tmp'), docId: DOC, libraryId: LIB, at: NOW }] }),
    );
    const ps = new PdfSync(w.s, true);
    await ps.resume();
    const left = (await readdir(w.root)).sort();
    expect(left).not.toContain('.paper.pdf.rl-deadbeef.tmp');
    expect(left).toContain('.other.pdf.rl-cafebabe.tmp');
    expect(left).toContain('important.pdf');
  });
});

describe('the moments of writing (D-349)', () => {
  const start = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

  it('nothing is written while the user annotates; one write after 120 s without changes', async () => {
    start();
    const ps = new PdfSync(w.s, true);
    ps.touch(LIB, DOC);
    await vi.advanceTimersByTimeAsync(100_000);
    ps.touch(LIB, DOC); // another change: the wait starts again
    await vi.advanceTimersByTimeAsync(100_000);
    expect((await bytes(w)).equals(w.original)).toBe(true);
    await vi.advanceTimersByTimeAsync(20_001);
    await until(async () => (await bytes(w)).length > w.original.length);
    // all the changes are in one revision
    expect(docOf(await bytes(w)).sections).toBe(docOf(w.original).sections + 1);
    expect(annotsCount(await bytes(w))).toBe(2);
  });

  it('a new change within 10 minutes of the last write waits for the 10 minutes', async () => {
    start();
    const ps = new PdfSync(w.s, true);
    ps.touch(LIB, DOC);
    await vi.advanceTimersByTimeAsync(120_001);
    await until(async () => (await bytes(w)).length > w.original.length);
    const first = await bytes(w);
    w.anns.set(DOC, { ...w.anns.get(DOC)!, annotations: w.anns.get(DOC)!.annotations.map((a) => ({ ...a, comment: 'edited', updatedAt: '2026-02-03T00:00:00.000Z' })) });
    ps.touch(LIB, DOC);
    await vi.advanceTimersByTimeAsync(130_000);
    expect((await bytes(w)).equals(first)).toBe(true);
    await vi.advanceTimersByTimeAsync(480_000);
    await until(async () => !(await bytes(w)).equals(first));
  }, 30_000);

  it('with the document open and over 50 MB nothing is written until it closes', async () => {
    start();
    w.rec.set(DOC, { ...w.rec.get(DOC)!, size: 60 * 1024 * 1024 });
    const ps = new PdfSync(w.s, true);
    ps.touch(LIB, DOC);
    await vi.advanceTimersByTimeAsync(130_000);
    await new Promise((r) => setImmediate(r));
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });

  it('the close of the document (writeNow) writes at once, and the app quitting flushes the pending ones', async () => {
    const ps = new PdfSync(w.s, true);
    ps.touch(LIB, DOC);
    await new Promise((r) => setTimeout(r, 20));
    await ps.flushAll(5000);
    expect((await bytes(w)).length).toBeGreaterThan(w.original.length);
  });

  it('the write of our own replacement is registered, so the watcher event it causes can be ignored', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    const out = await bytes(w);
    expect(ps.expectedWrites.has(`${sha(out)}:${out.length}`)).toBe(true);
  });
});

describe('take them out, restore, copies (D-352, §8.3.8)', () => {
  /** Another program adds an annotation to the page after our write (a revision of its own). */
  async function otherProgramAnnotates(): Promise<void> {
    const b = await bytes(w);
    const d = docOf(b);
    const page = getPage(d, 0)!;
    const annots = page.dict.get('Annots') as { n: number; g: number };
    const arr = resolve(d, annots) as Array<{ n: number; g: number }>;
    const list = [...arr.map((r) => `${r.n} ${r.g} R`), '90 0 R'].join(' ');
    const next = appendRevision(b, [
      [annots.n, `[${list}]`],
      [90, '<< /Type /Annot /Subtype /Text /Rect [5 5 20 20] /Contents (another program) /NM (other-9) >>'],
    ]);
    await writeFile(w.file, next);
    const st = await stat(w.file);
    w.rec.set(DOC, { ...w.rec.get(DOC)!, size: next.length, hash: sha(next), mtimeMs: st.mtimeMs });
  }

  it('"take them out" removes only the /NM (rl-…) references and leaves the other annotations and the prefix', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    await otherProgramAnnotates();
    const before = await bytes(w);
    const st = await ps.removeFromPdf(DOC);
    const after = await bytes(w);
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(annotsCount(after)).toBe(1); // only the other program's annotation is left in /Annots
    expect(st.mode).toBe('app-only');
    expect(w.anns.get(DOC)!.annotations.every((a) => a.pdf === undefined)).toBe(true);
    expect(w.anns.get(DOC)!.annotations).toHaveLength(2); // the annotations stay in the app
  });

  it('restore by truncation gives the original, byte for byte, and counts what it drops', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    await otherProgramAnnotates();
    expect((await ps.state(DOC, true)).droppedOnRestore).toBe(1);
    const r = await ps.restoreOriginal(DOC);
    expect(r).toEqual({ restored: true, droppedExternal: 1 });
    expect((await bytes(w)).equals(w.original)).toBe(true);
    const rec = w.rec.get(DOC)!;
    expect(rec.hash).toBe(sha(w.original));
    expect(rec.pdfWrite!.own).toEqual([]);
    expect(w.anns.get(DOC)!.pdfMode).toBe('app-only');
    expect(await tmps(w)).toEqual([]);
  });

  it('when the truncation is not the original (the file was rewritten) the safety copy is used, after its hash is checked', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    const rewritten = docPdf({ pages: 5 }); // another program saved the whole file again
    await writeFile(w.file, rewritten);
    const st = await stat(w.file);
    w.rec.set(DOC, { ...w.rec.get(DOC)!, size: rewritten.length, hash: sha(rewritten), mtimeMs: st.mtimeMs });
    expect((await ps.restoreOriginal(DOC)).restored).toBe(true);
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });

  it('with a damaged copy and a truncation that does not match, nothing is replaced', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    const rewritten = docPdf({ pages: 5 });
    await writeFile(w.file, rewritten);
    const st = await stat(w.file);
    w.rec.set(DOC, { ...w.rec.get(DOC)!, size: rewritten.length, hash: sha(rewritten), mtimeMs: st.mtimeMs });
    const copy = path.join(w.data, 'pdf-originals', w.rec.get(DOC)!.pdfWrite!.backup!.file);
    await writeFile(copy, 'damaged');
    await expect(ps.restoreOriginal(DOC)).rejects.toBeInstanceOf(AppError);
    expect((await bytes(w)).equals(rewritten)).toBe(true);
    expect(await tmps(w)).toEqual([]);
  });

  it('the safety copies are counted and can be deleted (the record then restores by truncation only)', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    const b = await ps.backups();
    expect(b.count).toBe(1);
    expect(b.bytes).toBe(w.original.length);
    expect(await ps.deleteBackups()).toEqual({ deleted: 1 });
    expect((await ps.backups()).count).toBe(0);
    expect(w.rec.get(DOC)!.pdfWrite!.backup).toBeUndefined();
    expect((await ps.restoreOriginal(DOC)).restored).toBe(true);
    expect((await bytes(w)).equals(w.original)).toBe(true);
  });

  it('an annotation another program took out is "to check": never rewritten by itself, then rewritten or deleted by choice', async () => {
    const ps = new PdfSync(w.s, true);
    await ps.writeNow(DOC);
    // a program saved a clean copy of the file: same pages, no annotations
    const clean = docPdf({ pages: 2 });
    await writeFile(w.file, clean);
    const st = await stat(w.file);
    w.rec.set(DOC, { ...w.rec.get(DOC)!, size: clean.length, hash: sha(clean), mtimeMs: st.mtimeMs });
    const after = await ps.writeNow(DOC);
    expect(after.missing).toBe(2);
    expect((await bytes(w)).equals(clean)).toBe(true);
    await ps.writeNow(DOC);
    expect((await bytes(w)).equals(clean)).toBe(true); // still not rewritten
    expect((await ps.resolveMissing(DOC, 'delete', ['a1'])).missing).toBe(1);
    expect(w.anns.get(DOC)!.annotations.map((a) => a.id)).toEqual(['a2']);
    const re = await ps.resolveMissing(DOC, 'rewrite');
    expect(re.missing).toBe(0);
    expect(annotsCount(await bytes(w))).toBe(1);
  });
});

describe('the library: migration of the annotations that already exist (D-347)', () => {
  const second = '1111111111111111';
  async function addSecond(annotations: unknown[]): Promise<string> {
    const file = path.join(w.root, 'second.pdf');
    const buf = docPdf({ pages: 1 });
    await writeFile(file, buf);
    const st = await stat(file);
    w.rec.set(second, { id: second, hash: sha(buf), path: 'second.pdf', size: buf.length, mtimeMs: st.mtimeMs, missing: false, updatedAt: NOW, previousHashes: [], revision: 0 } as unknown as DocumentRecord);
    w.anns.set(second, annotationFileSchema.parse({ docId: second, annotations }));
    return file;
  }

  it('the plan counts the files, the space of the copies and the documents skipped for annotations to check', async () => {
    const { geom: _g, ...legacy } = ann('old');
    await addSecond([legacy]);
    const plan = await new PdfSync(w.s, true).migrationPlan();
    expect(plan).toEqual({ files: 1, bytes: w.original.length, skipped: 1, written: 0 });
  });

  it('writes one file at a time, skips the documents with annotations to check, and can be cancelled', async () => {
    const { geom: _g, ...legacy } = ann('old');
    const secondFile = await addSecond([legacy]);
    const secondBytes = await readFile(secondFile);
    const ps = new PdfSync(w.s, true);
    const { jobId } = await ps.migrate();
    await until(() => w.events.some(([c, p]) => c === 'annotations:pdfProgress' && (p as { jobId?: string; state: string }).jobId === jobId && ((p as { state: string }).state === 'done' || (p as { state: string }).state === 'cancelled')));
    expect(annotsCount(await bytes(w))).toBe(2);
    expect((await readFile(secondFile)).equals(secondBytes)).toBe(true); // skipped whole
  });

  it('refuses to start without the consent of the library', async () => {
    w.cfg.annotations.writeToPdfConfirmedAt = null;
    await expect(new PdfSync(w.s, true).migrate()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('an annotated copy and the annotations of other programs (J5, §8.3.14)', () => {
  let out: string;
  beforeEach(async () => {
    out = path.join(w.dir, 'out');
    await mkdir(out, { recursive: true });
    (w.s as unknown as { approved: unknown }).approved = { resolve: (p: string, purpose: string) => (purpose === 'export-destination' && p === out ? p : null) };
  });

  it('writes only a copy: the original is untouched, the copy has the original as prefix and the annotations, nothing is left behind', async () => {
    // writing into the original is off for this document and in this build, and still the copy is made
    const ps = new PdfSync(w.s, false);
    const r = await ps.exportCopy(DOC, out);
    expect(r).toEqual({ file: 'paper (annotated).pdf', annotations: 2, skipped: 0 });
    expect((await bytes(w)).equals(w.original)).toBe(true);
    expect((await readdir(w.root)).sort()).toEqual(['.lab', 'paper.pdf']);
    const copy = await readFile(path.join(out, r.file));
    expect(copy.subarray(0, w.original.length).equals(w.original)).toBe(true);
    expect(annotsCount(copy)).toBe(2);
    expect((await readdir(out)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(w.anns.get(DOC)!.annotations.every((a) => !a.pdf)).toBe(true); // the app's records are not marked: nothing was written into the original
    // a second export never replaces the first
    expect((await ps.exportCopy(DOC, out)).file).toBe('paper (annotated 2).pdf');
  });

  it('refuses a folder that was not picked with the dialog, and one inside the library', async () => {
    const ps = new PdfSync(w.s, false);
    await expect(ps.exportCopy(DOC, path.join(w.dir, 'elsewhere'))).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'destination-not-approved' } });
    const inside = path.join(w.root, 'sub');
    await mkdir(inside);
    (w.s as unknown as { approved: unknown }).approved = { resolve: (p: string) => p };
    await expect(ps.exportCopy(DOC, inside)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'inside-library' } });
  });

  it('a file with many revisions (refused for writing) can be copied', async () => {
    let pdf = docPdf({ pages: 1 });
    for (let i = 0; i < 205; i++) pdf = appendRevision(pdf, [[30 + (i % 3), '<< /K 1 >>']]);
    await fresh({ pdf });
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [ann('a1')] }));
    const o2 = path.join(w.dir, 'out2');
    await mkdir(o2);
    (w.s as unknown as { approved: unknown }).approved = { resolve: (p: string) => p };
    const ps = new PdfSync(w.s, true);
    expect((await ps.writeNow(DOC)).reason).toBe('too-many-revisions');
    const r = await ps.exportCopy(DOC, o2);
    const copy = await readFile(path.join(o2, r.file));
    expect(copy.subarray(0, pdf.length).equals(pdf)).toBe(true);
    expect((await bytes(w)).equals(pdf)).toBe(true);
  });

  it('nothing to put in a copy is said, not silently copied', async () => {
    w.anns.set(DOC, annotationFileSchema.parse({ docId: DOC, annotations: [] }));
    await expect(new PdfSync(w.s, false).exportCopy(DOC, out)).rejects.toMatchObject({ details: { reason: 'no-annotations' } });
  });

  it('lists the highlights of other programs (not ours) and imports the chosen ones into the app; the PDF is not touched', async () => {
    const hl = (nm: string, sub: string, q: string) => `<< /Type /Annot /Subtype /${sub} /Rect [20 150 120 170] /QuadPoints [${q}] /C [1 0.92 0.23] /NM (${nm}) /Contents (from a reader) /T (Ann) >>`;
    const other = appendRevision(docPdf({ pages: 1 }), [
      [30, hl('x-1', 'Highlight', '20 170 120 170 20 150 120 150')],
      [31, hl('rl-mine', 'Highlight', '20 100 120 100 20 80 120 80')],
      [32, hl('x-2', 'Underline', '20 60 120 60 20 40 120 40')],
      [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 200 200] /Annots [30 0 R 31 0 R 32 0 R] >>'],
    ]);
    await fresh({ pdf: other });
    const ps = new PdfSync(w.s, false);
    const list = await ps.externalList(DOC);
    expect(list.items.map((i) => [i.kind, i.page, i.color, i.comment, i.author, i.inApp])).toEqual([
      ['highlight', 1, 'yellow', 'from a reader', 'Ann', false],
      ['underline', 1, 'yellow', 'from a reader', 'Ann', false],
    ]);
    const first = list.items[0]!;
    expect(first.rects[0]!.y).toBeCloseTo(0.15, 2);
    const r = await ps.externalImport(DOC, [first.key, 'nonsense']);
    expect(r).toEqual({ imported: 1, skipped: 1 });
    const saved = w.anns.get(DOC)!.annotations;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ kind: 'highlight', page: 1, color: 'yellow', geom: 2, comment: 'from a reader' });
    expect((await bytes(w)).equals(other)).toBe(true);
    // the same one again is "already in the app" and is not imported twice
    expect((await ps.externalList(DOC)).items[0]!.inApp).toBe(true);
    expect(await ps.externalImport(DOC, [first.key])).toEqual({ imported: 0, skipped: 1 });
  });
});

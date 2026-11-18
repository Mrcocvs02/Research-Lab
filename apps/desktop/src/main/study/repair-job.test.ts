import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Annotation, AnnotationFile, DocumentRecord } from '@rl/core';
import { overlapRatio, repairQuotes, type NormRect } from '@rl/data';
import { runRepair, type RepairDeps, type RepairStatus } from './repair-job.js';

/** Two synthetic PDFs with known lines: the glyph box of any quoted piece follows from the font metrics. */
const W = 612;
const H = 792;
const SIZE = 12;
const LEFT = 72;
const LINES = ['The committee reviewed the proposal in detail', 'Results were stable across every single trial', 'Twice the same words, twice the same words', 'A closing line with nothing special'];
const Y = [700, 600, 500, 400];

let dir: string;
let font: Awaited<ReturnType<PDFDocument['embedFont']>>;
const hash = (n: number) => String(n).padStart(64, '0');
const hex = (n: number) => n.toString(16).padStart(16, '0');

async function makePdf(file: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([W, H]);
  LINES.forEach((t, i) => page.drawText(t, { x: LEFT, y: Y[i]!, size: SIZE, font }));
  const bytes = await doc.save();
  await writeFile(path.join(dir, file), bytes);
  return bytes;
}

const glyphBox = (line: number, piece: string): NormRect => {
  const before = font.widthOfTextAtSize(LINES[line]!.slice(0, LINES[line]!.indexOf(piece)), SIZE);
  return { x: (LEFT + before) / W, y: (H - Y[line]! - 0.72 * SIZE) / H, w: font.widthOfTextAtSize(piece, SIZE) / W, h: (0.93 * SIZE) / H };
};
const skewed = (r: NormRect): NormRect => {
  const x = Math.min(1, r.x * 1.49);
  return { x, y: r.y, w: Math.min(1 - x, r.w * 1.49), h: r.h };
};

const NOW = '2026-01-01T00:00:00.000Z';
const ann = (id: string, text: string, rects: NormRect[], over: Partial<Annotation> = {}): Annotation => ({ id, kind: 'highlight', page: 1, rects, text, color: 'yellow', createdAt: NOW, updatedAt: NOW, ...over });

/** An in-memory store with the two repositories the job uses. */
function fakeStore(records: DocumentRecord[], files: Map<string, AnnotationFile>): RepairDeps['store'] {
  return {
    rootPath: dir,
    documents: {
      listIds: async () => records.map((r) => r.id),
      get: async (id: string) => records.find((r) => r.id === id) ?? null,
    },
    annotations: {
      get: async (id: string) => structuredClone(files.get(id) ?? null),
      update: async (id: string, fn: (cur: AnnotationFile | null) => AnnotationFile) => {
        const next = fn(structuredClone(files.get(id) ?? null));
        files.set(id, next);
        return next;
      },
    },
  } as unknown as RepairDeps['store'];
}

const record = (n: number, file: string): DocumentRecord => ({ id: hex(n), path: file, hash: hash(n), missing: false }) as unknown as DocumentRecord;
const fileOf = (n: number, annotations: Annotation[]): AnnotationFile => ({ schemaVersion: 1, docId: hex(n), forHash: hash(n), annotations }) as unknown as AnnotationFile;

const deps = (store: RepairDeps['store'], over: Partial<RepairDeps> = {}): RepairDeps => ({
  libraryId: 'lib',
  store,
  repair: (args, signal) => repairQuotes(args.rootPath, args.path, args.queries, { signal }),
  changed: () => {},
  onStatus: () => {},
  pause: async () => {},
  ...over,
});

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-repair-'));
});
afterAll(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe('runRepair', () => {
  it('repairs misplaced annotations from their text, leaves ambiguous ones and skips the repaired ones', async () => {
    const before = await makePdf('a.pdf');
    const good = [glyphBox(0, 'reviewed the proposal'), glyphBox(1, 'Results were stable')];
    const rightAlready = ann('a-4', 'trial', [glyphBox(1, 'trial')], { geom: 2 });
    const files = new Map([
      [
        hex(1),
        fileOf(1, [
          ann('a-1', 'reviewed the proposal', [skewed(good[0]!)]),
          ann('a-2', 'Results were stable', [skewed(good[1]!)]),
          ann('a-3', 'the same words', [skewed(glyphBox(2, 'the same words'))]), // twice on one line
          rightAlready,
          ann('a-5', 'words that are not on the page', [skewed(good[0]!)]),
          ann('a-6', '  ', [skewed(good[0]!)]),
        ]),
      ],
    ]);
    const asked: string[] = [];
    const changed: string[] = [];
    const statuses: RepairStatus[] = [];
    const out = await runRepair(
      deps(fakeStore([record(1, 'a.pdf')], files), {
        repair: (args, signal) => {
          asked.push(...args.queries.map((q) => q.id));
          return repairQuotes(args.rootPath, args.path, args.queries, { signal });
        },
        changed: (id) => changed.push(id),
        onStatus: (s) => statuses.push(s),
      }),
      new AbortController().signal,
    );
    const list = files.get(hex(1))!.annotations;
    const by = (id: string) => list.find((a) => a.id === id)!;
    // Only what needs it is asked: not the one that is geom 2, not the one without text.
    expect(asked.sort()).toEqual(['a-1', 'a-2', 'a-3', 'a-5']);
    for (const [id, i] of [['a-1', 0], ['a-2', 1]] as const) {
      expect(by(id).geom).toBe(2);
      expect(overlapRatio(by(id).rects, [good[i]!]), id).toBeGreaterThanOrEqual(0.9);
    }
    for (const id of ['a-3', 'a-5', 'a-6']) {
      expect(by(id).geom, id).toBeUndefined();
      expect(by(id).rects, id).toEqual(id === 'a-3' ? [skewed(glyphBox(2, 'the same words'))] : [skewed(good[0]!)]);
    }
    expect(by('a-4')).toEqual(rightAlready);
    expect(out).toMatchObject({ state: 'done', total: 1, done: 1, repaired: 2, left: 2, failed: 0 });
    expect(changed).toEqual([hex(1)]);
    expect(statuses.at(-1)?.state).toBe('done');
    // The PDF is only read.
    expect(Buffer.from(await readFile(path.join(dir, 'a.pdf')))).toEqual(Buffer.from(before));
  });

  it('keeps the rectangles that are already right and only sets the marker', async () => {
    await makePdf('b.pdf');
    const right = glyphBox(0, 'reviewed the proposal');
    const files = new Map([[hex(2), fileOf(2, [ann('b-1', 'reviewed the proposal', [right])])]]);
    const out = await runRepair(deps(fakeStore([record(2, 'b.pdf')], files)), new AbortController().signal);
    const a = files.get(hex(2))!.annotations[0]!;
    expect(a.geom).toBe(2);
    expect(a.rects).toEqual([right]);
    expect(out).toMatchObject({ confirmed: 1, repaired: 0 });
  });

  it('skips annotations made on another version of the file, missing files and documents without annotations', async () => {
    await makePdf('c.pdf');
    const files = new Map([
      [hex(3), fileOf(3, [ann('c-1', 'reviewed the proposal', [skewed(glyphBox(0, 'reviewed the proposal'))], { forHash: hash(99) })])],
    ]);
    const missing = { ...record(4, 'c.pdf'), missing: true } as DocumentRecord;
    files.set(hex(4), fileOf(4, [ann('c-2', 'reviewed the proposal', [skewed(glyphBox(0, 'reviewed the proposal'))])]));
    let calls = 0;
    const out = await runRepair(deps(fakeStore([record(3, 'c.pdf'), missing, record(5, 'c.pdf')], files), { repair: async () => (calls++, []) }), new AbortController().signal);
    expect(calls).toBe(0);
    expect(out).toMatchObject({ state: 'done', total: 0 });
  });

  it('leaves an annotation the reader changed while the job was reading the file', async () => {
    await makePdf('d.pdf');
    const bad = skewed(glyphBox(0, 'reviewed the proposal'));
    const files = new Map([[hex(6), fileOf(6, [ann('d-1', 'reviewed the proposal', [bad])])]]);
    await runRepair(
      deps(fakeStore([record(6, 'd.pdf')], files), {
        repair: async (args, signal) => {
          const out = await repairQuotes(args.rootPath, args.path, args.queries, { signal });
          files.get(hex(6))!.annotations[0]!.updatedAt = '2026-02-02T00:00:00.000Z'; // the user saved it meanwhile
          return out;
        },
      }),
      new AbortController().signal,
    );
    expect(files.get(hex(6))!.annotations[0]!.geom).toBeUndefined();
  });

  it('counts a document that cannot be read and goes on', async () => {
    await writeFile(path.join(dir, 'bad.pdf'), 'not a pdf');
    await makePdf('e.pdf');
    const bad = skewed(glyphBox(0, 'reviewed the proposal'));
    const files = new Map([
      [hex(7), fileOf(7, [ann('e-1', 'reviewed the proposal', [bad])])],
      [hex(8), fileOf(8, [ann('e-2', 'reviewed the proposal', [bad])])],
    ]);
    const out = await runRepair(deps(fakeStore([record(7, 'bad.pdf'), record(8, 'e.pdf')], files)), new AbortController().signal);
    expect(out).toMatchObject({ state: 'done', total: 2, done: 2, failed: 1, repaired: 1 });
    expect(files.get(hex(7))!.annotations[0]!.geom).toBeUndefined();
    expect(files.get(hex(8))!.annotations[0]!.geom).toBe(2);
  });

  it('stops when cancelled: the documents not reached are untouched', async () => {
    await makePdf('f.pdf');
    const bad = skewed(glyphBox(0, 'reviewed the proposal'));
    const files = new Map([1, 2, 3].map((n) => [hex(10 + n), fileOf(10 + n, [ann(`f-${n}`, 'reviewed the proposal', [bad])])] as const));
    const ac = new AbortController();
    let docs = 0;
    const out = await runRepair(
      deps(fakeStore([11, 12, 13].map((n) => record(n, 'f.pdf')), files), {
        onStatus: (s) => {
          if (s.done === 1 && s.state === 'running') ac.abort();
        },
        repair: (args, signal) => (docs++, repairQuotes(args.rootPath, args.path, args.queries, { signal })),
      }),
      ac.signal,
    );
    expect(out.state).toBe('cancelled');
    expect(docs).toBe(1);
    expect(files.get(hex(11))!.annotations[0]!.geom).toBe(2);
    expect(files.get(hex(12))!.annotations[0]!.geom).toBeUndefined();
    expect(files.get(hex(13))!.annotations[0]!.geom).toBeUndefined();
  });
});

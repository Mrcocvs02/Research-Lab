import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentRecordSchema, type DocumentRecord } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';
import { closeOpenMark, getResume, initResume, recordResume } from './resume.js';

const now = '2026-01-01T00:00:00.000Z';
const doc = (id: string, over: Partial<DocumentRecord> = {}): DocumentRecord =>
  documentRecordSchema.parse({ schemaVersion: 1, id, hash: id.repeat(4), path: `p/${id}.pdf`, size: 1, mtimeMs: 1, addedAt: now, updatedAt: now, ...over });

let dir: string;
let docs: Map<string, DocumentRecord>;
let s: MainServices;
const mark = () => path.join(dir, 'open-reader.json');

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-resume-'));
  docs = new Map([
    ['aaaaaaaaaaaaaaaa', doc('aaaaaaaaaaaaaaaa', { title: 'Alpha' })],
    ['bbbbbbbbbbbbbbbb', doc('bbbbbbbbbbbbbbbb', { title: 'Beta' })],
  ]);
  const rt = {
    libraryId: 'lib1',
    store: {
      documents: {
        list: async () => [...docs.values()],
        get: async (id: string) => docs.get(id) ?? null,
        update: async (id: string, fn: (c: DocumentRecord | null) => DocumentRecord) => {
          const n = fn(docs.get(id) ?? null);
          docs.set(id, n);
          return n;
        },
      },
    },
  };
  s = { localDataDir: dir, runtime: { require: async () => rt }, log: { warn: () => undefined } } as unknown as MainServices;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('resume', () => {
  it('writes the position and the open mark, and the closed reader removes the mark', async () => {
    await recordResume(s, { docId: 'aaaaaaaaaaaaaaaa', page: 7, closed: false });
    expect(docs.get('aaaaaaaaaaaaaaaa')!.study.lastPage).toBe(7);
    expect(docs.get('aaaaaaaaaaaaaaaa')!.study.lastOpenedAt).toBeTruthy();
    expect(JSON.parse(await readFile(mark(), 'utf8'))).toMatchObject({ docId: 'aaaaaaaaaaaaaaaa', page: 7 });
    await recordResume(s, { docId: 'aaaaaaaaaaaaaaaa', page: 9, closed: true });
    expect(docs.get('aaaaaaaaaaaaaaaa')!.study.lastPage).toBe(9);
    expect(existsSync(mark())).toBe(false);
  });

  it('lists the latest document first and the next ones after it', async () => {
    await recordResume(s, { docId: 'aaaaaaaaaaaaaaaa', page: 2, closed: true });
    await new Promise((r) => setTimeout(r, 5));
    await recordResume(s, { docId: 'bbbbbbbbbbbbbbbb', page: 5, closed: true });
    const r = await getResume(s);
    expect(r.last).toMatchObject({ docId: 'bbbbbbbbbbbbbbbb', page: 5, title: 'Beta' });
    expect(r.recent.map((x) => x.docId)).toEqual(['aaaaaaaaaaaaaaaa']);
    expect(r.unclean).toBeNull();
  });

  it('says nothing when nothing was read', async () => {
    expect(await getResume(s)).toEqual({ last: null, recent: [], unclean: null });
  });

  it('reports an unclean close once: a mark left by the last run, not removed by a normal quit', async () => {
    await recordResume(s, { docId: 'aaaaaaaaaaaaaaaa', page: 4, closed: false });
    // The process "dies": the next start finds the mark.
    initResume(dir);
    expect(existsSync(mark())).toBe(false);
    const first = await getResume(s);
    expect(first.unclean).toEqual({ docId: 'aaaaaaaaaaaaaaaa', title: 'Alpha', page: 4 });
    expect((await getResume(s)).unclean).toBeNull();
  });

  it('does not report a normal quit', async () => {
    await recordResume(s, { docId: 'aaaaaaaaaaaaaaaa', page: 4, closed: false });
    closeOpenMark(dir);
    initResume(dir);
    expect((await getResume(s)).unclean).toBeNull();
  });
});

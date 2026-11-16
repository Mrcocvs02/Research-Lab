import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, DEFAULT_DATA_DIR_NAME, dataPath, documentRecordSchema, taxonomyFileSchema, type DocumentRecord } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from './store.js';
import { createOrganizer } from './organize/organizer.js';
import { hex, removeDir, tempDir } from './test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';
const doc = (n: number): DocumentRecord => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/file-${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW });
const node = (id: string) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user' });
const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  return null;
};

let root: string;
const logPath = (month: string) => path.join(root, DEFAULT_DATA_DIR_NAME, dataPath.logFile('changes', 'dev-1', month));
const line = (at: string, changeId: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ type: 'change', at, deviceId: 'dev-1', actor: 'user', target: { kind: 'document', id: hex(1) }, action: 'tags.update', changeId, before: { tags: [] }, after: { tags: ['a'] }, ...extra })}\n`;

beforeEach(async () => {
  root = await tempDir();
});
afterEach(() => removeDir(root));

describe('a change group that may be incomplete is never undone (D-182)', () => {
  async function setup(readFraction: number) {
    // Tag 12 documents (group A), then 12 others (group B) in the same monthly file, then read back with a cap that cuts A.
    const wide = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
    await wide.init();
    await wide.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('a')] }));
    for (let i = 1; i <= 24; i++) await wide.documents.put(doc(i));
    const wideOrg = createOrganizer({ store: wide, deviceId: 'dev-1', cacheTtlMs: 0 });
    const month = new Date().toISOString().slice(0, 7);
    const a = await wideOrg.tagDocuments(Array.from({ length: 12 }, (_, i) => hex(i + 1)), ['a']);
    const sizeA = (await stat(logPath(month))).size;
    const b = await wideOrg.tagDocuments(Array.from({ length: 12 }, (_, i) => hex(i + 13)), ['a']);
    const sizeAll = (await stat(logPath(month))).size;
    const cap = Math.floor(sizeAll - sizeA + sizeA * readFraction);
    const small: FileLibraryStore = createLibraryStore({ rootPath: root, deviceId: 'dev-1', maxLogReadBytes: cap });
    return { a: a.changeId as string, b: b.changeId as string, org: createOrganizer({ store: small, deviceId: 'dev-1', cacheTtlMs: 0 }), small };
  }

  it('shows the cut group as not undoable and refuses undo and redo on it, without touching the documents', async () => {
    const { a, b, org, small } = await setup(0.5);
    const items = await org.listHistory();
    expect(items.find((i) => i.changeId === a)).toMatchObject({ undoable: false, incomplete: true });
    expect(items.find((i) => i.changeId === b)).toMatchObject({ undoable: true, incomplete: false });
    expect(small.issues().map((i) => i.code)).toContain('LOG_TRUNCATED');

    const e = await err(org.undo(a));
    expect(e?.code).toBe('CONFLICT');
    expect(e?.details).toMatchObject({ reason: 'partial-group', changeId: a });
    expect((await small.documents.get(hex(1)))?.tags).toEqual(['a']); // nothing was half-reverted
    expect((await err(org.redo(a)))?.code).toBe('NOT_FOUND');
    // The default undo skips the incomplete group; the complete one stays undoable exactly as before.
    expect(await org.historyView()).toMatchObject({ canUndo: true });
    await org.undo(b);
    expect((await small.documents.get(hex(13)))?.tags).toEqual([]);
    expect(await org.historyView()).toMatchObject({ canUndo: false });
    expect((await err(org.undo()))?.code).toBe('NOT_FOUND');
  });

  it('a group fully inside the read part stays undoable', async () => {
    const { a, org } = await setup(1.5);
    const items = await org.listHistory();
    expect(items.find((i) => i.changeId === a)).toMatchObject({ undoable: true, incomplete: false });
    await org.undo(a);
  });
});

describe('detection on a truncated log file', () => {
  const month = '2026-03';
  async function write(lines: string[]) {
    await mkdir(path.dirname(logPath(month)), { recursive: true });
    await writeFile(logPath(month), lines.join(''), 'utf8');
  }

  it('flags the group at the cut and groups that lost their summary head, not complete ones', async () => {
    const lines = [
      line('2026-03-01T00:00:01.000Z', 'cut', { summary: 'cut away' }),
      line('2026-03-01T00:00:02.000Z', 'first', { summary: 'first read' }),
      line('2026-03-01T00:00:03.000Z', 'nohead'), // its summary-carrying entry is gone
      line('2026-03-01T00:00:04.000Z', 'whole', { summary: 'complete' }),
      line('2026-03-01T00:00:05.000Z', 'whole'),
      line('2026-03-01T00:00:06.000Z', 'nohead'),
    ];
    await write(lines);
    const cap = lines.slice(1).join('').length + 5; // the cut lands inside the first line
    const store = createLibraryStore({ rootPath: root, deviceId: 'dev-1', maxLogReadBytes: cap });
    const r = await store.readLogReport({ type: 'change' });
    expect([...r.partialChangeIds].sort()).toEqual(['first', 'nohead']);
  });

  it('flags nothing when the file is read whole: old logs (summary on every line) and changes without summary', async () => {
    await write([line('2026-03-01T00:00:01.000Z', 'old', { summary: 's' }), line('2026-03-01T00:00:02.000Z', 'old', { summary: 's' }), line('2026-03-01T00:00:03.000Z', 'none')]);
    const store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
    expect((await store.readLogReport()).partialChangeIds.size).toBe(0);
    await appendFile(logPath(month), line('2026-03-01T00:00:04.000Z', 'new'));
    expect((await store.readLogReport()).entries).toHaveLength(4);
  });
});

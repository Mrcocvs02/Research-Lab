import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraryTools } from '@rl/ai';
import { createMemoryLogger, documentRecordSchema } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import type { MainServices } from '../ipc/handlers/services.js';
import { createToolsHost } from './tools-host.js';

const NOW = '2026-01-02T03:04:05.000Z';
const id = '0000000000000001';
let root: string;
let store: FileLibraryStore;

const field = (status: string) => ({ value: 'old', meta: { model: 'm', provider: 'mock', date: NOW, source: 'chat' }, review: { status } });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-th-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.documents.put(documentRecordSchema.parse({ id, hash: 'ab'.repeat(32), path: 'open/p1.pdf', size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: 'Paper', ai: { summary: field('proposed') } }));
});
afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

function host() {
  const rt = { libraryId: 'lib-1', store, search: async () => ({ total: 0, hits: [] }), reindexDocuments: async () => {}, textCacheDir: root };
  const s = {
    log: createMemoryLogger(),
    localDataDir: root,
    emit: () => {},
    libraries: { profile: async () => ({ rootPath: root }) },
    settings: { get: async () => ({ deviceId: 'device-12345678' }) },
  } as unknown as MainServices;
  return createToolsHost({ s, rt: rt as never, provider: 'mock', model: 'claude-haiku-5-5', confirmed: true });
}

describe('write_ai_field against a review that lands in between', () => {
  it('the store re-checks the status on the live record: an accept that won the race is not overwritten', async () => {
    const h = host();
    const tools = createLibraryTools({ host: { ...h, enabledFolders: async () => ['open'] }, model: 'claude-haiku-5-5', provider: 'mock' });
    const write = tools.find((t) => t.name === 'write_ai_field')!;
    // The tool reads the document (still proposed), then the user accepts before the tool writes.
    const realGet = h.getDocument;
    const racing = {
      ...h,
      enabledFolders: async () => ['open'],
      getDocument: async (docId: string) => {
        const d = await realGet(docId);
        await store.documents.update(docId as never, (c) => ({ ...c!, ai: { ...c!.ai, summary: { ...c!.ai.summary!, review: { status: 'accepted' as const } } } }));
        return d;
      },
    };
    const racy = createLibraryTools({ host: racing, model: 'claude-haiku-5-5', provider: 'mock' }).find((t) => t.name === 'write_ai_field')!;
    await expect(racy.run({ docId: id, field: 'summary', text: 'new words' }, {})).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'reviewed' } });
    const cur = (await store.documents.get(id as never))!;
    expect(cur.ai.summary).toMatchObject({ value: 'old', review: { status: 'accepted' } });
    // Without a race the proposed field is replaced.
    await write.run({ docId: id, field: 'keywords', items: ['a'] }, {});
    expect((await store.documents.get(id as never))!.ai.keywords?.review.status).toBe('proposed');
  });
});

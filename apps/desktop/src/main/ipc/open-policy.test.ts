import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, channels, createDispatcher, createMemoryLogger, documentRecordSchema, type DocumentId, type IpcEnvelope } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { buildHandlers, type MainServices } from './handlers/index.js';
import { openVerdict } from './handlers/open-policy.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const rec = (n: number, p: string) => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: p, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW });

let root: string;
let outside: string;
let store: FileLibraryStore;
let opened: string[];
const EXTS = ['pdf', 'md', 'exe', 'msc', 'bat', 'docm', 'py', 'lnk', 'txt'];

async function call(docId: string): Promise<IpcEnvelope> {
  const log = createMemoryLogger();
  const rt = {
    libraryId: 'lib-1',
    scanExtensions: async () => EXTS,
    getDocument: async (id: string) => {
      const r = await store.documents.get(id as DocumentId);
      if (!r) throw new AppError('NOT_FOUND', 'Unknown document');
      return r;
    },
  };
  const services = {
    log,
    emit: () => {},
    runtime: { require: async () => rt },
    libraries: { profile: async () => ({ rootPath: root, id: 'lib-1' }) },
    shell: { openPath: async (p: string) => (opened.push(p), ''), showItemInFolder: () => {} },
  } as unknown as MainServices;
  return createDispatcher(channels, buildHandlers(services), log)('documents:open', { docId });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-open-'));
  outside = await mkdtemp(path.join(os.tmpdir(), 'rl-out-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  await store.init();
  opened = [];
  await mkdir(path.join(root, 'a'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('documents:open allow list', () => {
  it('opens an allowed format and nothing else, whatever the case or double extension', async () => {
    const names = ['ok.pdf', 'x.MSC', 'a.pdf.exe', 'run.EXE', 'macro.docm', 'tool.py', 'l.lnk', 'noext', 'a.pdf.msc', 'b.mshxml', 'k.PDF'];
    let n = 1;
    const ids = new Map<string, number>();
    for (const name of names) {
      await writeFile(path.join(root, 'a', name), 'x');
      await store.documents.put(rec(n, `a/${name}`));
      ids.set(name, n++);
    }
    for (const name of names) {
      const r = await call(hex(ids.get(name) as number));
      if (name === 'ok.pdf' || name === 'k.PDF') expect(r.ok, name).toBe(true);
      else expect(r.ok === false && r.error.code, name).toBe('PERMISSION_DENIED');
    }
    expect(opened).toHaveLength(2);
  });

  it('refuses a format of the library config that is not on the safe list, and one the config does not list', async () => {
    await writeFile(path.join(root, 'a', 'z.epub'), 'x'); // safe format, but not scanned by this library
    await store.documents.put(rec(1, 'a/z.epub'));
    const r = await call(hex(1));
    expect(r.ok === false && r.error.code).toBe('PERMISSION_DENIED');
    expect(opened).toEqual([]);
  });

  it('refuses a symlink named .pdf that points at an .exe', async () => {
    await writeFile(path.join(root, 'a', 'b.exe'), 'x');
    try {
      await symlink(path.join(root, 'a', 'b.exe'), path.join(root, 'a', 'l.pdf'), 'file');
    } catch {
      return; // no permission to create links on this machine
    }
    await store.documents.put(rec(1, 'a/l.pdf'));
    const r = await call(hex(1));
    expect(r.ok === false && r.error.code).toBe('PERMISSION_DENIED');
    expect(opened).toEqual([]);
  });

  it('refuses a junction/link leaving the library', async () => {
    await writeFile(path.join(outside, 'f.pdf'), 'x');
    try {
      await symlink(outside, path.join(root, 'a', 'j'), 'junction');
    } catch {
      return;
    }
    await store.documents.put(rec(1, 'a/j/f.pdf'));
    const r = await call(hex(1));
    expect(r.ok).toBe(false);
    expect(opened).toEqual([]);
  });
});

describe('openVerdict on a tampered record path', () => {
  it.each(['a/../x.pdf', 'C:/x.pdf', 'a.pdf:x.exe', 'x.pdf.', 'x.pdf ', '/etc/x.pdf'])('%s is denied', (p) => {
    expect(openVerdict(p, path.join(root, 'x.pdf'), ['pdf'])).toBe('denied');
  });
  it('allows a plain path', () => {
    expect(openVerdict('a/x.pdf', path.join(root, 'a', 'x.pdf'), ['pdf'])).toBe('ok');
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentRecordSchema, projectSchema, type DocumentRecord, type Project } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { GENERATED_LINE } from './bibtex-write.js';
import { copyBib, manage, sync } from './link.js';

// Synthetic library in memory; the export folder is a real temporary folder outside the library root.

const now = '2026-01-01T00:00:00.000Z';
const doc = (id: string, over: Partial<DocumentRecord> = {}): DocumentRecord =>
  documentRecordSchema.parse({ schemaVersion: 1, id, hash: id.repeat(4), path: `p/${id}.pdf`, size: 1, mtimeMs: 1, addedAt: now, updatedAt: now, ...over });

let lib: string;
let out: string;
let docs: Map<string, DocumentRecord>;
let projects: Map<string, Project>;
let clip: string[];
let s: MainServices;

beforeEach(async () => {
  lib = await mkdtemp(path.join(os.tmpdir(), 'rl-lib-'));
  out = await mkdtemp(path.join(os.tmpdir(), 'rl-out-'));
  docs = new Map([
    ['aaaaaaaaaaaaaaaa', doc('aaaaaaaaaaaaaaaa', { title: 'Alpha graphs', authors: ['Roe, Rick'], year: 2020 })],
    ['bbbbbbbbbbbbbbbb', doc('bbbbbbbbbbbbbbbb', { title: 'Beta graphs', authors: ['Roe, Rick'], year: 2020, citeKey: 'mykey' })],
  ]);
  projects = new Map([['proj', projectSchema.parse({ schemaVersion: 1, id: 'proj', name: 'Proj', members: [{ docId: 'aaaaaaaaaaaaaaaa', addedAt: now }, { docId: 'bbbbbbbbbbbbbbbb', addedAt: now }], createdAt: now, updatedAt: now })]]);
  clip = [];
  const rt = {
    store: {
      rootPath: lib,
      documents: {
        list: async () => [...docs.values()],
        update: async (id: string, fn: (c: DocumentRecord | null) => DocumentRecord) => {
          const n = fn(docs.get(id) ?? null);
          docs.set(id, n);
          return n;
        },
      },
      projects: {
        get: async (id: string) => projects.get(id) ?? null,
        update: async (id: string, fn: (c: Project | null) => Project) => {
          const n = fn(projects.get(id) ?? null);
          projects.set(id, n);
          return n;
        },
      },
    },
  };
  s = { runtime: { require: async () => rt }, approved: { resolve: (p: string) => p }, emit: () => undefined, log: { warn: () => undefined }, clipboard: { writeText: (t: string) => void clip.push(t) } } as unknown as MainServices;
});
afterEach(async () => {
  await rm(lib, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

const link = (fileName = 'refs.bib') => manage(s, { projectId: 'proj', op: 'link', destination: out, fileName });

describe('the managed .bib file', () => {
  it('writes a first line, stable keys, and stores the key on the documents', async () => {
    const st = await link();
    expect(st).toMatchObject({ linked: true, file: 'refs.bib', state: 'ok' });
    const text = await readFile(path.join(out, 'refs.bib'), 'utf8');
    expect(text.split('\n')[0]).toBe(GENERATED_LINE);
    expect(text).toContain('@misc{mykey,');
    const key = docs.get('aaaaaaaaaaaaaaaa')!.citeKey!;
    expect(key).toBe('roe2020alpha');
    expect(text).toContain(`{${key},`);
    // The key never changes again, even if the title does.
    docs.set('aaaaaaaaaaaaaaaa', { ...docs.get('aaaaaaaaaaaaaaaa')!, title: 'Totally different' });
    await sync(s, 'proj');
    expect(docs.get('aaaaaaaaaaaaaaaa')!.citeKey).toBe(key);
    expect(await readFile(path.join(out, 'refs.bib'), 'utf8')).toContain(`{${key},`);
  });

  it('rewrites when the project changes while the file is the one the app wrote', async () => {
    await link();
    projects.set('proj', { ...projects.get('proj')!, members: projects.get('proj')!.members.slice(0, 1) });
    expect(await sync(s, 'proj')).toMatchObject({ state: 'ok' });
    expect(await readFile(path.join(out, 'refs.bib'), 'utf8')).not.toContain('mykey');
  });

  it('does not write over a file changed outside the app, until the user chooses to', async () => {
    await link();
    const file = path.join(out, 'refs.bib');
    const edited = `${await readFile(file, 'utf8')}\n@misc{mine, title={By hand}}\n`;
    await writeFile(file, edited);
    projects.set('proj', { ...projects.get('proj')!, members: projects.get('proj')!.members.slice(0, 1) });
    expect(await sync(s, 'proj')).toMatchObject({ linked: true, state: 'changed-outside' });
    expect(await readFile(file, 'utf8')).toBe(edited);
    expect(await manage(s, { projectId: 'proj', op: 'status' })).toMatchObject({ state: 'changed-outside' });
    expect(await manage(s, { projectId: 'proj', op: 'overwrite' })).toMatchObject({ state: 'ok' });
    expect(await readFile(file, 'utf8')).not.toContain('By hand');
  });

  it('reports a deleted file and can unlink', async () => {
    await link();
    await rm(path.join(out, 'refs.bib'));
    expect(await sync(s, 'proj')).toMatchObject({ state: 'missing' });
    expect(await manage(s, { projectId: 'proj', op: 'unlink' })).toMatchObject({ linked: false });
    expect(projects.get('proj')!.bibLink).toBeUndefined();
  });

  it('refuses a file that is not ours, a name with a path, and a folder inside the library', async () => {
    await writeFile(path.join(out, 'refs.bib'), '@article{x, title={Hand made}}');
    await expect(link()).rejects.toMatchObject({ details: { reason: 'not-ours' } });
    expect(await readFile(path.join(out, 'refs.bib'), 'utf8')).toBe('@article{x, title={Hand made}}');
    await expect(link('../evil.bib')).rejects.toMatchObject({ details: { reason: 'invalid-name' } });
    await expect(link('con.bib')).rejects.toMatchObject({ details: { reason: 'invalid-name' } });
    const inside = path.join(lib, 'exports');
    await mkdir(inside);
    await expect(manage(s, { projectId: 'proj', op: 'link', destination: inside, fileName: 'a.bib' })).rejects.toMatchObject({ details: { reason: 'inside-library' } });
    expect(projects.get('proj')!.bibLink).toBeUndefined();
  });

  it('copies BibTeX of documents to the clipboard and refuses nothing to copy', async () => {
    expect(await copyBib(s, { docIds: ['bbbbbbbbbbbbbbbb'] })).toEqual({ count: 1 });
    expect(clip[0]).toContain('@misc{mykey,');
    await expect(copyBib(s, { docIds: [] })).rejects.toMatchObject({ details: { reason: 'empty' } });
    expect(await copyBib(s, { projectId: 'proj' })).toEqual({ count: 2 });
  });
});

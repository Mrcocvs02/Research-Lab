import path from 'node:path';
import { AppError, type DocumentRecord, type Project } from '@rl/core';
import { createHash } from 'node:crypto';
import { ExportTarget, isInsideLibrary } from '../../export/target.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import type { LibraryRuntime } from '../../library/library-runtime.js';
import { bibtexFile, GENERATED_LINE } from './bibtex-write.js';
import { freeKey, newKey } from './keys.js';

export interface BibStatus {
  linked: boolean;
  file: string | null;
  state: 'ok' | 'changed-outside' | 'missing' | 'error';
  at: string | null;
}

const sha256Of = (text: string): string => createHash('sha256').update(text).digest('hex');
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const NAME_OK = /^[^<>:"/\\|?*\u0000-\u001f]+$/;
const validName = (name: string): boolean => /\.bib$/i.test(name) && NAME_OK.test(name) && !RESERVED.test(path.parse(name).name) && !/[. ]$/.test(name.slice(0, -4)) && name.length <= 120;
const unlinked: BibStatus = { linked: false, file: null, state: 'ok', at: null };

const chains = new Map<string, Promise<unknown>>();
const serial = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
  chains.set(id, next.catch(() => undefined));
  return next;
};

/** Records of `ids`, each with a cite key: a document that has none gets one now, by the library's key schema, and keeps it for good (stable keys). */
export const withKeys = (rt: LibraryRuntime, ids: readonly string[]): Promise<Array<{ doc: DocumentRecord; key: string }>> => serial(`keys:${rt.libraryId}`, () => assignKeys(rt, ids));

async function assignKeys(rt: LibraryRuntime, ids: readonly string[]): Promise<Array<{ doc: DocumentRecord; key: string }>> {
  const store = rt.store;
  const schema = (await store.readConfig()).citeKeySchema;
  const all = await store.documents.list();
  const used = new Set(all.flatMap((d) => (d.citeKey ? [d.citeKey] : [])));
  const wanted = new Set(ids);
  const out: Array<{ doc: DocumentRecord; key: string }> = [];
  for (const d of all.filter((x) => wanted.has(x.id)).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (d.citeKey) {
      out.push({ doc: d, key: d.citeKey });
      continue;
    }
    const key = freeKey(newKey(d, schema), used);
    used.add(key);
    const saved = await store.documents.update(d.id, (cur) => {
      if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
      return cur.citeKey ? cur : { ...cur, citeKey: key };
    });
    out.push({ doc: saved, key: saved.citeKey ?? key });
  }
  return out;
}

async function render(rt: LibraryRuntime, ids: readonly string[]): Promise<{ text: string; count: number }> {
  const docs = await withKeys(rt, ids);
  return { text: bibtexFile(docs), count: docs.length };
}

const projectOf = async (rt: LibraryRuntime, id: string): Promise<Project> => {
  const p = await rt.store.projects.get(id);
  if (!p) throw new AppError('NOT_FOUND', 'Unknown project', { id });
  return p;
};

const statusOf = (p: Project, state: BibStatus['state']): BibStatus => (p.bibLink ? { linked: true, file: p.bibLink.file, state, at: p.bibLink.at } : unlinked);

async function setLink(s: MainServices, rt: LibraryRuntime, id: string, link: Project['bibLink']): Promise<Project> {
  const saved = await rt.store.projects.update(id, (cur) => {
    if (!cur) throw new AppError('NOT_FOUND', 'Unknown project', { id });
    const { bibLink: _old, ...rest } = cur;
    return link ? { ...rest, bibLink: link } : rest;
  });
  s.emit('library:changed', { kind: 'projects', ids: [id] });
  return saved;
}

/** Rewrites the linked file when it is exactly what the app wrote last (D-421); otherwise nothing is written. */
async function writeLinked(s: MainServices, rt: LibraryRuntime, id: string, force: boolean): Promise<BibStatus> {
  const p = await projectOf(rt, id);
  const link = p.bibLink;
  if (!link) return unlinked;
  try {
    // The record travels with the library: the name is checked again here, not only when the link was made.
    if (!validName(link.file)) return statusOf(p, 'error');
    if (await isInsideLibrary(rt.store.rootPath, link.dir)) return statusOf(p, 'error');
    const target = new ExportTarget(link.dir);
    const current = await target.read(link.file);
    if (current === null && !force) return statusOf(p, 'missing');
    if (current !== null && !force && (sha256Of(current) !== link.hash || !current.startsWith(GENERATED_LINE))) return statusOf(p, 'changed-outside');
    const { text } = await render(rt, p.members.map((m) => m.docId));
    if (current !== text) await target.write(link.file, text);
    const saved = await setLink(s, rt, id, { ...link, hash: sha256Of(text), at: new Date().toISOString() });
    return statusOf(saved, 'ok');
  } catch (e) {
    s.log.warn('writing the linked .bib file failed', { error: e });
    return statusOf(p, 'error');
  }
}

export interface LinkRequest {
  projectId: string;
  op: 'status' | 'link' | 'unlink' | 'overwrite';
  destination?: string | undefined;
  fileName?: string | undefined;
}

export async function manage(s: MainServices, req: LinkRequest): Promise<BibStatus> {
  if (req.op === 'unlink') return unlink(s, req);
  if (req.op === 'status') return status(s, req);
  if (req.op === 'overwrite') return sync(s, req.projectId, true);
  return serial(req.projectId, () => link(s, { projectId: req.projectId, destination: req.destination ?? '', fileName: req.fileName ?? '' }));
}

async function link(s: MainServices, req: { projectId: string; destination: string; fileName: string }): Promise<BibStatus> {
  const rt = await s.runtime.require();
  const dir = s.approved.resolve(req.destination, 'export-destination');
  if (dir === null) throw new AppError('INVALID_REQUEST', 'The folder was not chosen with the folder dialog', { reason: 'destination-not-approved' });
  const name = req.fileName.trim().replace(/(\.bib)?$/i, '.bib');
  if (!validName(name)) throw new AppError('INVALID_REQUEST', 'Not a valid file name', { reason: 'invalid-name' });
  if (await isInsideLibrary(rt.store.rootPath, dir)) throw new AppError('CONFLICT', 'The .bib file cannot be inside the library folder', { reason: 'inside-library' });
  const p = await projectOf(rt, req.projectId);
  const target = new ExportTarget(dir);
  const existing = await target.read(name);
  // A file that is not one of ours is never overwritten.
  if (existing !== null && !existing.startsWith(GENERATED_LINE)) throw new AppError('CONFLICT', 'A file with this name exists and was not written by the app', { reason: 'not-ours' });
  const { text } = await render(rt, p.members.map((m) => m.docId));
  // A new file is created exclusively; one of ours (it starts with the generated line) is replaced.
  if (existing === null) {
    if (!(await target.writeNew(name, text))) throw new AppError('CONFLICT', 'A file with this name was created meanwhile', { reason: 'not-ours' });
  } else await target.write(name, text);
  const saved = await setLink(s, rt, req.projectId, { dir, file: name, hash: sha256Of(text), at: new Date().toISOString() });
  return statusOf(saved, 'ok');
}

async function unlink(s: MainServices, req: { projectId: string }): Promise<BibStatus> {
  const rt = await s.runtime.require();
  await projectOf(rt, req.projectId);
  await setLink(s, rt, req.projectId, undefined);
  return unlinked;
}

async function status(s: MainServices, req: { projectId: string }): Promise<BibStatus> {
  const rt = await s.runtime.require();
  const p = await projectOf(rt, req.projectId);
  const l = p.bibLink;
  if (!l) return unlinked;
  try {
    const current = await new ExportTarget(l.dir).read(l.file);
    return statusOf(p, current === null ? 'missing' : sha256Of(current) === l.hash ? 'ok' : 'changed-outside');
  } catch {
    return statusOf(p, 'error');
  }
}

export const sync = (s: MainServices, projectId: string, force = false): Promise<BibStatus> =>
  serial(projectId, async () => writeLinked(s, await s.runtime.require(), projectId, force));

export async function copyBib(s: MainServices, req: { projectId?: string | undefined; docIds?: string[] | undefined }): Promise<{ count: number }> {
  const rt = await s.runtime.require();
  const ids = req.projectId !== undefined ? (await projectOf(rt, req.projectId)).members.map((m) => m.docId) : (req.docIds ?? []);
  const { text, count } = await render(rt, ids);
  if (count === 0) throw new AppError('INVALID_REQUEST', 'Nothing to copy', { reason: 'empty' });
  if (!s.clipboard) throw new AppError('INTERNAL', 'No clipboard');
  s.clipboard.writeText(text);
  return { count };
}

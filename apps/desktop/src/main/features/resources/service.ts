import { randomBytes } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError, dataPath, RESOURCE_KINDS, type ResourceKind, type ResourceView } from '@rl/core';
import { atomicWriteJson, isInside, readJsonFile, resolveInRoot, toRelativePath } from '@rl/core/node';
import { SAFE_OPEN_EXTENSIONS, openVerdict } from '../../ipc/handlers/open-policy.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { checkPublicUrl } from './guard.js';
import { loadPreview, PreviewError, type PreviewDeps } from './preview.js';

/** `<dataDir>/resources/<id>.json` (17.4.4): one small file per resource, so two devices rarely write the same file. */
const storedSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^res-[0-9a-f]{12}$/),
  kind: z.enum(RESOURCE_KINDS),
  title: z.string().max(300),
  description: z.string().max(2000).default(''),
  url: z.string().max(2048).nullable().default(null),
  path: z.string().max(1024).nullable().default(null),
  source: z.enum(['link', 'doi', 'arxiv']).default('link'),
  doi: z.string().max(300).nullable().default(null),
  arxivId: z.string().max(300).nullable().default(null),
  authors: z.array(z.string().max(300)).max(200).default([]),
  year: z.number().int().min(1000).max(3000).nullable().default(null),
  preview: z.object({ title: z.string().max(300).nullable(), description: z.string().max(600).nullable(), at: z.string().max(40) }).nullable().default(null),
  docs: z.array(z.string().max(100)).max(200).default([]),
  projects: z.array(z.string().max(100)).max(200).default([]),
  createdAt: z.string().max(40),
});
export type StoredResource = z.infer<typeof storedSchema>;

const ID_SHAPE = /^res-[0-9a-f]{12}$/;
const badId = () => new AppError('NOT_FOUND', 'Unknown resource');
const nowIso = () => new Date().toISOString();

async function dir(s: MainServices): Promise<{ dir: string; root: string; libraryId: string }> {
  const rt = await s.runtime.require();
  return { dir: path.join(rt.store.dataDir, dataPath.resources), root: rt.store.rootPath, libraryId: rt.libraryId };
}

async function readAll(d: string): Promise<StoredResource[]> {
  const names = await readdir(d).catch(() => [] as string[]);
  const out: StoredResource[] = [];
  for (const n of names) {
    if (!n.endsWith('.json') || !ID_SHAPE.test(n.slice(0, -5))) continue;
    // A damaged file (a sync conflict, a hand edit) is left alone and skipped.
    const r = await readJsonFile(path.join(d, n), storedSchema, { maxBytes: 256 * 1024 }).catch(() => null);
    if (r) out.push(r);
  }
  return out;
}

async function readOne(d: string, id: string): Promise<StoredResource> {
  if (!ID_SHAPE.test(id)) throw badId();
  return readJsonFile(path.join(d, `${id}.json`), storedSchema, { maxBytes: 256 * 1024 }).catch(() => {
    throw badId();
  });
}

const write = (d: string, r: StoredResource) => mkdir(d, { recursive: true }).then(() => atomicWriteJson(path.join(d, `${r.id}.json`), r));

async function present(root: string, rel: string | null, kind: ResourceKind): Promise<boolean> {
  if (rel === null) return true;
  try {
    const st = await stat(await resolveInRoot(root, rel));
    return kind === 'folder' ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
}

async function view(root: string, r: StoredResource): Promise<ResourceView> {
  let host: string | null = null;
  if (r.url) {
    try {
      host = new URL(r.url).hostname.replace(/^www\./, '');
    } catch {
      host = null;
    }
  }
  return { id: r.id, kind: r.kind, title: r.title, description: r.description, url: r.url, host, path: r.path, missing: !(await present(root, r.path, r.kind)), source: r.source, doi: r.doi, arxivId: r.arxivId, authors: r.authors, year: r.year, preview: r.preview, docs: r.docs, projects: r.projects, createdAt: r.createdAt };
}

export async function listResources(s: MainServices, req: { docId?: string | undefined; projectId?: string | undefined }) {
  const c = await dir(s);
  let all = await readAll(c.dir);
  if (req.docId) all = all.filter((r) => r.docs.includes(req.docId!));
  if (req.projectId) all = all.filter((r) => r.projects.includes(req.projectId!));
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { items: await Promise.all(all.slice(0, 2000).map((r) => view(c.root, r))) };
}

/** Every resource as stored (the duplicate check of the import reads them once). */
export async function allStored(s: MainServices): Promise<StoredResource[]> {
  return readAll((await dir(s)).dir);
}

/** Resources already holding a DOI or an arXiv id (versions ignored), for the duplicate check of the import. */
export async function findByIdentifier(s: MainServices, kind: 'doi' | 'arxiv', id: string): Promise<StoredResource | null> {
  const base = (x: string) => x.toLowerCase().replace(/v\d+$/, '');
  const c = await dir(s);
  return (await readAll(c.dir)).find((r) => (kind === 'doi' ? r.doi?.toLowerCase() === id.toLowerCase() : r.arxivId !== null && base(r.arxivId) === base(id))) ?? null;
}

const randomId = () => `res-${randomBytes(6).toString('hex')}`;

function hostTitle(u: URL): string {
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').slice(0, 120);
  return `${u.hostname.replace(/^www\./, '')}${last ? ` · ${last}` : ''}`;
}

export interface AddRequest {
  kind: Exclude<ResourceKind, 'reference'>;
  url?: string | undefined;
  path?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  docIds: string[];
  projectIds: string[];
}

export async function addResource(s: MainServices, req: AddRequest): Promise<ResourceView> {
  const c = await dir(s);
  const local = Boolean(req.path);
  let url: string | null = null;
  let rel: string | null = null;
  let title = req.title?.trim() ?? '';
  if (req.url && !local) {
    const v = checkPublicUrl(req.url, { allowLocal: true });
    // The address is stored and later opened by the system browser: http(s) only, no credentials. A private host is fine
    // to keep (an internal repository); only the preview, which the app itself fetches, refuses it.
    if (!v.ok) throw new AppError('INVALID_REQUEST', 'This address cannot be added', { reason: v.reason });
    url = v.url.href;
    if (title === '') title = hostTitle(v.url);
  } else if (req.path) {
    const abs = s.approved.resolve(req.path, req.kind === 'folder' ? 'resource-folder' : 'resource-file');
    if (abs === null) throw new AppError('INVALID_REQUEST', 'The path was not chosen with the file dialog', { reason: 'not-approved' });
    // Only what lies inside the library: nothing is copied, moved or changed, and the data folder stays portable.
    const root = await realpath(c.root);
    const real = await realpath(abs).catch(() => {
      throw new AppError('NOT_FOUND', 'Not found', { reason: 'missing' });
    });
    if (!isInside(root, real)) throw new AppError('INVALID_REQUEST', 'The resource must be inside the library', { reason: 'outside' });
    const st = await stat(real);
    if (req.kind === 'folder' ? !st.isDirectory() : !st.isFile()) throw new AppError('INVALID_REQUEST', 'Wrong kind of path', { reason: 'kind' });
    rel = toRelativePath(root, real);
    if (title === '') title = path.basename(real).slice(0, 200);
  } else {
    throw new AppError('INVALID_REQUEST', 'A link or a path is needed', { reason: 'empty' });
  }
  const r: StoredResource = {
    schemaVersion: 1,
    id: randomId(),
    kind: req.kind,
    title: title.slice(0, 300),
    description: (req.description ?? '').slice(0, 2000),
    url,
    path: rel,
    source: 'link',
    doi: null,
    arxivId: null,
    authors: [],
    year: null,
    preview: null,
    docs: [...new Set(req.docIds)],
    projects: [...new Set(req.projectIds)],
    createdAt: nowIso(),
  };
  await write(c.dir, r);
  s.emit('library:changed', { kind: 'documents' });
  return view(c.root, r);
}

/** Data-only entries made by the import from DOI or arXiv (status "Senza file"). */
export async function addReferences(s: MainServices, items: Array<{ kind: 'doi' | 'arxiv'; id: string; title: string | null; authors: string[]; year: number | null; doi: string | null; arxivId: string | null }>): Promise<number> {
  const c = await dir(s);
  let n = 0;
  for (const it of items) {
    const url = it.kind === 'doi' ? `https://doi.org/${it.id.split('/').map(encodeURIComponent).join('/')}` : `https://arxiv.org/abs/${encodeURIComponent(it.id).replace('%2F', '/')}`;
    await write(c.dir, {
      schemaVersion: 1,
      id: randomId(),
      kind: 'reference',
      title: (it.title ?? it.id).slice(0, 300),
      description: '',
      url,
      path: null,
      source: it.kind,
      doi: it.kind === 'doi' ? it.id : it.doi,
      arxivId: it.kind === 'arxiv' ? it.id : it.arxivId,
      authors: it.authors.slice(0, 200),
      year: it.year,
      preview: null,
      docs: [],
      projects: [],
      createdAt: nowIso(),
    });
    n++;
  }
  if (n > 0) s.emit('library:changed', { kind: 'documents' });
  return n;
}

export async function updateResource(s: MainServices, req: { id: string; title?: string | undefined; description?: string | undefined; docIds?: string[] | undefined; projectIds?: string[] | undefined }): Promise<ResourceView> {
  const c = await dir(s);
  const cur = await readOne(c.dir, req.id);
  const next: StoredResource = {
    ...cur,
    ...(req.title !== undefined && req.title.trim() !== '' ? { title: req.title.trim().slice(0, 300) } : {}),
    ...(req.description !== undefined ? { description: req.description.slice(0, 2000) } : {}),
    ...(req.docIds ? { docs: [...new Set(req.docIds)] } : {}),
    ...(req.projectIds ? { projects: [...new Set(req.projectIds)] } : {}),
  };
  await write(c.dir, next);
  s.emit('library:changed', { kind: 'documents' });
  return view(c.root, next);
}

/** Removes the record only: a linked page, file or folder is never touched. */
export async function removeResource(s: MainServices, id: string): Promise<{ ok: true }> {
  const c = await dir(s);
  await readOne(c.dir, id);
  await rm(path.join(c.dir, `${id}.json`), { force: true });
  s.emit('library:changed', { kind: 'documents' });
  return { ok: true };
}

export async function openResource(s: MainServices, id: string): Promise<{ ok: true }> {
  const c = await dir(s);
  const r = await readOne(c.dir, id);
  if (r.path !== null) {
    const abs = await resolveInRoot(c.root, r.path).catch(() => {
      throw new AppError('NOT_FOUND', 'The file is missing', { reason: 'missing' });
    });
    const st = await stat(abs).catch(() => null);
    if (!st) throw new AppError('NOT_FOUND', 'The file is missing', { reason: 'missing' });
    // A folder is shown by the system; a file goes through the same policy as the documents (no program, no script).
    if (st.isFile() && openVerdict(r.path, abs, [...SAFE_OPEN_EXTENSIONS]) !== 'ok') throw new AppError('PERMISSION_DENIED', 'This kind of file is not opened from the app');
    if (st.isDirectory() !== (r.kind === 'folder')) throw new AppError('NOT_FOUND', 'The file is missing', { reason: 'missing' });
    const err = await s.shell.openPath(abs);
    if (err) throw new AppError('IO_ERROR', 'The system could not open it');
    return { ok: true };
  }
  let u: URL;
  try {
    u = new URL(r.url ?? '');
  } catch {
    throw new AppError('PERMISSION_DENIED', 'Only http and https links open in the browser');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new AppError('PERMISSION_DENIED', 'Only http and https links open in the browser');
  await s.shell.openExternal(u.href).catch(() => {
    throw new AppError('IO_ERROR', 'The system could not open the link');
  });
  return { ok: true };
}

export async function previewResource(s: MainServices, id: string, deps?: Partial<PreviewDeps>): Promise<ResourceView> {
  const c = await dir(s);
  const r = await readOne(c.dir, id);
  if (r.url === null || r.kind === 'reference') throw new AppError('INVALID_REQUEST', 'This resource has no page to read', { reason: 'no-link' });
  try {
    const p = await loadPreview(r.url, { fetch: s.fetch ?? fetch, ...deps });
    const next: StoredResource = { ...r, preview: { title: p.title, description: p.description, at: nowIso() } };
    await write(c.dir, next);
    return view(c.root, next);
  } catch (e) {
    if (e instanceof PreviewError) throw new AppError('NETWORK_ERROR', 'The page could not be read', { reason: e.reason });
    throw e;
  }
}

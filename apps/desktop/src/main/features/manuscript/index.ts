import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, MANUSCRIPT_LIMITS, type Manuscript, type ManuscriptRef } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { realign, type Changes, type Section } from './align.js';
import { headingsHash } from './headings.js';
import { readSource } from './source.js';
import { readLocalPath, readManuscript, removeManuscript, writeLocalPath, writeManuscript } from './store.js';

/**
 * The manuscript of a project (§18.1, D-478): sections written in the app or read from a `.md`, `.tex` or `.docx` file (only read,
 * never written), what is assigned to each, and the realignment when the file changes. Loaded on demand behind the IPC handler.
 */
interface State {
  manuscript: Manuscript | null;
  file: { state: 'ok' | 'missing' | 'unreadable'; name: string; read: { files: number; total: number }; reason?: string } | null;
  changes?: Changes;
  cancelled?: boolean;
}

async function ctxOf(s: MainServices, projectId: string) {
  const rt = await s.runtime.require();
  if (!(await rt.store.projects.get(projectId))) throw new AppError('NOT_FOUND', 'Unknown project');
  return { dataDir: rt.store.dataDir, libraryId: rt.libraryId, local: s.localDataDir };
}
type Ctx = Awaited<ReturnType<typeof ctxOf>>;

const changed = (s: MainServices, projectId: string) => s.emit('library:changed', { kind: 'projects', ids: [projectId] });
const idMaker = (taken: Iterable<string>) => {
  const used = new Set(taken);
  const salt = Math.random().toString(36).slice(2, 5);
  let n = 0;
  return () => {
    let id: string;
    do id = `s${salt}${(n++).toString(36)}`.slice(0, 24);
    while (used.has(id));
    used.add(id);
    return id;
  };
};
const refKey = (r: ManuscriptRef): string => (r.kind === 'claim' ? `claim:${r.claimId}` : r.kind === 'ann' ? `ann:${r.docId}:${r.annId}` : r.kind === 'note' ? `note:${r.docId}:${r.page ?? ''}` : `${r.kind}:${r.docId}`);
const reasonOf = (e: unknown): string => {
  if (e instanceof AppError && typeof e.details?.reason === 'string') return e.details.reason;
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code.toLowerCase() : 'io';
};
const gaveUp = (e: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException | null)?.code ?? '');

/** Drops the assignments of sections that no longer exist and the vanished sections left without any. */
function tidy(m: Manuscript): Manuscript {
  const used = new Set(m.assignments.map((a) => a.sectionId));
  const sections = m.sections.filter((x) => !x.gone || used.has(x.id)).map((x, order) => ({ ...x, order }));
  const ids = new Set(sections.map((x) => x.id));
  return { ...m, sections, assignments: m.assignments.filter((a) => ids.has(a.sectionId)) };
}

/** Reads the manuscript, and the linked file again when it changed (size or date; a `.tex` always, for its includes). */
async function refresh(s: MainServices, c: Ctx, projectId: string, m: Manuscript, force = false): Promise<State> {
  const src = m.source;
  if (src.kind !== 'file') return { manuscript: m, file: null };
  const read0 = src.read ?? { files: 1, total: 1 };
  const down = (state: 'missing' | 'unreadable', reason?: string): State => ({ manuscript: m, file: { state, name: src.name, read: read0, ...(reason ? { reason } : {}) } });
  const file = await readLocalPath(c.local, c.libraryId, projectId);
  if (!file) return down('missing');
  let r;
  try {
    const st = await stat(file);
    if (!force && src.ext !== 'tex' && st.size === src.size && st.mtimeMs === src.mtimeMs) return { manuscript: m, file: { state: 'ok', name: src.name, read: read0 } };
    r = await readSource(file);
  } catch (e) {
    return gaveUp(e) ? down('missing') : down('unreadable', reasonOf(e));
  }
  const hash = headingsHash(r.headings);
  const same = hash === src.headingsHash;
  const source = { ...src, size: r.size, mtimeMs: r.mtimeMs, headingsHash: hash, read: r.read };
  if (same) {
    if (r.size !== src.size || r.mtimeMs !== src.mtimeMs || r.read.files !== read0.files || r.read.total !== read0.total) {
      const next = { ...m, source };
      await writeManuscript(c.dataDir, projectId, next);
      return { manuscript: next, file: { state: 'ok', name: src.name, read: r.read } };
    }
    return { manuscript: m, file: { state: 'ok', name: src.name, read: r.read } };
  }
  const has = new Set(m.assignments.map((a) => a.sectionId));
  const goneCount = m.sections.filter((x) => x.gone).length;
  const al = realign(m.sections, r.headings.slice(0, Math.max(0, MANUSCRIPT_LIMITS.sections - goneCount)), (id) => has.has(id), idMaker(m.sections.map((x) => x.id)));
  const next = tidy({ ...m, source, sections: al.sections });
  await writeManuscript(c.dataDir, projectId, next);
  changed(s, projectId);
  const total = al.changes.added + al.changes.renamed + al.changes.removed;
  return { manuscript: next, file: { state: 'ok', name: src.name, read: r.read }, ...(total > 0 ? { changes: al.changes } : {}) };
}

export async function getManuscript(s: MainServices, req: { projectId: string }): Promise<State> {
  const c = await ctxOf(s, req.projectId);
  const m = await readManuscript(c.dataDir, req.projectId);
  return m ? refresh(s, c, req.projectId, m) : { manuscript: null, file: null };
}

type SetSource = { kind: 'app'; sections: Array<{ id?: string | undefined; title: string; level: number }> } | { kind: 'file'; title?: string | undefined } | { kind: 'none' };

export async function setManuscript(s: MainServices, req: { projectId: string; source: SetSource }): Promise<State> {
  const c = await ctxOf(s, req.projectId);
  const { projectId } = req;
  const old = await readManuscript(c.dataDir, projectId);
  const has = new Set((old?.assignments ?? []).map((a) => a.sectionId));
  const src = req.source;
  if (src.kind === 'none') {
    await removeManuscript(c.dataDir, projectId);
    await writeLocalPath(c.local, c.libraryId, projectId, null);
    changed(s, projectId);
    return { manuscript: null, file: null };
  }
  if (src.kind === 'app') {
    const live = new Map((old?.sections ?? []).filter((x) => !x.gone).map((x) => [x.id, x]));
    const newId = idMaker((old?.sections ?? []).map((x) => x.id));
    const kept = new Set<string>();
    const sections: Section[] = src.sections.slice(0, MANUSCRIPT_LIMITS.sections).map((x, order) => {
      const id = x.id && live.has(x.id) && !kept.has(x.id) ? x.id : newId();
      kept.add(id);
      return { id, title: x.title, level: x.level, order };
    });
    for (const x of old?.sections ?? []) if ((x.gone || !kept.has(x.id)) && has.has(x.id)) sections.push({ ...x, order: 0, gone: true });
    const next = tidy({ schemaVersion: 1, source: { kind: 'app' }, sections, assignments: old?.assignments ?? [] });
    await writeManuscript(c.dataDir, projectId, next);
    await writeLocalPath(c.local, c.libraryId, projectId, null);
    changed(s, projectId);
    return { manuscript: next, file: null };
  }
  const picked = await s.pickFile('manuscript-file', src.title);
  if (!picked) return { ...(old ? await refresh(s, c, projectId, old) : { manuscript: null, file: null }), cancelled: true };
  s.approved.add(picked, 'manuscript-file');
  const r = await readSource(picked);
  const goneCount = (old?.sections ?? []).filter((x) => x.gone).length;
  const al = realign(old?.sections ?? [], r.headings.slice(0, Math.max(0, MANUSCRIPT_LIMITS.sections - goneCount)), (id) => has.has(id), idMaker((old?.sections ?? []).map((x) => x.id)));
  const name = path.basename(picked);
  const next = tidy({ schemaVersion: 1, source: { kind: 'file', name, ext: r.ext, size: r.size, mtimeMs: r.mtimeMs, headingsHash: headingsHash(r.headings), read: r.read }, sections: al.sections, assignments: old?.assignments ?? [] });
  await writeManuscript(c.dataDir, projectId, next);
  await writeLocalPath(c.local, c.libraryId, projectId, picked);
  changed(s, projectId);
  const total = al.changes.added + al.changes.renamed + al.changes.removed;
  return { manuscript: next, file: { state: 'ok', name, read: r.read }, ...(old && total > 0 ? { changes: al.changes } : {}) };
}

async function need(s: MainServices, projectId: string) {
  const c = await ctxOf(s, projectId);
  const m = await readManuscript(c.dataDir, projectId);
  if (!m) throw new AppError('NOT_FOUND', 'No manuscript in this project');
  return { c, m };
}

export async function assign(s: MainServices, req: { projectId: string; sectionId: string; refs: ManuscriptRef[]; on: boolean; origin: 'user' | 'ai' }): Promise<{ manuscript: Manuscript }> {
  const { c, m } = await need(s, req.projectId);
  const sec = m.sections.find((x) => x.id === req.sectionId);
  if (!sec || sec.gone) throw new AppError('NOT_FOUND', 'Unknown section');
  const keys = new Set(req.refs.map(refKey));
  const mine = (a: Manuscript['assignments'][number]) => a.sectionId === req.sectionId && keys.has(refKey(a.ref));
  let assignments = m.assignments;
  if (req.on) {
    const have = new Set(assignments.filter(mine).map((a) => refKey(a.ref)));
    const at = new Date().toISOString();
    const add = [...new Map(req.refs.map((r) => [refKey(r), r])).values()].filter((r) => !have.has(refKey(r))).map((ref) => ({ sectionId: req.sectionId, ref, origin: req.origin, at }));
    if (assignments.length + add.length > MANUSCRIPT_LIMITS.assignments) throw new AppError('INVALID_REQUEST', 'Too many assignments', { reason: 'limit' });
    assignments = [...assignments, ...add];
  } else assignments = assignments.filter((a) => !mine(a));
  const next = tidy({ ...m, assignments });
  await writeManuscript(c.dataDir, req.projectId, next);
  changed(s, req.projectId);
  return { manuscript: next };
}

export async function moveAssignments(s: MainServices, req: { projectId: string; from: string; to: string | null }): Promise<{ manuscript: Manuscript }> {
  const { c, m } = await need(s, req.projectId);
  if (!m.sections.some((x) => x.id === req.from)) throw new AppError('NOT_FOUND', 'Unknown section');
  if (req.to !== null) {
    const to = m.sections.find((x) => x.id === req.to);
    if (!to || to.gone || req.to === req.from) throw new AppError('INVALID_REQUEST', 'Choose another section');
  }
  const there = new Set(m.assignments.filter((a) => a.sectionId === req.to).map((a) => refKey(a.ref)));
  const assignments: Manuscript['assignments'] = [];
  for (const a of m.assignments) {
    if (a.sectionId !== req.from) assignments.push(a);
    else if (req.to !== null && !there.has(refKey(a.ref))) assignments.push({ ...a, sectionId: req.to });
  }
  const next = tidy({ ...m, assignments });
  await writeManuscript(c.dataDir, req.projectId, next);
  changed(s, req.projectId);
  return { manuscript: next };
}

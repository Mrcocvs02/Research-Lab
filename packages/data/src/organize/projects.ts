import { AppError, itemIdSchema, PROJECT_LIMITS, RevisionConflictError, type Project, type ProjectDetail } from '@rl/core';
import { slugify } from '../normalize.js';
import { clip, type DocInfo, type OrgCtx } from './common.js';

type Status = Project['status'];
type Kind = NonNullable<Project['kind']>;

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

export function countsOf(p: Project, info: ReadonlyMap<string, DocInfo>) {
  const c = { total: p.members.length, toRead: 0, reading: 0, read: 0, missing: 0 };
  for (const m of p.members) {
    const d = info.get(m.docId);
    if (!d || d.missing) c.missing++;
    else if (d.studyState === 'read') c.read++;
    else if (d.studyState === 'reading') c.reading++;
    else c.toRead++;
  }
  return c;
}

export const summaryOf = (p: Project, info: ReadonlyMap<string, DocInfo>) => ({
  id: p.id,
  kind: p.kind ?? 'project',
  name: p.name,
  description: p.description,
  status: p.status,
  revision: p.revision ?? 0,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  counts: countsOf(p, info),
});

export function detailOf(p: Project, info: ReadonlyMap<string, DocInfo>, changeId?: string): ProjectDetail {
  return {
    project: { ...summaryOf(p, info), notes: p.notes, ...(p.archivedFrom ? { archivedFrom: p.archivedFrom } : {}) },
    members: p.members.map((m) => {
      const d = info.get(m.docId);
      return {
        docId: m.docId,
        addedAt: m.addedAt,
        ...(m.note !== undefined ? { note: m.note } : {}),
        known: d !== undefined,
        missing: d?.missing ?? true,
        title: d?.title ?? null,
        authors: d?.authors ?? [],
        year: d?.year ?? null,
        path: d?.path ?? null,
        studyState: d?.studyState ?? null,
      };
    }),
    readingPlan: [...p.readingPlan]
      .sort((a, b) => a.order - b.order)
      .map((i) => {
        const d = info.get(i.docId);
        return {
          docId: i.docId,
          order: i.order,
          // The reading state is the document's own (single source); a `status` stored by an older version is ignored.
          ...(d ? { status: d.studyState } : {}),
          ...(i.due ? { due: i.due } : {}),
          ...(i.note !== undefined ? { note: i.note } : {}),
          studyState: d?.studyState ?? null,
          title: d?.title ?? null,
          missing: d?.missing ?? true,
        };
      }),
    ...(changeId ? { changeId } : {}),
  };
}

export interface ProjectResult {
  detail: ProjectDetail;
  /** Null when nothing changed (nothing was written or logged). */
  changeId: string | null;
}

/** Projects and collections: one JSON file each, every change logged with before/after and undoable. */
export class ProjectService {
  constructor(private readonly c: OrgCtx) {}

  private async infoMap(): Promise<Map<string, DocInfo>> {
    return new Map((await this.c.docInfos()).map((d) => [d.id, d]));
  }

  private async load(id: string): Promise<Project> {
    const p = await this.c.store.projects.get(id);
    if (!p) throw new AppError('NOT_FOUND', 'Unknown project', { id });
    return p;
  }

  private async requireDocs(ids: readonly string[]): Promise<Map<string, DocInfo>> {
    const info = await this.infoMap();
    const unknown = ids.filter((i) => !info.has(i));
    if (unknown.length > 0) throw new AppError('NOT_FOUND', 'Unknown document', { docIds: unknown.slice(0, 20), count: unknown.length });
    return info;
  }

  /** Runs one logged write of a project; `change` builds the next version from the current one. */
  private async write(id: string, summary: string, change: (cur: Project) => Project | null, expectedRevision?: number): Promise<ProjectResult> {
    const cur0 = await this.load(id);
    if (expectedRevision !== undefined && (cur0.revision ?? 0) !== expectedRevision) throw new RevisionConflictError('project', expectedRevision, cur0.revision ?? 0);
    // Nothing to change: no write (a write would bump the revision) and nothing logged.
    if (change(cur0) === null) return { detail: detailOf(cur0, await this.infoMap()), changeId: null };
    const changeId = this.c.newChangeId();
    const store = this.c.store.withChange({ changeId, summary });
    let changed = false;
    const next = await store.projects.update(id, (cur) => {
      if (!cur) throw new AppError('NOT_FOUND', 'Unknown project', { id });
      if (expectedRevision !== undefined && (cur.revision ?? 0) !== expectedRevision) throw new RevisionConflictError('project', expectedRevision, cur.revision ?? 0);
      const n = change(cur);
      if (n === null) return cur;
      changed = true;
      return { ...n, updatedAt: this.c.now().toISOString() };
    });
    if (changed) this.c.invalidate();
    return { detail: detailOf(next, await this.infoMap(), changed ? changeId : undefined), changeId: changed ? changeId : null };
  }

  async list(q: { kind?: Kind; status?: Status; includeArchived?: boolean }) {
    const info = await this.infoMap();
    const all = await this.c.store.projects.list();
    return all
      .filter((p) => (q.kind === undefined || (p.kind ?? 'project') === q.kind) && (q.status === undefined ? q.includeArchived === true || p.status !== 'archived' : p.status === q.status))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.name.localeCompare(b.name)))
      .map((p) => summaryOf(p, info));
  }

  /** Ids of the projects (archived included) that have one of `docIds` as a member. */
  async containing(docIds: readonly string[]): Promise<string[]> {
    if (docIds.length === 0) return [];
    const wanted = new Set(docIds);
    return (await this.c.store.projects.list()).filter((p) => p.members.some((m) => wanted.has(m.docId))).map((p) => p.id);
  }

  async get(id: string): Promise<ProjectDetail> {
    return detailOf(await this.load(id), await this.infoMap());
  }

  async create(input: { id?: string; kind?: Kind; name: string; description?: string; notes?: string; status?: Status; docIds?: string[] }): Promise<ProjectResult> {
    const taken = new Set(await this.c.store.projects.listIds());
    if (input.id !== undefined && taken.has(input.id)) throw new AppError('ALREADY_EXISTS', 'A project with this id exists', { id: input.id });
    let base = slugify(input.name);
    if (!itemIdSchema.safeParse(base).success) base = `p-${base}`;
    let id = input.id ?? base;
    for (let i = 2; input.id === undefined && (taken.has(id) || !itemIdSchema.safeParse(id).success); i++) id = `${base.slice(0, 120)}-${i}`;
    const docIds = uniq(input.docIds ?? []);
    if (docIds.length > PROJECT_LIMITS.members) throw new AppError('INVALID_REQUEST', 'Too many members');
    await this.requireDocs(docIds);
    const now = this.c.now().toISOString();
    const changeId = this.c.newChangeId();
    const project: Project = {
      schemaVersion: 1,
      id,
      revision: 0,
      kind: input.kind ?? 'project',
      name: input.name,
      description: input.description ?? '',
      status: input.status ?? 'active',
      members: docIds.map((docId) => ({ docId, addedAt: now })),
      notes: input.notes ?? '',
      readingPlan: [],
      createdAt: now,
      updatedAt: now,
    };
    const written = await this.c.store.withChange({ changeId, summary: clip(`Create ${project.kind}: ${input.name}`) }).projects.put(project);
    this.c.invalidate();
    return { detail: detailOf(written, await this.infoMap(), changeId), changeId };
  }

  update(id: string, patch: { kind?: Kind; name?: string; description?: string; notes?: string; status?: Status }, expectedRevision?: number): Promise<ProjectResult> {
    const label = Object.keys(patch).join(', ');
    return this.write(
      id,
      clip(`Update project (${label})`),
      (cur) => {
        const next: Project = { ...cur };
        if (patch.kind !== undefined) next.kind = patch.kind;
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.description !== undefined) next.description = patch.description;
        if (patch.notes !== undefined) next.notes = patch.notes;
        if (patch.status !== undefined && patch.status !== cur.status) {
          next.status = patch.status;
          if (patch.status === 'archived') next.archivedFrom = cur.status;
          else delete next.archivedFrom;
        }
        return JSON.stringify(next) === JSON.stringify(cur) ? null : next;
      },
      expectedRevision,
    );
  }

  /** "Delete" = archive: the file stays, status `archived`, the previous status is kept for `restore`. */
  archive(id: string): Promise<ProjectResult> {
    return this.write(id, 'Archive project', (cur) => (cur.status === 'archived' ? null : { ...cur, status: 'archived', archivedFrom: cur.status }));
  }

  restore(id: string): Promise<ProjectResult> {
    return this.write(id, 'Restore project', (cur) => {
      if (cur.status !== 'archived') return null;
      const { archivedFrom, ...rest } = cur;
      return { ...rest, status: archivedFrom && archivedFrom !== 'archived' ? archivedFrom : 'active' };
    });
  }

  async addMembers(id: string, docIds: string[], note?: string): Promise<ProjectResult> {
    const ids = uniq(docIds);
    await this.requireDocs(ids);
    const now = this.c.now().toISOString();
    return this.write(id, clip(`Add ${ids.length} document(s) to a project`), (cur) => {
      const have = new Set(cur.members.map((m) => m.docId));
      const added = ids.filter((d) => !have.has(d));
      if (added.length === 0) return null;
      if (cur.members.length + added.length > PROJECT_LIMITS.members) throw new AppError('INVALID_REQUEST', 'Too many members');
      return { ...cur, members: [...cur.members, ...added.map((docId) => ({ docId, addedAt: now, ...(note !== undefined ? { note } : {}) }))] };
    });
  }

  removeMembers(id: string, docIds: string[]): Promise<ProjectResult> {
    const drop = new Set(docIds);
    return this.write(id, clip(`Remove ${drop.size} document(s) from a project`), (cur) => {
      if (!cur.members.some((m) => drop.has(m.docId)) && !cur.readingPlan.some((i) => drop.has(i.docId))) return null;
      return { ...cur, members: cur.members.filter((m) => !drop.has(m.docId)), readingPlan: cur.readingPlan.filter((i) => !drop.has(i.docId)) };
    });
  }

  setReadingPlan(id: string, items: Project['readingPlan'], expectedRevision?: number): Promise<ProjectResult> {
    return this.write(
      id,
      clip(`Set reading plan (${items.length} item(s))`),
      (cur) => {
        const members = new Set(cur.members.map((m) => m.docId));
        const seen = new Set<string>();
        for (const i of items) {
          if (!members.has(i.docId)) throw new AppError('INVALID_REQUEST', 'A reading plan item is not a member of the project', { docId: i.docId });
          if (seen.has(i.docId)) throw new AppError('INVALID_REQUEST', 'A document appears twice in the reading plan', { docId: i.docId });
          seen.add(i.docId);
        }
        // `status` per item is deprecated: accepted, never stored (the state of a document is `study.state`).
        const plan = items.map(({ status: _deprecated, ...i }, n) => ({ n, i })).sort((a, b) => a.i.order - b.i.order || a.n - b.n).map(({ i }) => i);
        return JSON.stringify(plan) === JSON.stringify(cur.readingPlan) ? null : { ...cur, readingPlan: plan };
      },
      expectedRevision,
    );
  }
}

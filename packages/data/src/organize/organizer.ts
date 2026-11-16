import { randomUUID } from 'node:crypto';
import {
  AppError,
  RevisionConflictError,
  type DocumentPatch,
  type DocumentRecord,
  type ProjectDetail,
  type TaxonomyOp,
  type TaxonomyView,
  type Project,
} from '@rl/core';
import { canonical } from '../store.js';
import { clip, inChunks, toInfo, type DocInfo, type OrgCtx, type OrganizerStore } from './common.js';
import { HistoryService, type HistoryItem, type HistoryResult } from './history.js';
import { ProjectService, type ProjectResult } from './projects.js';
import { applyTaxonomyOps } from './taxonomy-ops.js';
import { affectedNodeIds, buildTaxonomyView, docsWithAnyTag } from './taxonomy-view.js';

export type { DocInfo, OrganizerStore } from './common.js';

export interface OrganizerDeps {
  store: OrganizerStore;
  /** This installation (history `mine`, default undo target). */
  deviceId: string;
  now?: () => Date;
  newChangeId?: () => string;
  /** How long the compact document list is reused (ms, default 1500; own writes always invalidate it). */
  cacheTtlMs?: number;
}

/** Every operation reports what it touched so the caller can refresh the search index and the interface. */
export interface Touched {
  /** Documents whose index entry must be refreshed. */
  reindex: string[];
}

export interface FolderNode {
  path: string;
  name: string;
  parent: string | null;
  depth: number;
  direct: number;
  total: number;
}

/** Records read at once when a bulk change looks for the documents it affects. */
const READ_CHUNK = 32;

const DOCUMENT_FIELD_KEYS = ['title', 'authors', 'year', 'type', 'ref', 'doi', 'arxivId', 'userDescription', 'study', 'extracted'] as const;
const EXTRACTABLE = ['title', 'authors', 'year', 'doi', 'arxivId'] as const;

const nonEmpty = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};
const cleanDoiInput = (s: string | null | undefined): string | null => {
  const t = nonEmpty(s);
  return t ? t.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '') : null;
};

/** The record after applying a patch of user-owned fields. Pure. */
export function patchDocument(cur: DocumentRecord, patch: DocumentPatch, taxonomy: { documentTypes: Array<{ id: string }>; venues: Array<{ id: string }> }, now: string): DocumentRecord {
  const next: DocumentRecord = { ...cur, ref: { ...cur.ref }, study: { ...cur.study, underlined: { ...cur.study.underlined } } };
  if (patch.title !== undefined) next.title = nonEmpty(patch.title);
  if (patch.authors !== undefined) next.authors = patch.authors.map((a) => a.trim()).filter(Boolean);
  if (patch.year !== undefined) next.year = patch.year;
  if (patch.type !== undefined) {
    if (patch.type !== null && !taxonomy.documentTypes.some((t) => t.id === patch.type)) throw new AppError('NOT_FOUND', 'Unknown document type', { type: patch.type });
    next.type = patch.type;
  }
  if (patch.venue !== undefined) {
    const v = nonEmpty(patch.venue);
    if (v === null) delete next.ref.venue;
    else next.ref.venue = v;
  }
  if (patch.venueId !== undefined) {
    if (patch.venueId !== null && !taxonomy.venues.some((v) => v.id === patch.venueId)) throw new AppError('NOT_FOUND', 'Unknown venue', { venueId: patch.venueId });
    if (patch.venueId === null) delete next.ref.venueId;
    else next.ref.venueId = patch.venueId;
  }
  if (patch.venueRef !== undefined) {
    const v = nonEmpty(patch.venueRef);
    if (v === null) delete next.ref.venueRef;
    else next.ref.venueRef = v;
  }
  if (patch.doi !== undefined) next.doi = cleanDoiInput(patch.doi);
  if (patch.arxivId !== undefined) next.arxivId = nonEmpty(patch.arxivId);
  if (patch.userDescription !== undefined) next.userDescription = patch.userDescription.trim();
  if (patch.studyState !== undefined && patch.studyState !== cur.study.state) next.study = { ...next.study, state: patch.studyState, updatedAt: now };
  if (patch.underlined !== undefined) next.study = { ...next.study, underlined: { value: patch.underlined, origin: 'manual' } };

  // A value the user sets beats the one read from the file (D-071): when the user's value equals the extracted
  // guess, the guess is dropped from `extracted`, so the field is the user's from now on and never follows the file.
  if (cur.extracted) {
    const extracted = { ...cur.extracted };
    for (const f of EXTRACTABLE) {
      if (patch[f] !== undefined && extracted[f] !== undefined && canonical(extracted[f]) === canonical(next[f])) delete extracted[f];
    }
    if (Object.keys(extracted).length === 0) delete next.extracted;
    else next.extracted = extracted;
  }
  const changed = DOCUMENT_FIELD_KEYS.some((k) => canonical(next[k] ?? (k === 'userDescription' ? '' : null)) !== canonical(cur[k] ?? (k === 'userDescription' ? '' : null)));
  return changed ? { ...next, updatedAt: now } : cur;
}

/** Organises a library: taxonomy, tags, document fields, folder tree, projects, undo/redo. All mutations run one at a time. */
export class Organizer {
  private readonly ctx: OrgCtx;
  private readonly projects: ProjectService;
  private readonly history!: HistoryService;
  private chain: Promise<unknown> = Promise.resolve();
  private cache: { at: number; infos: DocInfo[] } | null = null;
  private readonly ttl: number;

  constructor(private readonly d: OrganizerDeps) {
    this.ttl = d.cacheTtlMs ?? 1500;
    this.ctx = {
      store: d.store,
      deviceId: d.deviceId,
      now: d.now ?? (() => new Date()),
      newChangeId: d.newChangeId ?? (() => `chg-${randomUUID().replace(/-/g, '').slice(0, 24)}`),
      docInfos: (fresh) => this.docInfos(fresh),
      invalidate: () => {
        this.cache = null;
        this.history?.invalidate();
      },
    };
    this.projects = new ProjectService(this.ctx);
    this.history = new HistoryService(this.ctx);
  }

  /**
   * Drops the reused document list. For whoever writes records without going through this class (the scanner, an
   * import): the next read lists the store again.
   */
  invalidate(): void {
    this.cache = null;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async docInfos(fresh = false): Promise<DocInfo[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < this.ttl) return this.cache.infos;
    const infos = (await this.d.store.documents.list()).map(toInfo);
    this.cache = { at: Date.now(), infos };
    return infos;
  }

  /* ------------------------------ taxonomy ------------------------------ */

  async taxonomy(): Promise<TaxonomyView> {
    return buildTaxonomyView(await this.d.store.readTaxonomy(), await this.docInfos());
  }

  applyTaxonomy(ops: readonly TaxonomyOp[], expectedRevision?: number): Promise<{ taxonomy: TaxonomyView; changeId: string; created: Array<{ index: number; id: string }>; documentsChanged: number } & Touched> {
    return this.run(async () => {
      const store = this.d.store;
      const before = await store.readTaxonomy();
      if (expectedRevision !== undefined && before.revision !== expectedRevision) throw new RevisionConflictError('taxonomy', expectedRevision, before.revision);
      const infos = await this.docInfos(true);
      const usage = new Map<string, number>();
      for (const d of infos) for (const t of new Set(d.tags)) usage.set(t, (usage.get(t) ?? 0) + 1);
      const { taxonomy: next, created, redirects } = applyTaxonomyOps(before, ops, usage, this.ctx.now().toISOString());

      const changeId = this.ctx.newChangeId();
      const cs = store.withChange({ changeId, summary: describeOps(before, ops) });
      const resolve = (t: string): string => {
        let x = t;
        for (let i = 0; i < 1000 && redirects.has(x); i++) x = redirects.get(x) as string;
        return x;
      };
      const retag = infos.filter((d) => d.tags.some((t) => redirects.has(t)));
      const now = this.ctx.now().toISOString();
      // Documents first, the taxonomy last (an interruption in between leaves documents on the surviving node), and
      // all or nothing: the document writes are not credited to the change yet (the plain store; its entries carry
      // no change id and are not part of any undoable change). If the taxonomy cannot be written (somebody else changed
      // it) or a document cannot be written, the documents already changed go back to their tags, and only when the
      // whole operation succeeded are the document changes logged as part of this change.
      const written = new Map<string, { from: string[]; to: string[] }>();
      try {
        await inChunks(retag, 8, async (d) => {
          await store.documents.update(d.id, (cur) => {
            if (!cur) throw new AppError('NOT_FOUND', 'Unknown document', { docId: d.id });
            const tags = [...new Set(cur.tags.map(resolve))];
            written.set(d.id, { from: cur.tags, to: tags });
            return { ...cur, tags, updatedAt: now };
          });
        });
        await cs.writeTaxonomy(next, { expectedRevision: before.revision });
      } catch (e) {
        await inChunks([...written], 8, async ([id, w]) => {
          await store.documents
            .update(id, (cur) => (cur && canonical(cur.tags) === canonical(w.to) ? { ...cur, tags: w.from, updatedAt: now } : (cur as DocumentRecord)))
            .catch(() => undefined);
        });
        this.ctx.invalidate();
        throw e;
      }
      for (const [id, w] of written) {
        await cs.appendLog({ type: 'change', at: now, deviceId: this.ctx.deviceId, actor: 'user', target: { kind: 'document', id }, action: 'tags.update', before: { tags: w.from }, after: { tags: w.to } });
      }
      this.ctx.invalidate();

      const after = await store.readTaxonomy();
      const retagged = new Set(retag.map((d) => d.id));
      const fresh = await this.docInfos(true);
      const reindex = new Set<string>([...retagged, ...docsWithAnyTag(fresh, affectedNodeIds(before, after))]);
      return { taxonomy: buildTaxonomyView(after, fresh), changeId, created, documentsChanged: retag.length, reindex: [...reindex] };
    });
  }

  /* ------------------------------ documents ------------------------------ */

  updateDocument(docId: string, patch: DocumentPatch, expectedRevision?: number): Promise<{ record: DocumentRecord; changeId: string } & Touched> {
    return this.run(async () => {
      const store = this.d.store;
      const tax = await store.readTaxonomy();
      const cur = await store.documents.get(docId);
      if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
      if (expectedRevision !== undefined && cur.revision !== expectedRevision) throw new RevisionConflictError('document', expectedRevision, cur.revision);
      const now = this.ctx.now().toISOString();
      const changeId = this.ctx.newChangeId();
      // Validates (unknown type/venue) before anything is written; nothing changes -> nothing is written.
      if (patchDocument(cur, patch, tax, now) === cur) return { record: cur, changeId, reindex: [] };
      const cs = store.withChange({ changeId, summary: clip(`Edit document (${Object.keys(patch).join(', ')})`) });
      const record = await cs.documents.update(docId, (c) => {
        if (!c) throw new AppError('NOT_FOUND', 'Unknown document');
        if (expectedRevision !== undefined && c.revision !== expectedRevision) throw new RevisionConflictError('document', expectedRevision, c.revision);
        return patchDocument(c, patch, tax, now);
      });
      this.ctx.invalidate();
      return { record, changeId, reindex: [docId] };
    });
  }

  tagDocuments(docIds: readonly string[], add: readonly string[] = [], remove: readonly string[] = []): Promise<{ changeId: string | null; changed: number; unchanged: number } & Touched> {
    return this.run(async () => {
      const store = this.d.store;
      const ids = [...new Set(docIds)];
      const addSet = [...new Set(add)];
      const removeSet = new Set(remove);
      if (addSet.some((t) => removeSet.has(t))) throw new AppError('INVALID_REQUEST', 'A tag cannot be added and removed in the same request');
      const tax = await store.readTaxonomy();
      const byId = new Map(tax.nodes.map((n) => [n.id, n]));
      for (const t of addSet) {
        const n = byId.get(t);
        if (!n) throw new AppError('NOT_FOUND', 'Unknown tag', { tag: t });
        if (n.status === 'deprecated') throw new AppError('INVALID_REQUEST', 'A deprecated tag cannot be added', { tag: t });
      }
      const known = new Set(await store.documents.listIds());
      const unknown = ids.filter((i) => !known.has(i));
      if (unknown.length > 0) throw new AppError('NOT_FOUND', 'Unknown document', { docIds: unknown.slice(0, 20), count: unknown.length });

      const compute = (tags: readonly string[]): string[] => {
        const kept = tags.filter((t) => !removeSet.has(t));
        for (const t of addSet) if (!kept.includes(t)) kept.push(t);
        return kept;
      };
      // Which documents would change: the selection is read a few records at a time and only ids are kept, so a
      // selection of tens of thousands of documents never holds their records (nor the whole library) in memory (D-178).
      const todo: string[] = [];
      for (let i = 0; i < ids.length; i += READ_CHUNK) {
        const part = ids.slice(i, i + READ_CHUNK);
        const recs = await Promise.all(part.map((id) => store.documents.get(id)));
        part.forEach((id, k) => {
          const tags = recs[k]?.tags ?? [];
          if (canonical(compute(tags)) !== canonical(tags)) todo.push(id);
        });
      }
      if (todo.length === 0) return { changeId: null, changed: 0, unchanged: ids.length, reindex: [] };

      const name = (t: string) => byId.get(t)?.label ?? t;
      const parts = [addSet.length ? `+${addSet.map(name).join(', ')}` : '', removeSet.size ? `-${[...removeSet].map(name).join(', ')}` : ''].filter(Boolean).join(' ');
      const changeId = this.ctx.newChangeId();
      const cs = store.withChange({ changeId, summary: clip(`Tags on ${todo.length} document(s): ${parts}`) });
      const now = this.ctx.now().toISOString();
      let changed = 0;
      await inChunks(todo, 8, async (id) => {
        await cs.documents.update(id, (cur) => {
          if (!cur) throw new AppError('NOT_FOUND', 'Unknown document', { docId: id });
          const tags = compute(cur.tags);
          if (canonical(tags) === canonical(cur.tags)) return cur;
          changed++;
          return { ...cur, tags, updatedAt: now };
        });
      });
      this.ctx.invalidate();
      return { changeId, changed, unchanged: ids.length - changed, reindex: todo };
    });
  }

  /* ------------------------------ folder tree ------------------------------ */

  async folderTree(): Promise<{ rootDirect: number; total: number; folders: FolderNode[] }> {
    const infos = (await this.docInfos()).filter((d) => !d.missing);
    const direct = new Map<string, number>();
    const total = new Map<string, number>();
    let rootDirect = 0;
    for (const d of infos) {
      const parts = d.path.split('/').slice(0, -1);
      if (parts.length === 0) {
        rootDirect++;
        continue;
      }
      direct.set(parts.join('/'), (direct.get(parts.join('/')) ?? 0) + 1);
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        total.set(p, (total.get(p) ?? 0) + 1);
      }
    }
    const folders = [...total.keys()]
      .sort((a, b) => {
        const x = a.split('/');
        const y = b.split('/');
        for (let i = 0; i < Math.min(x.length, y.length); i++) {
          const c = (x[i] as string).localeCompare(y[i] as string, undefined, { sensitivity: 'base' }) || ((x[i] as string) < (y[i] as string) ? -1 : (x[i] as string) > (y[i] as string) ? 1 : 0);
          if (c !== 0) return c;
        }
        return x.length - y.length;
      })
      .map((path): FolderNode => {
        const parts = path.split('/');
        return { path, name: parts[parts.length - 1] as string, parent: parts.length > 1 ? parts.slice(0, -1).join('/') : null, depth: parts.length, direct: direct.get(path) ?? 0, total: total.get(path) ?? 0 };
      });
    return { rootDirect, total: infos.length, folders };
  }

  /* ------------------------------ projects ------------------------------ */

  listProjects(q: Parameters<ProjectService['list']>[0]) {
    return this.projects.list(q);
  }
  /** Projects that contain any of these documents: a change to the documents changes what those projects show. */
  projectsContaining(docIds: readonly string[]): Promise<string[]> {
    return this.projects.containing(docIds);
  }
  getProject(id: string): Promise<ProjectDetail> {
    return this.projects.get(id);
  }
  createProject(input: Parameters<ProjectService['create']>[0]): Promise<ProjectResult> {
    return this.run(() => this.projects.create(input));
  }
  updateProject(id: string, patch: Parameters<ProjectService['update']>[1], expectedRevision?: number): Promise<ProjectResult> {
    return this.run(() => this.projects.update(id, patch, expectedRevision));
  }
  archiveProject(id: string): Promise<ProjectResult> {
    return this.run(() => this.projects.archive(id));
  }
  restoreProject(id: string): Promise<ProjectResult> {
    return this.run(() => this.projects.restore(id));
  }
  addProjectMembers(id: string, docIds: string[], note?: string): Promise<ProjectResult> {
    return this.run(() => this.projects.addMembers(id, docIds, note));
  }
  removeProjectMembers(id: string, docIds: string[]): Promise<ProjectResult> {
    return this.run(() => this.projects.removeMembers(id, docIds));
  }
  setReadingPlan(id: string, items: Project['readingPlan'], expectedRevision?: number): Promise<ProjectResult> {
    return this.run(() => this.projects.setReadingPlan(id, items, expectedRevision));
  }

  /* ------------------------------ history ------------------------------ */

  listHistory(limit?: number): Promise<HistoryItem[]> {
    return this.history.list(limit);
  }
  /** The items plus `canUndo` / `canRedo`: whether `undo()` / `redo()` without an id would find something to do. */
  historyView(limit?: number): Promise<{ items: HistoryItem[]; canUndo: boolean; canRedo: boolean }> {
    return this.history.view(limit);
  }
  undo(changeId?: string): Promise<HistoryResult> {
    return this.run(() => this.history.undo(changeId));
  }
  redo(changeId?: string): Promise<HistoryResult> {
    return this.run(() => this.history.redo(changeId));
  }
}

export function createOrganizer(deps: OrganizerDeps): Organizer {
  return new Organizer(deps);
}

function describeOps(tax: { nodes: Array<{ id: string; label: string }> }, ops: readonly TaxonomyOp[]): string {
  const label = (id: string) => tax.nodes.find((n) => n.id === id)?.label ?? id;
  const parts = ops.map((op) => {
    switch (op.op) {
      case 'create':
        return `create "${op.label}"`;
      case 'rename':
        return `rename "${label(op.id)}" to "${op.label}"`;
      case 'merge':
        return `merge "${label(op.from)}" into "${label(op.into)}"`;
      case 'addType':
      case 'addVenue':
        return `${op.op} "${'label' in op ? op.label : op.name}"`;
      default:
        return `${op.op} "${label('id' in op ? op.id : '')}"`;
    }
  });
  return clip(`Taxonomy: ${parts.join('; ')}`);
}

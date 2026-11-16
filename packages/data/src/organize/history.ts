import {
  AppError,
  documentRecordSchema,
  documentTypeSchema,
  projectSchema,
  taxonomyFileSchema,
  taxonomyNodeSchema,
  venueSchema,
  type ChangeEntry,
  type DocumentRecord,
  type Project,
  type TaxonomyFile,
} from '@rl/core';
import { canonical, logValue } from '../store.js';
import { clip, inChunks, type DocInfo, type OrgCtx } from './common.js';
import { assertAcyclic } from './taxonomy-ops.js';
import { affectedNodeIds, docsWithAnyTag } from './taxonomy-view.js';

type Rec = Record<string, unknown>;

interface Group {
  changeId: string;
  /** Position in the chronological order of groups. */
  order: number;
  at: string;
  deviceId: string;
  actor: ChangeEntry['actor'];
  entries: ChangeEntry[];
  undoOf?: string;
  summary?: string;
}

export interface HistoryItem {
  changeId: string;
  at: string;
  deviceId: string;
  actor: ChangeEntry['actor'];
  kind: 'change' | 'undo' | 'redo';
  action: string;
  summary: string;
  counts: { documents: number; taxonomy: number; projects: number };
  undoable: boolean;
  undone: boolean;
  mine: boolean;
}

export interface HistoryResult {
  target: string;
  changeId: string;
  summary: string;
  documentsChanged: number;
  /** Documents whose search-index entry must be refreshed. */
  reindex: string[];
  touched: { documents: boolean; taxonomy: boolean; projects: boolean };
}

const SUPPORTED = new Set(['tags.update', 'document.fields', 'taxonomy.update', 'project.create', 'project.update', 'project.remove']);
const conflict = (what: string, details: Rec = {}) => new AppError('CONFLICT', `${what} changed since; the change cannot be reverted safely`, { conflict: 'changed', ...details });
const obj = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});

/** ---------------- pure inverses: each checks the current state against the entry's `after` ---------------- */

const sameSet = (a: unknown, b: unknown) => canonical([...(Array.isArray(a) ? a : [])].sort()) === canonical([...(Array.isArray(b) ? b : [])].sort());

/**
 * The change log is synced between devices and can be edited by hand: an entry is untrusted input. Undo only ever
 * writes the user-owned fields below (never a path, id, hash, alias path, AI field or legacy leftovers), and the
 * result is validated with the schema of the file before anything is written.
 */
const DOCUMENT_RESTORABLE = new Set<string>(['title', 'authors', 'year', 'type', 'ref', 'doi', 'arxivId', 'userDescription', 'study', 'extracted', 'tags']);
const PROJECT_RESTORABLE = new Set<string>(['kind', 'name', 'description', 'status', 'members', 'notes', 'readingPlan', 'archivedFrom']);

const invalidEntry = (what: string, details: Rec = {}) => new AppError('SCHEMA_INVALID', `A recorded change of ${what} is not valid; it cannot be reverted`, { conflict: 'invalid-entry', ...details });

function checkKeys(rec: Rec, allowed: ReadonlySet<string>, what: string): void {
  for (const key of Object.keys(rec)) if (!allowed.has(key)) throw invalidEntry(what, { field: key });
}

/** Restores the logged fields; `current` must hold exactly the logged `after` values. */
function restoreFields(current: Rec, entry: ChangeEntry, id: string, allowed: ReadonlySet<string>, what: string): void {
  const before = obj(entry.before);
  const after = obj(entry.after);
  checkKeys(before, allowed, what);
  checkKeys(after, allowed, what);
  for (const key of Object.keys(after)) {
    if (canonical(logValue(key, current[key])) !== canonical(after[key])) throw conflict('A document', { id, field: key });
  }
  for (const key of Object.keys(before)) {
    const v = before[key];
    if (v === null && (key === 'extracted' || key === 'archivedFrom')) delete current[key];
    else current[key] = v;
  }
}

export function restoreDocument(cur: DocumentRecord, entries: readonly ChangeEntry[], now: string): DocumentRecord {
  const next = structuredClone(cur) as unknown as Rec;
  for (const e of entries) {
    if (e.target.id !== undefined && e.target.id !== cur.id) throw invalidEntry('a document', { id: cur.id });
    if (e.action === 'tags.update') {
      checkKeys(obj(e.before), new Set(['tags']), 'a document');
      if (!sameSet(next['tags'], obj(e.after)['tags'])) throw conflict('The tags of a document', { id: cur.id });
      next['tags'] = obj(e.before)['tags'];
    } else restoreFields(next, e, cur.id, DOCUMENT_RESTORABLE, 'a document');
  }
  next['updatedAt'] = now;
  const parsed = documentRecordSchema.safeParse(next);
  if (!parsed.success) throw invalidEntry('a document', { id: cur.id });
  // Identity never moves: whatever the entries held, these are still the record's own.
  for (const k of ['id', 'path', 'hash', 'aliasPaths', 'ai', 'legacy'] as const) {
    if (canonical((parsed.data as unknown as Rec)[k]) !== canonical((cur as unknown as Rec)[k])) throw invalidEntry('a document', { id: cur.id, field: k });
  }
  return parsed.data;
}

export function restoreProject(cur: Project | null, entries: readonly ChangeEntry[], id: string, now: string): Project | null {
  let state: Rec | null = cur ? (structuredClone(cur) as unknown as Rec) : null;
  for (const e of entries) {
    if (e.target.id !== undefined && e.target.id !== id) throw invalidEntry('a project', { id });
    if (e.action === 'project.create') {
      const created = obj(obj(e.after)['project']);
      if (created['id'] !== id) throw invalidEntry('a project', { id });
      // Same content as when it was created (revision and timestamp aside): nothing was added or edited afterwards.
      const strip = (p: Rec) => canonical({ ...p, revision: undefined, updatedAt: undefined });
      if (state === null || strip(state) !== strip(created)) throw conflict('A project', { id });
      state = null;
    } else if (e.action === 'project.remove') {
      if (state !== null) throw conflict('A project', { id });
      const old = obj(obj(e.before)['project']);
      const ok = projectSchema.safeParse(old);
      if (!ok.success || ok.data.id !== id) throw invalidEntry('a project', { id });
      state = structuredClone(old);
    } else {
      if (state === null) throw conflict('A project', { id });
      restoreFields(state, e, id, PROJECT_RESTORABLE, 'a project');
    }
  }
  if (state === null) return null;
  state['updatedAt'] = now;
  const parsed = projectSchema.safeParse(state);
  if (!parsed.success || parsed.data.id !== id) throw invalidEntry('a project', { id });
  return parsed.data;
}

const LISTS = ['nodes', 'documentTypes', 'venues'] as const;
const ITEM_SCHEMAS = { nodes: taxonomyNodeSchema, documentTypes: documentTypeSchema, venues: venueSchema } as const;

/** What `restoreTaxonomy` needs to know about the documents to leave no orphan tag behind. */
export interface TaxonomyRestoreCheck {
  /** Documents that carry the node directly now. */
  docsWith(nodeId: string): Array<{ id: string; updatedAt: string }>;
  /** Documents this same undo restores (their tags go back to what they were before the change). */
  restoring: ReadonlySet<string>;
}

const inUse = (id: string, details: Rec = {}) => new AppError('CONFLICT', 'A tag the undo would remove is in use; the change cannot be reverted safely', { conflict: 'in-use', id, ...details });

export function restoreTaxonomy(cur: TaxonomyFile, entries: readonly ChangeEntry[], check?: TaxonomyRestoreCheck): TaxonomyFile {
  const next = structuredClone(cur);
  const readded: Array<{ id: string; at: string }> = [];
  for (const e of entries) {
    const before = obj(e.before);
    const after = obj(e.after);
    for (const key of LISTS) {
      const afterItems = obj(after[key]);
      const beforeItems = obj(before[key]);
      const list = next[key] as Array<{ id: string }>;
      for (const id of Object.keys(afterItems)) {
        const at = list.findIndex((x) => x.id === id);
        if (canonical(at >= 0 ? list[at] : null) !== canonical(afterItems[id])) throw conflict('The taxonomy', { id });
      }
      for (const id of Object.keys(afterItems)) {
        const at = list.findIndex((x) => x.id === id);
        const old = beforeItems[id];
        if (old === null || old === undefined) {
          if (at >= 0) list.splice(at, 1);
        } else {
          const parsed = ITEM_SCHEMAS[key].safeParse(old);
          if (!parsed.success || parsed.data.id !== id) throw invalidEntry('the taxonomy', { id });
          if (at >= 0) list[at] = parsed.data;
          else {
            list.push(parsed.data);
            if (key === 'nodes') readded.push({ id, at: e.at });
          }
        }
      }
    }
  }
  if (!taxonomyFileSchema.safeParse(next).success) throw invalidEntry('the taxonomy');

  // No orphan tags: a node the undo removes must be unused and unreferenced.
  const nextIds = new Set(next.nodes.map((n) => n.id));
  for (const { id } of cur.nodes) {
    if (nextIds.has(id)) continue;
    const referencedBy = next.nodes.filter((m) => m.parents.includes(id) || m.implies.includes(id)).map((m) => m.id);
    const docs = (check?.docsWith(id) ?? []).filter((d) => !check?.restoring.has(d.id));
    if (referencedBy.length > 0 || docs.length > 0) throw inUse(id, { documents: docs.length, referencedBy: referencedBy.slice(0, 20) });
  }
  // Undoing a merge brings the old node back: documents that received the surviving node since stay on it, which a
  // plain undo cannot tell apart from the ones that had it before; refuse rather than guess.
  for (const r of readded) {
    const into = cur.nodes.find((n) => n.mergedFrom?.includes(r.id));
    if (!into) continue;
    const later = (check?.docsWith(into.id) ?? []).filter((d) => !check?.restoring.has(d.id) && d.updatedAt >= r.at);
    if (later.length > 0) throw inUse(into.id, { documents: later.length, merged: r.id });
  }
  // The restored links must not close a cycle with what changed since.
  for (const field of ['parents', 'implies'] as const) {
    try {
      assertAcyclic(next.nodes, field);
    } catch (e) {
      throw new AppError('CONFLICT', 'Reverting this change would make the taxonomy circular', { conflict: 'cycle', field, ...(e instanceof AppError ? { id: e.details?.['id'] } : {}) });
    }
  }
  return next;
}

/** ------------------------------------------- the service ------------------------------------------- */

export class HistoryService {
  constructor(private readonly c: OrgCtx) {}

  private cached: { sig: string; groups: Group[] } | null = null;

  /** Drops the cached groups (after a write of ours). */
  invalidate(): void {
    this.cached = null;
  }

  /** Groups of the change log; re-read only when a log file changed (size/mtime) or this process wrote. */
  private async groups(): Promise<Group[]> {
    const sig = (await this.c.store.logSignature?.().catch(() => undefined)) ?? null;
    if (sig !== null && this.cached && this.cached.sig === sig) return this.cached.groups;
    const groups = await this.readGroups();
    this.cached = sig === null ? null : { sig, groups };
    return groups;
  }

  private async readGroups(): Promise<Group[]> {
    const entries = (await this.c.store.readLog({ type: 'change' })).filter((e): e is ChangeEntry => e.type === 'change' && e.changeId !== undefined);
    const byId = new Map<string, Group>();
    for (const e of entries) {
      const id = e.changeId as string;
      let g = byId.get(id);
      if (!g) {
        g = { changeId: id, order: byId.size, at: e.at, deviceId: e.deviceId, actor: e.actor, entries: [], ...(e.undoOf ? { undoOf: e.undoOf } : {}), ...(e.summary ? { summary: e.summary } : {}) };
        byId.set(id, g);
      }
      // Only one entry of a group carries the summary and `undoOf` (D-179): take them from whichever has them.
      if (e.summary && !g.summary) g.summary = e.summary;
      if (e.undoOf && !g.undoOf) g.undoOf = e.undoOf;
      g.entries.push(e);
    }
    return [...byId.values()];
  }

  /** Per group: how deep in an undo chain it is, and whether a later (still standing) undo reverted it. */
  private analyse(groups: Group[]) {
    const byId = new Map(groups.map((g) => [g.changeId, g]));
    const undoers = new Map<string, Group[]>();
    for (const g of groups) if (g.undoOf) undoers.set(g.undoOf, [...(undoers.get(g.undoOf) ?? []), g]);
    const depth = new Map<string, number>();
    const depthOf = (g: Group): number => {
      let d = 0;
      let cur: Group | undefined = g;
      for (let guard = 0; cur?.undoOf && guard < 100_000; guard++) {
        d++;
        cur = byId.get(cur.undoOf);
      }
      depth.set(g.changeId, d);
      return d;
    };
    const memo = new Map<string, boolean>();
    // Later groups first: whether X is undone only depends on groups after it.
    for (const g of [...groups].sort((a, b) => b.order - a.order)) {
      memo.set(g.changeId, (undoers.get(g.changeId) ?? []).some((x) => memo.get(x.changeId) === false));
      depthOf(g);
    }
    return { byId, undoers, depth, undone: memo };
  }

  /** Items plus what `undo` / `redo` without an id would do now (same rule, so the buttons never lie). */
  async view(limit = 50): Promise<{ items: HistoryItem[]; canUndo: boolean; canRedo: boolean }> {
    const groups = await this.groups();
    const a = this.analyse(groups);
    return { items: await this.list(limit), canUndo: this.defaultUndo(groups, a) !== undefined, canRedo: this.defaultRedo(groups, a) !== undefined };
  }

  private defaultUndo(groups: Group[], a: ReturnType<HistoryService['analyse']>): Group | undefined {
    return [...groups].reverse().find((x) => x.deviceId === this.c.deviceId && (a.depth.get(x.changeId) ?? 0) === 0 && !a.undone.get(x.changeId) && x.entries.every((e) => SUPPORTED.has(e.action)));
  }

  private defaultRedo(groups: Group[], a: ReturnType<HistoryService['analyse']>): Group | undefined {
    const lastChange = [...groups].reverse().find((x) => x.deviceId === this.c.deviceId && (a.depth.get(x.changeId) ?? 0) === 0);
    return [...groups].reverse().find((x) => x.deviceId === this.c.deviceId && (a.depth.get(x.changeId) ?? 0) === 1 && a.undone.get(x.changeId) === false && x.order > (lastChange?.order ?? -1));
  }

  async list(limit = 50): Promise<HistoryItem[]> {
    const groups = await this.groups();
    const a = this.analyse(groups);
    return [...groups]
      .sort((x, y) => y.order - x.order)
      .slice(0, limit)
      .map((g) => {
        const d = a.depth.get(g.changeId) ?? 0;
        const undone = a.undone.get(g.changeId) ?? false;
        const actions = new Set(g.entries.map((e) => e.action));
        const action = d > 0 ? (d % 2 === 1 ? 'history.undo' : 'history.redo') : actions.has('taxonomy.update') ? 'taxonomy.update' : ([...actions].find((x) => x.startsWith('project.')) ?? (actions.has('document.fields') ? 'document.fields' : (g.entries[0]?.action ?? 'unknown')));
        return {
          changeId: g.changeId,
          at: g.at,
          deviceId: g.deviceId,
          actor: g.actor,
          kind: d === 0 ? ('change' as const) : d % 2 === 1 ? ('undo' as const) : ('redo' as const),
          action,
          summary: g.summary ?? describe(g),
          counts: {
            documents: new Set(g.entries.filter((e) => e.target.kind === 'document').map((e) => e.target.id)).size,
            taxonomy: g.entries.filter((e) => e.target.kind === 'taxonomy').length,
            projects: new Set(g.entries.filter((e) => e.target.kind === 'project').map((e) => e.target.id)).size,
          },
          undoable: !undone && g.entries.every((e) => SUPPORTED.has(e.action)),
          undone,
          mine: g.deviceId === this.c.deviceId,
        };
      });
  }

  async undo(changeId?: string): Promise<HistoryResult> {
    const groups = await this.groups();
    const a = this.analyse(groups);
    let g: Group | undefined;
    if (changeId !== undefined) {
      g = a.byId.get(changeId);
      if (!g) throw new AppError('NOT_FOUND', 'Unknown change', { changeId });
      if (a.undone.get(g.changeId)) throw new AppError('CONFLICT', 'This change was already undone', { conflict: 'already-undone', changeId });
    } else {
      g = this.defaultUndo(groups, a);
      if (!g) throw new AppError('NOT_FOUND', 'Nothing to undo');
    }
    return this.revert(g, a.depth.get(g.changeId) === 0 ? 'Undo' : 'Redo');
  }

  async redo(changeId?: string): Promise<HistoryResult> {
    const groups = await this.groups();
    const a = this.analyse(groups);
    let u: Group | undefined;
    if (changeId !== undefined) {
      const g = a.byId.get(changeId);
      if (!g) throw new AppError('NOT_FOUND', 'Unknown change', { changeId });
      if (a.undone.get(g.changeId)) u = (a.undoers.get(g.changeId) ?? []).find((x) => a.undone.get(x.changeId) === false);
      else if ((a.depth.get(g.changeId) ?? 0) % 2 === 1) u = g;
    } else {
      u = this.defaultRedo(groups, a);
    }
    if (!u) throw new AppError('NOT_FOUND', 'Nothing to redo');
    const res = await this.revert(u, 'Redo');
    return { ...res, target: u.undoOf ?? u.changeId };
  }

  /** Applies the inverse of `g` as a new change group (itself undoable). Nothing is written if anything conflicts. */
  private async revert(g: Group, word: 'Undo' | 'Redo'): Promise<HistoryResult> {
    if (!g.entries.every((e) => SUPPORTED.has(e.action))) throw new AppError('INVALID_REQUEST', 'This change cannot be undone', { changeId: g.changeId });
    const now = this.c.now().toISOString();
    const entries = [...g.entries].reverse();
    const store = this.c.store;

    const docEntries = new Map<string, ChangeEntry[]>();
    const projEntries = new Map<string, ChangeEntry[]>();
    const taxEntries: ChangeEntry[] = [];
    for (const e of entries) {
      if (e.target.kind === 'document' && e.target.id) docEntries.set(e.target.id, [...(docEntries.get(e.target.id) ?? []), e]);
      else if (e.target.kind === 'project' && e.target.id) projEntries.set(e.target.id, [...(projEntries.get(e.target.id) ?? []), e]);
      else if (e.target.kind === 'taxonomy') taxEntries.push(e);
    }

    // 1. Check everything against the current state (in memory): all or nothing.
    const taxBefore = taxEntries.length > 0 ? await store.readTaxonomy() : null;
    let taxCheck: TaxonomyRestoreCheck | undefined;
    if (taxBefore) {
      const infos = await this.c.docInfos(true);
      const byNode = new Map<string, Array<{ id: string; updatedAt: string }>>();
      for (const d of infos) for (const t of new Set(d.tags)) byNode.set(t, [...(byNode.get(t) ?? []), { id: d.id, updatedAt: d.updatedAt }]);
      taxCheck = { docsWith: (id) => byNode.get(id) ?? [], restoring: new Set(docEntries.keys()) };
      restoreTaxonomy(taxBefore, taxEntries, taxCheck);
    }
    const projFinal = new Map<string, Project | null>();
    for (const [id, es] of projEntries) projFinal.set(id, restoreProject(await store.projects.get(id), es, id, now));
    const docs = [...docEntries.keys()];
    await inChunks(docs, 16, async (id) => {
      const cur = await store.documents.get(id);
      if (!cur) throw conflict('A document', { id });
      restoreDocument(cur, docEntries.get(id) as ChangeEntry[], now);
    });

    // 2. Apply, each write re-checked inside the store's queue for its file.
    const changeId = this.c.newChangeId();
    const summary = clip(`${word}: ${g.summary ?? describe(g)}`);
    const cs = store.withChange({ changeId, summary, undoOf: g.changeId });
    await inChunks(docs, 8, async (id) => {
      await cs.documents.update(id, (cur) => {
        if (!cur) throw conflict('A document', { id });
        return restoreDocument(cur, docEntries.get(id) as ChangeEntry[], now);
      });
    });
    for (const [id, es] of projEntries) {
      if (projFinal.get(id) === null) await cs.projects.remove(id);
      else await cs.projects.update(id, (cur) => restoreProject(cur, es, id, now) ?? (cur as Project));
    }
    if (taxEntries.length > 0) await cs.updateTaxonomy((cur) => restoreTaxonomy(cur, taxEntries, taxCheck));
    this.invalidate();
    this.c.invalidate();

    const reindex = new Set<string>(docs);
    if (taxBefore) {
      const taxAfter = await store.readTaxonomy();
      const infos: DocInfo[] = await this.c.docInfos(true);
      for (const id of docsWithAnyTag(infos, affectedNodeIds(taxBefore, taxAfter))) reindex.add(id);
    }
    return { target: g.changeId, changeId, summary, documentsChanged: docs.length, reindex: [...reindex], touched: { documents: docs.length > 0, taxonomy: taxEntries.length > 0, projects: projEntries.size > 0 } };
  }
}

function describe(g: Group): string {
  const n = new Set(g.entries.filter((e) => e.target.kind === 'document').map((e) => e.target.id)).size;
  const kinds = [...new Set(g.entries.map((e) => e.action))];
  if (kinds.length === 1 && kinds[0] === 'tags.update') return `Changed tags of ${n} document(s)`;
  if (kinds.length === 1 && kinds[0] === 'document.fields') return `Edited ${n} document(s)`;
  return clip(`Change (${kinds.join(', ')})`);
}

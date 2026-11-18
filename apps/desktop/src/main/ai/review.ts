import { randomUUID } from 'node:crypto';
import { tagResolver } from '@rl/ai';
import {
  AppError,
  RevisionConflictError,
  type AiNewTag,
  type DocumentId,
  type DocumentRecord,
  type ReviewField,
  type ReviewItem,
  type TaxonomyFile,
} from '@rl/core';
import { applyTaxonomyOps, type OrganizerStore } from '@rl/data';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { MainServices } from '../ipc/handlers/services.js';

/** The `document.ai` key of each reviewable field. */
export const REVIEW_KEY = {
  tags: 'suggestedTags',
  newTags: 'suggestedNewTags',
  description: 'description',
  summary: 'summary',
  keywords: 'keywords',
  synonyms: 'synonyms',
  relations: 'relations',
} as const;
export const REVIEW_FIELDS = Object.keys(REVIEW_KEY) as ReviewField[];
type Key = (typeof REVIEW_KEY)[ReviewField];

interface AnyField {
  value: unknown;
  meta: { model: string; provider: string; date: string; source: string };
  review: { status: 'proposed' | 'accepted' | 'rejected' | 'edited'; at?: string; originalValue?: unknown };
}
const fieldOf = (rec: DocumentRecord, key: Key): AnyField | undefined => (rec.ai as Record<string, AnyField | undefined>)[key];

export interface Decision {
  docId: string;
  field: ReviewField;
  decision: 'accept' | 'reject' | 'edit';
  keepTagIds?: string[] | undefined;
  keepNewTags?: Array<{ index: number; label?: string | undefined; parentId?: string | null | undefined; aliases?: string[] | undefined }> | undefined;
  text?: string | undefined;
  items?: string[] | undefined;
  expectedRevision?: number | undefined;
  /** Bulk decisions: the `meta.date` the user saw; a proposal regenerated since then is skipped (CONFLICT 'regenerated'). */
  metaDate?: string | undefined;
}

/** What one decision does, computed from the record before anything is written. */
interface Plan {
  rec: DocumentRecord;
  field: ReviewField;
  key: Key;
  before: AnyField;
  next: AnyField;
  addTagIds: string[];
  /** New nodes to create (or reuse when one with the label exists), in the order of `next.value`. */
  newNodes: AiNewTag[];
}

const invalid = (message: string, details: Record<string, unknown> = {}) => new AppError('INVALID_REQUEST', message, details);
const norm = (t: string) => t.trim().toLowerCase();

function planOne(rec: DocumentRecord, tax: TaxonomyFile, d: Decision, now: string): Plan {
  if (d.expectedRevision !== undefined && rec.revision !== d.expectedRevision) throw new RevisionConflictError('document', d.expectedRevision, rec.revision);
  const key = REVIEW_KEY[d.field];
  const before = fieldOf(rec, key);
  if (!before || before.review.status !== 'proposed') throw new AppError('CONFLICT', 'This field is not waiting for a review', { conflict: 'not-proposed', reason: 'not-proposed' });
  if (d.metaDate !== undefined && before.meta.date > d.metaDate) throw new AppError('CONFLICT', 'The proposal changed since it was listed', { conflict: 'regenerated', reason: 'regenerated' });
  const original = before.value;
  const base = { rec, field: d.field, key, before, addTagIds: [] as string[], newNodes: [] as AiNewTag[] };
  const decided = (status: 'accepted' | 'rejected' | 'edited', value: unknown, withOriginal: boolean): AnyField => ({
    ...before,
    value,
    review: { status, at: now, ...(withOriginal ? { originalValue: original } : {}) },
  });
  // Keeping no tag at all is a rejection (an `edited` field with an empty value would be a confusing record).
  if (d.decision === 'reject' || (d.field === 'tags' && d.decision === 'accept' && d.keepTagIds?.length === 0)) return { ...base, next: decided('rejected', original, false) };

  const resolve = tagResolver(tax);
  if (d.field === 'tags') {
    const proposal = original as string[];
    let kept: string[];
    if (d.decision === 'edit') {
      if (!d.items) throw invalid('Editing tags needs `items`');
      kept = d.items;
      const bad = kept.filter((t) => !resolve(t));
      if (bad.length > 0) throw invalid('Unknown or deprecated tag', { tags: bad.slice(0, 20) });
    } else {
      if (d.keepTagIds && d.keepTagIds.some((t) => !proposal.includes(t))) throw invalid('keepTagIds holds a tag that was not proposed');
      kept = d.keepTagIds ?? proposal;
    }
    const ids = [...new Set(kept.map((t) => resolve(t)).filter((t): t is string => t !== null))];
    const whole = d.decision === 'accept' && ids.length === proposal.length && ids.every((t, i) => t === proposal[i]);
    return { ...base, addTagIds: ids, next: whole ? decided('accepted', proposal, false) : decided('edited', ids, true) };
  }
  if (d.field === 'newTags') {
    if (d.decision === 'edit') throw invalid('New tags are corrected while accepting (`keepNewTags`)');
    const proposal = original as AiNewTag[];
    const chosen: NonNullable<Decision['keepNewTags']> = d.keepNewTags ?? proposal.map((_, index) => ({ index }));
    const out: AiNewTag[] = [];
    let corrected = chosen.length !== proposal.length;
    for (const c of chosen) {
      const p = proposal[c.index];
      if (!p) throw invalid('keepNewTags points to an entry that does not exist', { index: c.index });
      const label = c.label?.trim() || p.label;
      const parentId = c.parentId === undefined ? p.parentId : c.parentId;
      if (parentId !== null && !tax.nodes.some((n) => n.id === parentId && n.status !== 'deprecated')) throw invalid('The parent of a new tag does not exist', { parentId });
      const aliases = c.aliases ?? p.aliases;
      if (label !== p.label || parentId !== p.parentId || JSON.stringify(aliases) !== JSON.stringify(p.aliases)) corrected = true;
      out.push({ ...p, label, parentId, aliases });
    }
    return { ...base, newNodes: out, next: corrected ? decided('edited', out, true) : decided('accepted', proposal, false) };
  }
  if (d.decision === 'edit') {
    if (d.field === 'description' || d.field === 'summary') {
      if (d.text === undefined) throw invalid('Editing a text needs `text`');
      return { ...base, next: decided('edited', d.text, true) };
    }
    if (d.field === 'keywords' || d.field === 'synonyms') {
      if (!d.items) throw invalid('Editing a list needs `items`');
      return { ...base, next: decided('edited', d.items, true) };
    }
    throw invalid('This field cannot be edited');
  }
  return { ...base, next: decided('accepted', original, false) };
}

export interface ApplyResult {
  changeId: string | null;
  changed: number;
  failed: Array<{ docId: string; field: ReviewField; code: string; error: AppError }>;
  createdNodeIds: string[];
  documents: Map<string, DocumentRecord>;
}

/**
 * Applies decisions as ONE logged change: the taxonomy nodes the accepted new tags create (origin 'ai'), the user's tags,
 * the AI fields with their new status, and an `ai.review` entry per field, so that history undo reverts all of it.
 * `strict`: the first failure throws and nothing stays written (single decision); otherwise failures are collected.
 */
const queues = new WeakMap<object, Promise<unknown>>();

/** One decision batch at a time per library: two overlapping calls would read the same taxonomy and create duplicate nodes. */
export function applyDecisions(s: MainServices, rt: LibraryRuntime, decisions: Decision[], summary: string, strict: boolean): Promise<ApplyResult> {
  const prev = queues.get(rt.store) ?? Promise.resolve();
  const run = prev.then(() => applyNow(s, rt, decisions, summary, strict));
  queues.set(rt.store, run.catch(() => undefined));
  return run;
}

async function applyNow(s: MainServices, rt: LibraryRuntime, decisions: Decision[], summary: string, strict: boolean): Promise<ApplyResult> {
  const store = rt.store as OrganizerStore;
  const result: ApplyResult = { changeId: null, changed: 0, failed: [], createdNodeIds: [], documents: new Map() };
  const tax = await store.readTaxonomy();
  const now = new Date().toISOString();
  const plans: Plan[] = [];
  const seen = new Set<string>();
  const fail = (docId: string, field: ReviewField, e: unknown) => {
    const err = AppError.from(e);
    result.failed.push({ docId, field, code: err.code, error: err });
  };
  for (const d of decisions) {
    try {
      const k = `${d.docId}:${d.field}`;
      if (seen.has(k)) throw invalid('The same field is decided twice');
      seen.add(k);
      const rec = await store.documents.get(d.docId as DocumentId);
      if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
      plans.push(planOne(rec, tax, d, now));
    } catch (e) {
      if (strict) throw e;
      fail(d.docId, d.field, e);
    }
  }
  if (plans.length === 0) return result;

  const changeId = `chg-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const cs = store.withChange({ changeId, summary: summary.slice(0, 480) });
  const deviceId = (await s.settings.get()).deviceId;

  // 1. Taxonomy: one node per distinct label that no live node has (a deprecated node is not reused); new ones get origin 'ai'.
  const existing = new Map<string, string>();
  for (const n of tax.nodes) if (n.status !== 'deprecated') for (const t of [n.label, ...n.aliases]) existing.set(norm(t), n.id);
  const toCreate = new Map<string, AiNewTag>();
  for (const p of plans) for (const t of p.newNodes) if (!existing.has(norm(t.label)) && !toCreate.has(norm(t.label))) toCreate.set(norm(t.label), t);
  const idByLabel = new Map<string, string>(existing);
  const created = new Set<string>();
  if (toCreate.size > 0) {
    const entries = [...toCreate.entries()];
    await cs.updateTaxonomy((cur) => {
      const ops = entries.map(([, t]) => ({ op: 'create' as const, label: t.label, ...(t.parentId ? { parents: [t.parentId] } : {}), ...(t.aliases.length ? { aliases: t.aliases } : {}) }));
      const r = applyTaxonomyOps(cur, ops, new Map(), now);
      for (const c of r.created) {
        const node = r.taxonomy.nodes.find((n) => n.id === c.id);
        if (node) node.origin = 'ai';
        idByLabel.set(entries[c.index]![0], c.id);
        created.add(c.id);
      }
      return r.taxonomy;
    });
  }
  /** Removes the nodes this call created that no written document uses (no orphan nodes). */
  const dropUnused = async (used: Set<string>) => {
    const drop = new Set([...created].filter((id) => !used.has(id)));
    if (drop.size === 0) return;
    try {
      await cs.updateTaxonomy((cur) => ({ ...cur, nodes: cur.nodes.filter((n) => !drop.has(n.id)) }));
      for (const id of drop) created.delete(id);
    } catch (e) {
      s.log.warn('could not remove unused nodes after a review', { error: e });
    }
  };

  // 2. Documents: tags (the store logs them), the AI field, and the review entry. A failure here (the field was
  // regenerated or the document vanished since planning) skips that document only.
  const usedNodes = new Set<string>();
  const written: DocumentId[] = [];
  for (const p of plans) {
    const nodeIds = p.newNodes.map((t) => idByLabel.get(norm(t.label))).filter((x): x is string => x !== undefined);
    const tagIds = [...p.addTagIds, ...nodeIds];
    try {
      const recd = await cs.documents.update(p.rec.id, (cur) => {
        if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
        const f = fieldOf(cur, p.key);
        if (!f || f.review.status !== 'proposed') throw new AppError('CONFLICT', 'This field is not waiting for a review', { conflict: 'not-proposed', reason: 'not-proposed' });
        const tags = [...cur.tags];
        for (const t of tagIds) if (!tags.includes(t)) tags.push(t);
        return { ...cur, tags, ai: { ...cur.ai, [p.key]: p.next }, updatedAt: now } as DocumentRecord;
      });
      for (const n of nodeIds) usedNodes.add(n);
      await cs.appendLog({
        type: 'change',
        at: now,
        deviceId,
        actor: 'user',
        target: { kind: 'document', id: p.rec.id },
        action: 'ai.review',
        before: { ai: { [p.key]: p.before } },
        after: { ai: { [p.key]: p.next } },
      });
      result.documents.set(p.rec.id, recd);
      result.changed++;
      written.push(p.rec.id as DocumentId);
    } catch (e) {
      if (strict) {
        await dropUnused(usedNodes);
        throw e;
      }
      fail(p.rec.id, p.field, e);
    }
  }
  await dropUnused(usedNodes);
  result.createdNodeIds.push(...created);
  if (result.changed === 0 && created.size === 0) return result;
  result.changeId = changeId;
  rt.organizer.invalidate();
  const ids = [...new Set(written)];
  if (ids.length > 0) await rt.reindexDocuments(ids).catch((e: unknown) => s.log.warn('index refresh after a review failed', { error: e }));
  if (created.size > 0) s.emit('library:changed', { kind: 'taxonomy' });
  if (ids.length > 0) s.emit('library:changed', { kind: 'documents', ids: ids.slice(0, 500) });
  return result;
}

/* ---------------------------------------- queue and statistics ---------------------------------------- */

export async function listReview(
  rt: LibraryRuntime,
  q: { status: ReviewItem['status']; fields?: ReviewField[] | undefined; docIds?: string[] | undefined; limit: number; offset: number },
): Promise<{ items: ReviewItem[]; total: number }> {
  const only = q.docIds ? new Set(q.docIds) : null;
  const fields = q.fields && q.fields.length > 0 ? q.fields : REVIEW_FIELDS;
  const all: ReviewItem[] = [];
  for (const rec of await rt.store.documents.list()) {
    if (only && !only.has(rec.id)) continue;
    for (const field of fields) {
      const f = fieldOf(rec, REVIEW_KEY[field]);
      if (!f || f.review.status !== q.status) continue;
      all.push({ docId: rec.id, title: rec.title, path: rec.path, revision: rec.revision, status: f.review.status, meta: f.meta, field, value: f.value, ...(f.review.originalValue !== undefined ? { originalValue: f.review.originalValue } : {}) } as ReviewItem);
    }
  }
  all.sort((a, b) => (a.meta.date < b.meta.date ? -1 : a.meta.date > b.meta.date ? 1 : a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : a.field < b.field ? -1 : 1));
  return { items: all.slice(q.offset, q.offset + q.limit), total: all.length };
}

export async function reviewStats(rt: LibraryRuntime) {
  const pending = Object.fromEntries(REVIEW_FIELDS.map((f) => [f, 0])) as Record<ReviewField, number>;
  const tags = { proposed: 0, accepted: 0 };
  const newTags = { proposed: 0, accepted: 0 };
  let pendingDocs = 0;
  for (const rec of await rt.store.documents.list()) {
    let hasProposal = false;
    for (const field of REVIEW_FIELDS) {
      const f = fieldOf(rec, REVIEW_KEY[field]);
      if (!f) continue;
      if (f.review.status === 'proposed') {
        pending[field]++;
        hasProposal = true;
        continue;
      }
      if (field !== 'tags' && field !== 'newTags') continue;
      const target = field === 'tags' ? tags : newTags;
      const proposal = (f.review.originalValue ?? f.value) as unknown[];
      target.proposed += proposal.length;
      if (f.review.status === 'rejected') continue;
      if (field === 'tags') target.accepted += (f.value as string[]).filter((t) => proposal.includes(t)).length;
      else target.accepted += (f.value as unknown[]).length;
    }
    if (hasProposal) pendingDocs++;
  }
  return { pending, pendingDocs, tags: { ...tags, rate: tags.proposed > 0 ? tags.accepted / tags.proposed : null }, newTags };
}

import { AppError, type DocumentRecord } from '@rl/core';
import { canonical } from '../store.js';
import { clip, type OrgCtx } from './common.js';
import { livePins, type Pins } from './pins.js';

/** Retagging of many papers in one change (the Map's drag, D-522): a lazy chunk, loaded by `Organizer.retagEach` at its first use. */

/** Records read at once when looking for the papers a change affects. */
const READ_CHUNK = 32;

/** One paper of a `retagEach`: tags added and removed, and optionally its fixed main value for a family (`tag: null` clears it). */
export interface RetagItem {
  docId: string;
  add?: readonly string[] | undefined;
  remove?: readonly string[] | undefined;
  main?: { key: string; tag: string | null } | undefined;
}

/** The record after one `RetagItem` (provenance of the touched tags goes, D-494; stale fixed values go, D-521) and `cur` itself when nothing changes. Pure. */
export function retagRecord(cur: DocumentRecord, item: RetagItem, now: string): DocumentRecord {
  const rm = new Set(item.remove ?? []);
  const tags = cur.tags.filter((t) => !rm.has(t));
  for (const t of item.add ?? []) if (!tags.includes(t)) tags.push(t);
  let origin = cur.tagOrigin;
  const touched = [...rm, ...(item.add ?? [])];
  if (origin && touched.some((t) => t in (origin as object))) {
    const left = { ...origin };
    for (const t of touched) delete left[t];
    origin = Object.keys(left).length > 0 ? left : undefined;
  }
  const pins = { ...cur.mainTags };
  if (item.main) {
    if (item.main.tag === null) delete pins[item.main.key];
    else pins[item.main.key] = item.main.tag;
  }
  const mainTags = livePins(pins, tags);
  if (canonical(tags) === canonical(cur.tags) && canonical(origin ?? null) === canonical(cur.tagOrigin ?? null) && canonical(mainTags ?? null) === canonical(cur.mainTags ?? null)) return cur;
  const { tagOrigin: _o, mainTags: _m, ...rest } = cur;
  return { ...rest, tags, ...(origin ? { tagOrigin: origin } : {}), ...(mainTags ? { mainTags } : {}), updatedAt: now };
}


/**
 * Retags many papers, each with its own tags to add and remove and its own fixed main value (D-521), as ONE change (D-534).
 * Read and written a few records at a time, so 5000 papers never sit in memory; all or nothing: if a write fails, the papers already written go
 * back to what they were and the error is thrown (a record is put back only if it still holds what this change wrote). Provenance as `tagDocuments`
 * (a tag set or removed here is by hand). An undo restores tags, provenance and fixed values of every paper. Papers that would not change are not written.
 * Runs under the organizer's queue (the caller).
 */
export async function retagEach(
  ctx: OrgCtx,
  items: readonly RetagItem[],
  summary: string,
): Promise<{ changeId: string | null; changed: number; removed: string[]; already: number; reindex: string[] }> {
  const store = ctx.store;
  const byDoc = new Map(items.map((i) => [i.docId, i]));
  const byId = new Map((await store.readTaxonomy()).nodes.map((n) => [n.id, n]));
  for (const t of new Set(items.flatMap((i) => i.add ?? []))) {
    const n = byId.get(t);
    if (!n) throw new AppError('NOT_FOUND', 'Unknown tag', { tag: t });
    if (n.status === 'deprecated') throw new AppError('INVALID_REQUEST', 'A deprecated tag cannot be added', { tag: t });
  }
  const known = new Set(await store.documents.listIds());
  const unknown = [...byDoc.keys()].filter((i) => !known.has(i));
  if (unknown.length > 0) throw new AppError('NOT_FOUND', 'Unknown document', { docIds: unknown.slice(0, 20), count: unknown.length });

  const now = ctx.now().toISOString();
  const todo: RetagItem[] = [];
  const removed = new Set<string>();
  let already = 0;
  const ids = [...byDoc.keys()];
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const part = ids.slice(i, i + READ_CHUNK);
    const recs = await Promise.all(part.map((id) => store.documents.get(id)));
    part.forEach((id, k) => {
      const rec = recs[k];
      const item = byDoc.get(id) as RetagItem;
      if (!rec) return;
      if ((item.add?.length ?? 0) > 0 && (item.add ?? []).every((t) => rec.tags.includes(t))) already++;
      if (retagRecord(rec, item, now) === rec) return;
      todo.push(item);
      for (const t of item.remove ?? []) if (rec.tags.includes(t)) removed.add(t);
    });
  }
  if (todo.length === 0) return { changeId: null, changed: 0, removed: [], already, reindex: [] };

  interface Snap {
    tags: string[];
    tagOrigin: DocumentRecord['tagOrigin'];
    mainTags: Pins | undefined;
    updatedAt: string;
  }
  const snap = (r: DocumentRecord): Snap => ({ tags: r.tags, tagOrigin: r.tagOrigin, mainTags: r.mainTags, updatedAt: r.updatedAt });
  const same = (r: DocumentRecord, x: Snap): boolean => canonical(snap(r)) === canonical(x);
  const written = new Map<string, { before: Snap; after: Snap }>();
  // Chunks of 8; a chunk is awaited whole even if one write fails, so nothing is still writing when the rollback starts.
  const each = async <T>(list: readonly T[], fn: (x: T) => Promise<unknown>): Promise<unknown> => {
    let failure: unknown;
    for (let i = 0; i < list.length && failure === undefined; i += 8) {
      const res = await Promise.allSettled(list.slice(i, i + 8).map(fn));
      const bad = res.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (bad) failure = bad.reason ?? new Error('write failed');
    }
    return failure;
  };
  const changeId = ctx.newChangeId();
  const cs = store.withChange({ changeId, summary: clip(summary) });
  let failure = await each(todo, (item) =>
    store.documents.update(item.docId, (cur) => {
      if (!cur) throw new AppError('NOT_FOUND', 'Unknown document', { docId: item.docId });
      const next = retagRecord(cur, item, now);
      if (next !== cur) written.set(item.docId, { before: snap(cur), after: snap(next) });
      return next;
    }),
  );
  if (failure === undefined) {
    // Logged only after every write succeeded, like a taxonomy change: an interrupted gesture leaves no group behind.
    const entries = [...written];
    failure = await each(entries, ([id, w]) =>
      cs.appendLog({ type: 'change', at: now, deviceId: ctx.deviceId, actor: 'user', target: { kind: 'document', id }, action: 'tags.update', before: { tags: w.before.tags, tagOrigin: w.before.tagOrigin ?? null, mainTags: w.before.mainTags ?? null }, after: { tags: w.after.tags, tagOrigin: w.after.tagOrigin ?? null, mainTags: w.after.mainTags ?? null } }),
    );
  }
  if (failure !== undefined) {
    await each([...written], ([id, w]) =>
      store.documents.update(id, (cur) => {
        if (!cur || !same(cur, w.after)) return cur as DocumentRecord;
        const { tagOrigin: _o, mainTags: _m, ...rest } = cur;
        return { ...rest, tags: w.before.tags, ...(w.before.tagOrigin ? { tagOrigin: w.before.tagOrigin } : {}), ...(w.before.mainTags ? { mainTags: w.before.mainTags } : {}), updatedAt: w.before.updatedAt };
      }),
    );
    ctx.invalidate();
    throw failure;
  }
  ctx.invalidate();
  return { changeId, changed: written.size, removed: [...removed], already, reindex: [...written.keys()] };
}

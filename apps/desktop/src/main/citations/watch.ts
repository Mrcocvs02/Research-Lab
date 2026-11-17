import { randomUUID } from 'node:crypto';
import { AppError, UNSAFE_TEXT, WATCH_FILE_LIMITS, type DocumentId, type DocumentRecord, type WatchSeen, type WatchSource } from '@rl/core';
import { arxivFromDoi, findOwned, isOwn, normaliseDoi } from '@rl/citations';
import { trackAbort } from '../ai/abort-registry.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { DomainHandlers } from '../ipc/types.js';
import { online, ownedIndex, resetWatch, updateWatch, type Res } from './context.js';

type H = DomainHandlers<'watch'>;
const FIRST_CHECK_DAYS = 90;
/**
 * A check looks this far back from the last one: OpenAlex indexes a preprint days to weeks after its publication date, so
 * a window starting at the last check would never see a work dated before it but indexed after it. The seen list drops the repeats.
 */
const OVERLAP_DAYS = 14;
const DAY_MS = 86_400_000;
const PROGRESS_MS = 250;
/** Failures in a row (of sources, or of documents) after which the rest of a check is not tried. */
const BREAKER = 3;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const newCounts = (seen: WatchSeen[]) => {
  const m = new Map<string, number>();
  for (const x of seen) if (!x.dismissed) m.set(x.sourceId, (m.get(x.sourceId) ?? 0) + 1);
  return m;
};
const view = (src: WatchSource, counts: Map<string, number>) => ({ ...src, newCount: counts.get(src.id) ?? 0 });

/**
 * At most `cap` items: the surplus is taken from the source that has the most (its oldest items that are not dismissed
 * first), so one busy source cannot push out the items of the others and a dismissal stays remembered as long as possible.
 */
export function trimSeen(seen: WatchSeen[], cap: number = WATCH_FILE_LIMITS.seen): WatchSeen[] {
  let excess = seen.length - cap;
  if (excess <= 0) return seen;
  const counts = new Map<string, number>();
  for (const x of seen) counts.set(x.sourceId, (counts.get(x.sourceId) ?? 0) + 1);
  const drop = new Map<string, number>();
  for (; excess > 0; excess--) {
    let best = '';
    let most = -1;
    for (const [id, n] of counts) if (n > most) [best, most] = [id, n];
    counts.set(best, most - 1);
    drop.set(best, (drop.get(best) ?? 0) + 1);
  }
  const gone = new Set<WatchSeen>();
  const left = new Map(drop);
  const take = (ok: (x: WatchSeen) => boolean) => {
    for (const x of seen) {
      const n = left.get(x.sourceId) ?? 0;
      if (n > 0 && !gone.has(x) && ok(x)) {
        gone.add(x);
        left.set(x.sourceId, n - 1);
      }
    }
  };
  take((x) => !x.dismissed);
  take(() => true);
  return seen.filter((x) => !gone.has(x));
}

/* ------------------------------- long operations: progress, cancel ------------------------------- */

type Op = 'check' | 'checkPublished';
const running = new Map<Op, AbortController>();

/** Starts a cancellable operation (one of each kind at a time). */
function begin(s: MainServices, op: Op) {
  if (running.has(op)) throw new AppError('CONFLICT', 'This check is already running', { reason: 'already-running' });
  const t = trackAbort();
  running.set(op, t.controller);
  let last = 0;
  return {
    signal: t.controller.signal,
    progress(done: number, total: number, failed: number, force = false) {
      if (!force && Date.now() - last < PROGRESS_MS) return;
      last = Date.now();
      s.emit('watch:progress', { op, done, total, failed });
    },
    end() {
      running.delete(op);
      t.release();
    },
  };
}

export function cancelWatchOp(op: Op): { cancelled: boolean } {
  const c = running.get(op);
  if (!c) return { cancelled: false };
  c.abort();
  return { cancelled: true };
}

/** A damaged `watch.json` is set aside (`watch.json.corrupt`); the sources start empty. */
export async function resetSources(s: MainServices): Promise<{ backedUp: boolean }> {
  const rt = await s.runtime.require();
  const backedUp = await resetWatch(rt);
  s.emit('watch:changed', { newItems: 0 });
  return { backedUp };
}

const failCode = (e: unknown): string => (e instanceof AppError ? (e.details?.['reason'] === 'own-author-unknown' ? 'OWN_AUTHOR_UNKNOWN' : e.code) : 'INTERNAL');
const isNetworkFailure = (e: unknown): boolean => e instanceof AppError && e.code === 'NETWORK_ERROR';

export async function listSources(s: MainServices): Res<H['watch:list']> {
  const w = await (await s.runtime.require()).store.readWatch();
  const counts = newCounts(w.seen);
  return { sources: w.sources.map((x) => view(x, counts)) };
}

export async function saveSource(s: MainServices, req: Parameters<H['watch:saveSource']>[0]): Res<H['watch:saveSource']> {
  if (req.kind !== 'own-preprint' && !req.query) throw new AppError('INVALID_REQUEST', 'A query is needed to follow an author, a topic or a venue');
  const rt = await s.runtime.require();
  const saved = await updateWatch(rt, (w) => {
    const i = req.id ? w.sources.findIndex((x) => x.id === req.id) : -1;
    const old = i >= 0 ? w.sources[i]! : null;
    if (!old && w.sources.length >= WATCH_FILE_LIMITS.sources) throw new AppError('INVALID_REQUEST', 'Too many followed sources');
    const same = old !== null && old.kind === req.kind && old.query === req.query;
    const next: WatchSource = { id: old?.id ?? req.id ?? `src-${randomUUID().slice(0, 12)}`, kind: req.kind, query: req.query, label: req.label, enabled: req.enabled, ...(same && old.lastCheckedAt ? { lastCheckedAt: old.lastCheckedAt } : {}) };
    if (old) w.sources[i] = next;
    else w.sources.push(next);
    // Another query is another stream: what was found for the old one is dropped, and the first check looks back again.
    if (old && !same) w.seen = w.seen.filter((x) => x.sourceId !== next.id);
    return next;
  });
  s.emit('watch:changed', { newItems: 0 });
  return { ...saved, newCount: 0 };
}

export async function removeSource(s: MainServices, id: string): Promise<{ removed: boolean }> {
  const rt = await s.runtime.require();
  const removed = await updateWatch(rt, (w) => {
    const had = w.sources.some((x) => x.id === id);
    w.sources = w.sources.filter((x) => x.id !== id);
    w.seen = w.seen.filter((x) => x.sourceId !== id);
    return had;
  });
  if (removed) s.emit('watch:changed', { newItems: 0 });
  return { removed };
}

/** Looks for new works of the followed sources (only the ones asked for, or every enabled one). */
export async function checkSources(s: MainServices, req: Parameters<H['watch:check']>[0]): Res<H['watch:check']> {
  const rt = await s.runtime.require();
  const { watch, profile } = await online(s);
  const all = (await rt.store.readWatch()).sources;
  const todo = req.sourceIds ? all.filter((x) => req.sourceIds!.includes(x.id)) : all.filter((x) => x.enabled);
  const op = begin(s, 'check');
  const failed: Array<{ sourceId: string; code: string }> = [];
  let checked = 0;
  let newItems = 0;
  let streak = 0;
  let done = 0;
  try {
    for (const src of todo) {
      // Three sources in a row unreachable: the rest would fail too (and each try is a request).
      if (streak >= BREAKER) {
        failed.push({ sourceId: src.id, code: 'STOPPED' });
        op.progress(++done, todo.length, failed.length);
        continue;
      }
      const now = Date.now();
      const since = src.lastCheckedAt ? day(Date.parse(src.lastCheckedAt) - OVERLAP_DAYS * DAY_MS) : day(now - FIRST_CHECK_DAYS * DAY_MS);
      let result;
      try {
        result = await watch({ kind: src.kind, query: src.query, since, authorVariants: profile.authorVariants, ...(profile.openAlexId ? { openAlexId: profile.openAlexId } : {}) }, op.signal);
      } catch (e) {
        if (e instanceof AppError && e.code === 'CANCELLED') break;
        failed.push({ sourceId: src.id, code: failCode(e) });
        if (isNetworkFailure(e)) streak++;
        op.progress(++done, todo.length, failed.length);
        continue;
      }
      streak = 0;
      const { hits, truncated } = result;
      // More works than one check reads: the oldest were read, so the next check continues from the last one's date.
      const lastDate = truncated ? hits[hits.length - 1]?.publishedOn : undefined;
      const stamp = new Date(lastDate ? Math.min(now, Math.max(Date.parse(lastDate) + OVERLAP_DAYS * DAY_MS, (src.lastCheckedAt ? Date.parse(src.lastCheckedAt) : 0) + DAY_MS)) : now).toISOString();
      const seenAt = new Date(now).toISOString();
      const added = await updateWatch(rt, (w) => {
        const target = w.sources.find((x) => x.id === src.id);
        if (!target) return 0; // removed meanwhile
        const known = new Set(w.seen.filter((x) => x.sourceId === src.id).map((x) => x.externalId));
        const fresh: WatchSeen[] = [];
        for (const h of hits) {
          if (known.has(h.externalId)) continue;
          known.add(h.externalId);
          fresh.push({ sourceId: src.id, externalId: h.externalId, firstSeenAt: seenAt, dismissed: false, authors: h.authors, ...(h.title ? { title: h.title } : {}), ...(h.year ? { year: h.year } : {}), ...(h.doi ? { doi: h.doi } : {}), ...(h.arxivId ? { arxivId: h.arxivId } : {}), ...(h.venue ? { venue: h.venue } : {}), ...(h.publishedOn ? { publishedOn: h.publishedOn } : {}) });
        }
        target.lastCheckedAt = stamp;
        // Oldest first (the hits come oldest first): what the cap removes is the oldest of the busiest source.
        w.seen = trimSeen([...w.seen, ...fresh]);
        return fresh.length;
      });
      checked++;
      newItems += added;
      if (truncated) failed.push({ sourceId: src.id, code: 'PARTIAL' });
      op.progress(++done, todo.length, failed.length);
    }
  } finally {
    op.progress(done, todo.length, failed.length, true);
    op.end();
  }
  s.emit('watch:changed', { newItems });
  return { checked, newItems, failed };
}

export async function watchItems(s: MainServices, req: Parameters<H['watch:items']>[0]): Res<H['watch:items']> {
  const rt = await s.runtime.require();
  const w = await rt.store.readWatch();
  // The array is oldest first; reversed, and stably sorted by day found, it is newest first.
  const all = w.seen.filter((x) => (!req.sourceId || x.sourceId === req.sourceId) && (req.includeDismissed || !x.dismissed)).reverse().sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : a.firstSeenAt > b.firstSeenAt ? -1 : 0));
  const page = all.slice(req.offset, req.offset + req.limit);
  const ix = page.length > 0 ? await ownedIndex(rt) : null;
  return { total: all.length, items: page.map((x) => ({ ...x, inLibrary: ix ? ((findOwned(ix, x) as DocumentId | null) ?? null) : null })) };
}

export async function dismissItem(s: MainServices, req: { sourceId: string; externalId: string }): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  await updateWatch(rt, (w) => {
    for (const x of w.seen) if (x.sourceId === req.sourceId && x.externalId === req.externalId) x.dismissed = true;
  });
  s.emit('watch:changed', { newItems: 0 });
  return { ok: true };
}

/* ------------------------------------------ published preprints ------------------------------------------ */

const isPreprint = (d: DocumentRecord) => {
  if (d.missing || d.publication.status === 'published' || d.publication.status === 'withdrawn') return false;
  return d.publication.status === 'preprint' || Boolean(d.arxivId && (!d.doi || arxivFromDoi(d.doi)) && !d.ref.venue);
};

export async function checkPublished(s: MainServices, req: Parameters<H['watch:checkPublished']>[0]): Res<H['watch:checkPublished']> {
  const rt = await s.runtime.require();
  const { sources, profile } = await online(s);
  const only = req.docIds ? new Set<string>(req.docIds) : null;
  const all = await rt.store.documents.list();
  const docs = all.filter((d) => isPreprint(d) && (!only || only.has(d.id)) && (!req.ownOnly || isOwn(d.authors, profile.authorVariants)));
  const ix = await ownedIndex(rt, true);
  const op = begin(s, 'checkPublished');
  const proposals: Awaited<ReturnType<H['watch:checkPublished']>>['proposals'] = [];
  let failed = 0;
  let looked = 0;
  let streak = 0;
  // A source that asked to slow down is left alone for the rest of the check.
  const limited = new Set<string>();
  try {
    for (const d of docs) {
      if (streak >= BREAKER) {
        // The sources kept failing: the rest is not tried and counts as failed.
        failed += docs.length - looked;
        break;
      }
      const ref = { ...(d.doi ? { doi: d.doi } : {}), ...(d.arxivId ? { arxivId: d.arxivId } : {}), ...(d.title ? { title: d.title } : {}), ...(d.authors.length ? { authors: d.authors } : {}), ...(d.year ? { year: d.year } : {}) };
      let found = null;
      let error = false;
      let cancelled = false;
      for (const src of sources) {
        if (!src.findPublished || limited.has(src.id)) continue;
        try {
          found = await src.findPublished(ref, op.signal);
        } catch (e) {
          if (e instanceof AppError && e.code === 'CANCELLED') {
            cancelled = true;
            break;
          }
          if (e instanceof AppError && e.details?.['reason'] === 'offline') throw e;
          error = true;
          if (e instanceof AppError && e.details?.['reason'] === 'rate-limited') limited.add(src.id);
        }
        if (found) break;
      }
      if (cancelled) break;
      looked++;
      if (found && (!d.doi || normaliseDoi(d.doi) !== normaliseDoi(found.doi))) {
        // The published work may already be another document of the library: applying would duplicate its DOI.
        const ownedBy = findOwned(ix, { doi: found.doi }, d.id) as DocumentId | null;
        proposals.push({ docId: d.id, title: d.title, current: { doi: d.doi, arxivId: d.arxivId, venue: d.ref.venue ?? null, year: d.year }, found: { ...found, venue: found.venue?.slice(0, 500) ?? null }, revision: d.revision, ...(ownedBy ? { ownedBy } : {}) });
      } else if (!found && error) failed++;
      streak = !found && error ? streak + 1 : 0;
      op.progress(looked, docs.length, failed);
    }
  } finally {
    op.progress(looked, docs.length, failed, true);
    op.end();
  }
  return { checked: looked, proposals, failed };
}

export async function applyPublished(s: MainServices, req: Parameters<H['watch:applyPublished']>[0], settle: (rt: Awaited<ReturnType<MainServices['runtime']['require']>>, ids: string[]) => Promise<void>): Res<H['watch:applyPublished']> {
  const rt = await s.runtime.require();
  const { expectedRevision, docId, ...asked } = req;
  // Stored (and synced) fields are clean whatever the request carried.
  const clear = (v: string | null) => (v === null ? null : v.replace(UNSAFE_TEXT, '').trim() || null);
  const found = { ...asked, venue: clear(asked.venue), venueRef: clear(asked.venueRef) };
  // Never two documents with one DOI: the proposal was made before, and the library may have changed since.
  const other = findOwned(await ownedIndex(rt, true), { doi: found.doi }, docId);
  if (other) throw new AppError('CONFLICT', 'Another document of the library already has this DOI', { reason: 'doi-owned', docId: other });
  const r = await rt.organizer.applyPublished(docId, found, expectedRevision);
  await settle(rt, r.reindex);
  return { changeId: r.changeId, checkedAt: r.checkedAt };
}

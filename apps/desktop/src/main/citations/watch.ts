import { randomUUID } from 'node:crypto';
import { AppError, WATCH_FILE_LIMITS, type DocumentId, type DocumentRecord, type WatchSeen, type WatchSource } from '@rl/core';
import { arxivFromDoi, findOwned, lastName, normaliseDoi, titleKey } from '@rl/citations';
import { trackAbort } from '../ai/abort-registry.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { DomainHandlers } from '../ipc/types.js';
import { online, ownedIndex, updateWatch, type Res } from './context.js';

type H = DomainHandlers<'watch'>;
const FIRST_CHECK_DAYS = 90;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const newCounts = (seen: WatchSeen[]) => {
  const m = new Map<string, number>();
  for (const x of seen) if (!x.dismissed) m.set(x.sourceId, (m.get(x.sourceId) ?? 0) + 1);
  return m;
};
const view = (src: WatchSource, counts: Map<string, number>) => ({ ...src, newCount: counts.get(src.id) ?? 0 });

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
  const t = trackAbort();
  const failed: Array<{ sourceId: string; code: string }> = [];
  let checked = 0;
  let newItems = 0;
  try {
    for (const src of todo) {
      const now = Date.now();
      // One day back from the last check (the source dates are days, not instants); the seen list removes the repeats.
      const since = src.lastCheckedAt ? day(Date.parse(src.lastCheckedAt) - 86_400_000) : day(now - FIRST_CHECK_DAYS * 86_400_000);
      let hits;
      try {
        hits = await watch({ kind: src.kind, query: src.query, since, authorVariants: profile.authorVariants, ...(profile.openAlexId ? { openAlexId: profile.openAlexId } : {}) }, t.controller.signal);
      } catch (e) {
        if (e instanceof AppError && e.code === 'CANCELLED') throw e;
        failed.push({ sourceId: src.id, code: e instanceof AppError ? e.code : 'INTERNAL' });
        continue;
      }
      const stamp = new Date(now).toISOString();
      const added = await updateWatch(rt, (w) => {
        const target = w.sources.find((x) => x.id === src.id);
        if (!target) return 0; // removed meanwhile
        const known = new Set(w.seen.filter((x) => x.sourceId === src.id).map((x) => x.externalId));
        const fresh: WatchSeen[] = [];
        for (const h of hits) {
          if (known.has(h.externalId)) continue;
          known.add(h.externalId);
          fresh.push({ sourceId: src.id, externalId: h.externalId, firstSeenAt: stamp, dismissed: false, authors: h.authors, ...(h.title ? { title: h.title } : {}), ...(h.year ? { year: h.year } : {}), ...(h.doi ? { doi: h.doi } : {}), ...(h.arxivId ? { arxivId: h.arxivId } : {}), ...(h.venue ? { venue: h.venue } : {}) });
        }
        target.lastCheckedAt = stamp;
        // Oldest first: the ones beyond the cap are the oldest.
        w.seen = [...w.seen, ...fresh.reverse()].slice(-WATCH_FILE_LIMITS.seen);
        return fresh.length;
      });
      checked++;
      newItems += added;
    }
  } finally {
    t.release();
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

/** First letter of the given name in "First Last" or "Last, First". */
const initialOf = (a: string): string => titleKey(a.includes(',') ? a.slice(a.indexOf(',') + 1) : a)[0] ?? '';

/** An author is the user when it equals a variant, or has the same last name and first initial. */
const isOwn = (authors: string[], variants: readonly string[]): boolean => {
  const keys = variants.map((v) => ({ full: titleKey(v), last: lastName(v), initial: initialOf(v) })).filter((v) => v.full);
  return authors.some((a) => keys.some((v) => v.full === titleKey(a) || (v.last !== '' && v.last === lastName(a) && v.initial !== '' && v.initial === initialOf(a))));
};

const isPreprint = (d: DocumentRecord) => {
  if (d.missing || d.publication.status === 'published' || d.publication.status === 'withdrawn') return false;
  return d.publication.status === 'preprint' || Boolean(d.arxivId && (!d.doi || arxivFromDoi(d.doi)) && !d.ref.venue);
};

export async function checkPublished(s: MainServices, req: Parameters<H['watch:checkPublished']>[0]): Res<H['watch:checkPublished']> {
  const rt = await s.runtime.require();
  const { sources, profile } = await online(s);
  const only = req.docIds ? new Set<string>(req.docIds) : null;
  const docs = (await rt.store.documents.list()).filter((d) => isPreprint(d) && (!only || only.has(d.id)) && (!req.ownOnly || isOwn(d.authors, profile.authorVariants)));
  const t = trackAbort();
  const proposals: Awaited<ReturnType<H['watch:checkPublished']>>['proposals'] = [];
  let failed = 0;
  try {
    for (const d of docs) {
      const ref = { ...(d.doi ? { doi: d.doi } : {}), ...(d.arxivId ? { arxivId: d.arxivId } : {}), ...(d.title ? { title: d.title } : {}), ...(d.authors.length ? { authors: d.authors } : {}), ...(d.year ? { year: d.year } : {}) };
      let found = null;
      let error = false;
      for (const src of sources) {
        if (!src.findPublished) continue;
        try {
          found = await src.findPublished(ref, t.controller.signal);
        } catch (e) {
          if (e instanceof AppError && (e.code === 'CANCELLED' || e.details?.['reason'] === 'offline')) throw e;
          error = true;
        }
        if (found) break;
      }
      if (found && (!d.doi || normaliseDoi(d.doi) !== normaliseDoi(found.doi))) {
        proposals.push({ docId: d.id, title: d.title, current: { doi: d.doi, arxivId: d.arxivId, venue: d.ref.venue ?? null, year: d.year }, found: { ...found, venue: found.venue?.slice(0, 500) ?? null }, revision: d.revision });
      } else if (!found && error) failed++;
    }
  } finally {
    t.release();
  }
  return { checked: docs.length, proposals, failed };
}

export async function applyPublished(s: MainServices, req: Parameters<H['watch:applyPublished']>[0], settle: (rt: Awaited<ReturnType<MainServices['runtime']['require']>>, ids: string[]) => Promise<void>): Res<H['watch:applyPublished']> {
  const rt = await s.runtime.require();
  const { expectedRevision, docId, ...found } = req;
  const r = await rt.organizer.applyPublished(docId, found, expectedRevision);
  await settle(rt, r.reindex);
  return { changeId: r.changeId, checkedAt: r.checkedAt };
}

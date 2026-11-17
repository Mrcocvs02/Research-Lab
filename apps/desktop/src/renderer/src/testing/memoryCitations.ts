import { AppError } from '@rl/core';
import { emitEvent } from './mockRl';

type Handler = (payload: any) => unknown;
const NOW = '2026-11-17T10:00:00.000Z';

/** A citation edge as `citations:get` returns it (a work, with the library document it matches, if any). */
export function fakeLink(over: Record<string, unknown> = {}) {
  return { title: 'A cited work', authors: ['A. Writer'], matchedDocId: null, matched: null, source: 'openalex', checkedAt: NOW, ...over };
}

/** A `citations:get` view; `inLibrary` and `missing` follow the references unless given. */
export function fakeView(docId: string, over: Record<string, unknown> = {}) {
  const references = (over.references as any[] | undefined) ?? [];
  const inLibrary = references.filter((r) => r.matched).length;
  return { docId, fetched: true, references: [], citedBy: [], citedByCount: null, referencesCheckedAt: NOW, citedByCheckedAt: NOW, inLibrary, missing: references.length - inLibrary, ...over };
}

export const neverFetched = (docId: string) => ({ docId, fetched: false, references: [], citedBy: [], citedByCount: null, referencesCheckedAt: null, citedByCheckedAt: null, inLibrary: 0, missing: 0 });

/**
 * In-memory main process for the phase 5 channels: `citations:*`, `recommend:*` and `watch:*` (plus `citations:openExternal`). Tests read `state.*` for what was asked and set what the answers are. The fake keeps the
 * rules the UI relies on: `watch:list` counts the items not dismissed, and a source needs a query unless it follows
 * the user's own preprints.
 */
export function memoryCitations(init: { sources?: any[]; items?: any[] } = {}) {
  const state = {
    // citations
    stored: new Map<string, any>(),
    /** What a refresh of a document stores (default: a view with no links). */
    fetchable: new Map<string, any>(),
    refreshError: null as AppError | null,
    refreshed: [] as Array<{ docId: string; what?: string[] }>,
    manyStarted: [] as string[][],
    manyError: null as AppError | null,
    cancelled: [] as string[],
    // recommendations
    readNext: { items: [] as any[], documentsWithCitations: 0 },
    readNextRequests: [] as any[],
    readNextError: null as AppError | null,
    dismissedKeys: [] as string[],
    // watch
    sources: init.sources ?? ([] as any[]),
    items: init.items ?? ([] as any[]),
    saved: [] as any[],
    saveError: null as AppError | null,
    removed: [] as string[],
    checkRequests: [] as any[],
    checkResult: { checked: 0, newItems: 0, failed: [] as Array<{ sourceId: string; code: string }> },
    checkError: null as AppError | null,
    dismissedItems: [] as any[],
    published: { checked: 0, proposals: [] as any[], failed: 0 },
    publishedRequests: [] as any[],
    publishedError: null as AppError | null,
    applied: [] as any[],
    applyError: null as AppError | null,
    undone: [] as string[],
    opened: [] as Array<{ kind: string; id: string }>,
    watchCancelled: [] as string[],
    resets: 0,
    listError: null as AppError | null,
    /** When set, `watch:check` / `watch:checkPublished` wait for it (progress events, cancel, tab switches can be tried meanwhile). */
    hold: null as Promise<void> | null,
    nextId: 1,
  };

  const progress = (patch: Record<string, unknown>) => emitEvent('citations:progress', { jobId: 'job-1', state: 'running', total: 0, done: 0, failed: 0, skipped: 0, notFound: 0, ...patch });
  const newCount = (id: string) => state.items.filter((i) => i.sourceId === id && !i.dismissed).length;

  const handlers: Record<string, Handler> = {
    'citations:get': (p) => state.stored.get(p.docId) ?? neverFetched(p.docId),
    'citations:refresh': (p) => {
      state.refreshed.push(p.what ? { docId: p.docId, what: p.what } : { docId: p.docId });
      if (state.refreshError) throw state.refreshError;
      const view = state.fetchable.get(p.docId) ?? fakeView(p.docId);
      state.stored.set(p.docId, view);
      return view;
    },
    'citations:refreshMany': (p) => {
      if (state.manyError) throw state.manyError;
      state.manyStarted.push(p.docIds);
      return { jobId: 'job-1' };
    },
    'citations:cancel': (p) => {
      state.cancelled.push(p.jobId);
      return { cancelled: true };
    },
    'recommend:readNext': (p) => {
      state.readNextRequests.push(p);
      if (state.readNextError) throw state.readNextError;
      return { ...state.readNext, items: state.readNext.items.filter((i) => !state.dismissedKeys.includes(i.key)) };
    },
    'recommend:dismiss': (p) => {
      state.dismissedKeys.push(p.key);
      return { ok: true };
    },
    'watch:list': () => {
      if (state.listError) throw state.listError;
      return { sources: state.sources.map((s) => ({ ...s, newCount: newCount(s.id) })) };
    },
    'watch:saveSource': (p) => {
      if (state.saveError) throw state.saveError;
      if (p.kind !== 'own-preprint' && p.query.trim() === '') throw new AppError('INVALID_REQUEST', 'empty query');
      state.saved.push(p);
      const id = p.id ?? `src-${state.nextId++}`;
      const source = { id, kind: p.kind, query: p.query, label: p.label ?? '', enabled: p.enabled ?? true, ...(state.sources.find((s) => s.id === id)?.lastCheckedAt ? { lastCheckedAt: state.sources.find((s) => s.id === id).lastCheckedAt } : {}) };
      state.sources = state.sources.some((s) => s.id === id) ? state.sources.map((s) => (s.id === id ? source : s)) : [...state.sources, source];
      return { ...source, newCount: newCount(id) };
    },
    'watch:removeSource': (p) => {
      state.removed.push(p.id);
      const had = state.sources.some((s) => s.id === p.id);
      state.sources = state.sources.filter((s) => s.id !== p.id);
      return { removed: had };
    },
    'watch:check': async (p) => {
      state.checkRequests.push(p);
      if (state.hold) await state.hold;
      if (state.checkError) throw state.checkError;
      emitEvent('watch:changed', { newItems: state.checkResult.newItems });
      return state.checkResult;
    },
    'watch:items': (p) => {
      const all = state.items.filter((i) => (p.sourceId ? i.sourceId === p.sourceId : true) && (p.includeDismissed ? true : !i.dismissed));
      const items = all.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 100)).map((i) => ({ inLibrary: null, authors: [], dismissed: false, firstSeenAt: NOW, ...i }));
      return { items, total: all.length };
    },
    'watch:dismiss': (p) => {
      state.dismissedItems.push(p);
      for (const i of state.items) if (i.sourceId === p.sourceId && i.externalId === p.externalId) i.dismissed = true;
      emitEvent('watch:changed', { newItems: 0 });
      return { ok: true };
    },
    'watch:checkPublished': async (p) => {
      state.publishedRequests.push(p);
      if (state.hold) await state.hold;
      if (state.publishedError) throw state.publishedError;
      return state.published;
    },
    'watch:applyPublished': (p) => {
      state.applied.push(p);
      if (state.applyError) throw state.applyError;
      return { changeId: `chg-${state.nextId++}`, checkedAt: NOW };
    },
    'history:undo': (p) => {
      state.undone.push(p.changeId);
      return { summary: 'published version' };
    },
    'history:list': () => ({ items: [], canUndo: true, canRedo: false }),
    'citations:openExternal': (p) => {
      state.opened.push(p);
      return { ok: true };
    },
    'watch:cancel': (p) => {
      state.watchCancelled.push(p.op);
      return { cancelled: true };
    },
    'watch:reset': () => {
      state.resets++;
      state.sources = [];
      state.listError = null;
      return { backedUp: true };
    },
  };
  return { handlers, state, progress };
}

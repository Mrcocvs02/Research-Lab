import { useCallback, useSyncExternalStore } from 'react';
import { THUMB_LIMITS, type Channels, type ResponseOf } from '@rl/core';
import { rl } from './rl';

/**
 * Grid thumbnails, renderer side (D-195). A small store keeps what main said about the documents on screen
 * (`thumbs:list`), draws the missing ones ONE at a time and shows each `rl-thumb://` URL as soon as it exists.
 * This file has no pdf.js: the drawing code (`thumbDraw.ts`) is a dynamic import, fetched when the first image must be
 * drawn. Nothing runs unless the grid is shown (`setActive`).
 */
export type ThumbItem = ResponseOf<Channels, 'thumbs:list'>['items'][number];

export interface ThumbDeps {
  list(docIds: string[]): Promise<ThumbItem[]>;
  /** The `rl-doc://` URL and the hash of the current content. */
  open(docId: string): Promise<{ url: string; hash: string }>;
  draw(url: string): Promise<Uint8Array>;
  put(docId: string, hash: string, webp: Uint8Array): Promise<string | null>;
  /** Frees the pdf.js worker. */
  release(): void;
  onDocumentsChanged(listener: () => void): () => void;
}

export const THUMB_TIMING = { debounceMs: 150, idleMs: 30_000 } as const;
/** A drawing is tried this many times when the file keeps changing under it. */
const MAX_ATTEMPTS = 2;

interface Entry {
  url: string | null;
  drawable: boolean;
  hash: string | null;
  /** Content may have changed (library event): ask main again before trusting it. */
  stale: boolean;
}

export function createThumbStore(deps: ThumbDeps) {
  const entries = new Map<string, Entry>();
  /** Documents that could not be drawn, with the hash they failed on: not retried this session unless the file changes. */
  const failed = new Map<string, string>();
  const attempts = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  let wanted = new Set<string>();
  let pending = new Set<string>();
  let queue: string[] = [];
  let active = false;
  let running = false;
  let drawn = false;
  /** Counts activations: work of an earlier one never touches the state of a later one. */
  let epoch = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;

  const notify = (id: string) => listeners.get(id)?.forEach((l) => l());
  const isFailed = (id: string, hash: string | null) => failed.has(id) && failed.get(id) === (hash ?? '');
  const enqueue = (id: string) => {
    const e = entries.get(id);
    if (e && e.drawable && !e.url && !isFailed(id, e.hash) && !queue.includes(id)) queue.push(id);
  };

  const scheduleIdleRelease = () => {
    if (idleTimer || !drawn) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (running) return;
      drawn = false;
      deps.release();
    }, THUMB_TIMING.idleMs);
  };
  const cancelIdleRelease = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const schedule = () => {
    if (!active || pending.size === 0 || flushTimer) return;
    flushTimer = setTimeout(() => void flush(), THUMB_TIMING.debounceMs);
  };

  async function flush(): Promise<void> {
    flushTimer = null;
    const mine = epoch;
    // What scrolled away meanwhile is not asked about; it is asked again if it comes back.
    const ids = [...pending].filter((id) => wanted.has(id));
    pending = new Set();
    for (let i = 0; i < ids.length && active && mine === epoch; i += THUMB_LIMITS.batch) {
      const chunk = ids.slice(i, i + THUMB_LIMITS.batch);
      let items: ThumbItem[];
      try {
        items = await deps.list(chunk);
      } catch {
        continue; // asked again at the next scroll or event
      }
      if (!active || mine !== epoch) return;
      for (const it of items) {
        const before = entries.get(it.docId)?.url ?? null;
        entries.set(it.docId, { url: it.url, drawable: it.drawable, hash: it.hash ?? null, stale: false });
        if (before !== it.url) notify(it.docId);
        if (wanted.has(it.docId)) enqueue(it.docId);
      }
    }
    void pump();
  }

  async function pump(): Promise<void> {
    if (running || !active) return;
    running = true;
    cancelIdleRelease();
    const mine = epoch;
    try {
      while (active && mine === epoch) {
        const id = queue.shift();
        if (id === undefined) break;
        if (wanted.has(id)) await drawOne(id, mine);
      }
    } finally {
      // A newer activation owns `running` now; only the run that is current gives it back.
      if (mine === epoch) running = false;
      scheduleIdleRelease();
    }
  }

  async function drawOne(id: string, mine: number): Promise<void> {
    const entry = entries.get(id);
    if (!entry || entry.url || !entry.drawable) return;
    try {
      const opened = await deps.open(id);
      if (!active || mine !== epoch) return;
      drawn = true;
      const bytes = await deps.draw(opened.url);
      if (!active || mine !== epoch) return;
      const url = await deps.put(id, opened.hash, bytes);
      if (!active || mine !== epoch) return;
      if (url) {
        entries.set(id, { url, drawable: false, hash: opened.hash, stale: false });
        notify(id);
      } else if ((attempts.get(id) ?? 0) + 1 < MAX_ATTEMPTS) {
        // The file changed while it was drawn: ask for the new state once more.
        attempts.set(id, (attempts.get(id) ?? 0) + 1);
        entries.set(id, { ...entry, stale: true });
        pending.add(id);
        schedule();
      } else {
        failed.set(id, entry.hash ?? '');
      }
    } catch {
      // Encrypted, damaged, unreadable: the type icon stays and it is not tried again this session (until the file changes).
      failed.set(id, entry.hash ?? '');
    }
  }

  const onChanged = () => {
    // The content may have changed under any thumbnail: what is shown stays until main answers, and what is on screen is asked again.
    for (const e of entries.values()) e.stale = true;
    for (const id of wanted) pending.add(id);
    schedule();
  };

  return {
    urlOf: (id: string): string | null => entries.get(id)?.url ?? null,
    subscribe(id: string, listener: () => void): () => void {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      const mine = set;
      mine.add(listener);
      return () => {
        mine.delete(listener);
        if (mine.size === 0 && listeners.get(id) === mine) listeners.delete(id);
      };
    },
    /** The grid is shown (true) or left (false). Leaving drops the queue and the pending questions. */
    setActive(on: boolean): void {
      if (on === active) return;
      active = on;
      epoch++;
      if (on) {
        unsubscribe = deps.onDocumentsChanged(onChanged);
        return;
      }
      unsubscribe?.();
      unsubscribe = null;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      wanted = new Set();
      pending = new Set();
      queue = [];
      running = false;
      scheduleIdleRelease();
    },
    /** The PDFs on screen (and just around it): their thumbnails are asked for, drawn when missing. */
    want(ids: string[]): void {
      if (!active) return;
      wanted = new Set(ids);
      queue = queue.filter((id) => wanted.has(id));
      for (const id of ids) {
        const e = entries.get(id);
        if (!e || e.stale) pending.add(id);
        else enqueue(id);
      }
      schedule();
      void pump();
    },
    /** Test and diagnostics: the state, without touching it. */
    stats: () => ({ entries: entries.size, queued: queue.length, running, failed: failed.size }),
  };
}

export type ThumbStore = ReturnType<typeof createThumbStore>;

const defaultDeps = (): ThumbDeps => {
  let drawer: Promise<typeof import('./thumbDraw')> | null = null;
  return {
    list: async (docIds) => (await rl.invoke('thumbs:list', { docIds })).items,
    open: async (docId) => {
      const o = await rl.invoke('reader:open', { docId });
      return { url: o.url, hash: o.hash };
    },
    draw: async (url) => {
      drawer ??= import('./thumbDraw');
      return (await drawer).drawFirstPage(url);
    },
    put: async (docId, hash, webp) => (await rl.invoke('thumbs:put', { docId, hash, webp })).url,
    release: () => void drawer?.then((m) => m.releaseDrawer()),
    onDocumentsChanged: (listener) => rl.on('library:changed', (e) => (e.kind === 'documents' ? listener() : undefined)),
  };
};

let shared: ThumbStore | null = null;
/** The one store of the window, created when the grid first needs it. */
export const thumbs = (): ThumbStore => (shared ??= createThumbStore(defaultDeps()));

/** Tests: forgets everything the store knows. */
export function resetThumbs(): void {
  shared?.setActive(false);
  shared = null;
}

const noop = () => {};
/** The thumbnail URL of a document (or `null`: the type icon stays). `docId` is `null` where thumbnails are not used. */
export function useThumbUrl(docId: string | null): string | null {
  const subscribe = useCallback((l: () => void) => (docId === null ? noop : thumbs().subscribe(docId, l)), [docId]);
  return useSyncExternalStore(subscribe, () => (docId === null ? null : thumbs().urlOf(docId)));
}

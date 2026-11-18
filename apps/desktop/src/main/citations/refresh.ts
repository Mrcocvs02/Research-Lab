import { AppError, type CitationFile, type CitationLink, type DocumentId, type Events } from '@rl/core';
import type { z } from 'zod';
import { hasLookupKey, matchLinks } from '@rl/citations';
import { trackAbort } from '../ai/abort-registry.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { DomainHandlers } from '../ipc/types.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { bumpCitations, online, ownedIndex } from './context.js';

type What = Array<'references' | 'citedBy'>;
export type CitationView = Awaited<ReturnType<DomainHandlers<'citations'>['citations:get']>>;
type CitationJobStatus = z.infer<Events['citations:progress']>;

/** The stored file as the interface shows it: each link's `matched` resolved against the documents that exist now. */
export async function citationView(rt: LibraryRuntime, docId: DocumentId): Promise<CitationView> {
  const file = await rt.store.citations.get(docId);
  if (!file) return { docId, fetched: false, references: [], citedBy: [], citedByCount: null, referencesCheckedAt: null, citedByCheckedAt: null, inLibrary: 0, missing: 0 };
  // Matching is redone here, so a document added (or removed) since the refresh shows up (or goes) without a new network call.
  const ix = file.references.length + file.citedBy.length > 0 ? await ownedIndex(rt) : null;
  const rematch = (links: CitationLink[]) => (ix ? matchLinks(links, ix, docId) : links);
  const references = rematch(file.references);
  const citedBy = rematch(file.citedBy);
  const info = new Map<string, { docId: DocumentId; title: string | null; path: string } | null>();
  const ids = [...new Set([...references, ...citedBy].map((l) => l.matchedDocId).filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += 32) {
    await Promise.all(
      ids.slice(i, i + 32).map(async (id) => {
        const d = await rt.store.documents.get(id as DocumentId).catch(() => null);
        info.set(id, d ? { docId: d.id, title: d.title, path: d.path } : null);
      }),
    );
  }
  const view = (l: CitationLink) => {
    const m = l.matchedDocId ? (info.get(l.matchedDocId) ?? null) : null;
    return { ...l, matchedDocId: m ? m.docId : null, matched: m };
  };
  const refViews = references.map(view);
  const inLibrary = refViews.filter((l) => l.matched).length;
  return {
    docId,
    fetched: true,
    references: refViews,
    citedBy: citedBy.map(view),
    citedByCount: file.citedByCount ?? null,
    referencesCheckedAt: file.referencesCheckedAt ?? null,
    citedByCheckedAt: file.citedByCheckedAt ?? null,
    inLibrary,
    missing: refViews.length - inLibrary,
  };
}

/** The stored file for `previous`; a damaged one is set aside (`.corrupt`) and ignored, since the refresh writes a new one. */
async function readPrevious(rt: LibraryRuntime, docId: DocumentId): Promise<CitationFile | null> {
  try {
    return await rt.store.citations.get(docId);
  } catch (e) {
    if (e instanceof AppError && e.code === 'SCHEMA_INVALID') {
      await rt.store.quarantineCitations(docId);
      return null;
    }
    throw e;
  }
}

/**
 * What a refresh of `what` writes into the file as it is NOW: the fetched half comes from `file`, the other half stays
 * as it is stored (a concurrent refresh of that half is not undone by this one).
 */
function mergeFile(cur: CitationFile | null, file: CitationFile, what: What): CitationFile {
  if (!cur) return file;
  const r = what.includes('references');
  const c = what.includes('citedBy');
  const out: CitationFile = { ...file, references: r ? file.references : cur.references, citedBy: c ? file.citedBy : cur.citedBy };
  const set = <K extends 'externalId' | 'citedByCount' | 'referencesCheckedAt' | 'citedByCheckedAt'>(k: K, v: CitationFile[K]) => {
    if (v === undefined) delete out[k];
    else out[k] = v;
  };
  set('externalId', file.externalId ?? cur.externalId);
  set('citedByCount', c ? file.citedByCount : cur.citedByCount);
  set('referencesCheckedAt', r ? file.referencesCheckedAt : cur.referencesCheckedAt);
  set('citedByCheckedAt', c ? file.citedByCheckedAt : cur.citedByCheckedAt);
  return out;
}

/** Fetches one document's citations and stores the file (atomic, through the store). */
async function refreshFile(s: MainServices, rt: LibraryRuntime, docId: DocumentId, what: What, signal: AbortSignal, index?: Awaited<ReturnType<typeof ownedIndex>>): Promise<CitationFile> {
  const doc = await rt.getDocument(docId);
  if (!hasLookupKey(doc)) throw new AppError('INVALID_REQUEST', 'This document has no DOI, arXiv id or title to look up');
  const { service } = await online(s);
  const previous = await readPrevious(rt, docId);
  const file = await service.refresh(doc, index ?? (await ownedIndex(rt, true)), signal, { what, previous });
  // Merged inside the store's per-file queue: the half this refresh did not fetch is re-read, not taken from `previous`.
  const stored = await rt.store.citations.update(docId, (cur) => mergeFile(cur, file, what));
  // References in order of relevance to the work (D-446 g): local, lazy, and never a reason for the refresh to fail.
  if (what.includes('references')) await import('../analysis/cite-rank.js').then((m) => m.rankCitationsFor(s, rt, docId)).catch((e: unknown) => s.log.warn('citation ranking failed', { error: e }));
  bumpCitations(rt);
  return stored;
}

export async function refreshCitations(s: MainServices, docId: DocumentId, what: What): Promise<CitationView> {
  const rt = await s.runtime.require();
  const t = trackAbort();
  try {
    await refreshFile(s, rt, docId, what, t.controller.signal);
  } finally {
    t.release();
  }
  return citationView(rt, docId);
}

/* ------------------------------------------- background job ------------------------------------------- */

interface Job {
  status: CitationJobStatus;
  libraryId: string;
  docIds: DocumentId[];
  /** Documents checked within this many days are left out (0: none). */
  skipDays: number;
  controller: AbortController;
  release(): void;
}
const JOBS_KEPT = 20;
/** Jobs running or waiting at once (each holds its document ids in memory and the sources' rate limits are shared). */
const JOBS_ACTIVE_MAX = 5;
const DAY_MS = 86_400_000;
const PROGRESS_MS = 250;
const jobs: Job[] = [];
let seq = 0;
let running = false;

const active = (j: Job) => j.status.state === 'queued' || j.status.state === 'running';

export async function startRefreshMany(s: MainServices, docIds: DocumentId[], skipDays = 7): Promise<{ jobId: string }> {
  const rt = await s.runtime.require();
  if (jobs.filter(active).length >= JOBS_ACTIVE_MAX) throw new AppError('INVALID_REQUEST', 'Too many citation refreshes are waiting: wait for one to finish or cancel one', { reason: 'too-many-jobs', limit: JOBS_ACTIVE_MAX });
  const ids = [...new Set(docIds)];
  const t = trackAbort();
  const job: Job = { status: { jobId: `cit-${++seq}`, state: 'queued', total: ids.length, done: 0, failed: 0, skipped: 0, notFound: 0 }, libraryId: rt.libraryId, docIds: ids, skipDays, controller: t.controller, release: t.release };
  jobs.unshift(job);
  for (let i = jobs.length - 1; i >= 0 && jobs.length > JOBS_KEPT; i--) if (!active(jobs[i]!)) jobs.splice(i, 1);
  void pump(s);
  return { jobId: job.status.jobId };
}

export function cancelCitationJob(jobId: string, s: MainServices): boolean {
  const j = jobs.find((x) => x.status.jobId === jobId);
  if (!j || !active(j)) return false;
  const wasQueued = j.status.state === 'queued';
  j.controller.abort();
  if (wasQueued) finish(s, j, 'cancelled');
  return true;
}

function finish(s: MainServices, j: Job, state: CitationJobStatus['state'], error?: { code: string; message: string }): void {
  j.status.state = state;
  if (error) j.status.error = error;
  j.release();
  s.emit('citations:progress', { ...j.status });
}

/** One job at a time, oldest first (the sources' rate limits are shared). */
async function pump(s: MainServices): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = [...jobs].reverse().find((j) => j.status.state === 'queued');
      if (!next) break;
      await run(s, next);
    }
  } finally {
    running = false;
  }
}

async function run(s: MainServices, j: Job): Promise<void> {
  const st = j.status;
  st.state = 'running';
  s.emit('citations:progress', { ...st });
  let lastEmit = Date.now();
  let streak = 0;
  const tick = () => {
    if (Date.now() - lastEmit < PROGRESS_MS) return;
    lastEmit = Date.now();
    s.emit('citations:progress', { ...st });
  };
  try {
    const rt = await s.runtime.require();
    if (rt.libraryId !== j.libraryId || j.controller.signal.aborted) return finish(s, j, 'cancelled');
    const index = await ownedIndex(rt, true);
    for (const docId of j.docIds) {
      const now = await s.runtime.require().catch(() => null);
      // Another library became active (or the app is closing): stop without touching it.
      if (j.controller.signal.aborted || now?.libraryId !== j.libraryId) return finish(s, j, 'cancelled');
      try {
        const doc = await rt.getDocument(docId);
        if (!hasLookupKey(doc)) st.skipped++;
        else if (j.skipDays > 0 && (await checkedRecently(rt, docId, j.skipDays))) st.skipped++;
        else {
          await refreshFile(s, rt, docId, ['references', 'citedBy'], j.controller.signal, index);
          st.done++;
        }
        streak = 0;
      } catch (e) {
        if (e instanceof AppError && e.code === 'CANCELLED') return finish(s, j, 'cancelled');
        if (e instanceof AppError && (e.code === 'NOT_FOUND' || e.code === 'INVALID_REQUEST')) {
          // No source knows the work (or the document cannot be looked up): the sources answered, so this is not a failure.
          if (e.code === 'NOT_FOUND') st.notFound++;
          else st.skipped++;
          streak = 0;
          tick();
          continue;
        }
        st.failed++;
        const offline = e instanceof AppError && e.code === 'NETWORK_ERROR' && e.details?.['reason'] === 'offline';
        // Unreachable, or three failures in a row (a timeout counts like any other): the rest would fail too, and each try costs the sources a request.
        if (offline || ++streak >= 3) throw e;
      }
      tick();
    }
    finish(s, j, 'done');
  } catch (e) {
    if (j.controller.signal.aborted) return finish(s, j, 'cancelled');
    s.log.warn('citation refresh stopped', { error: e });
    finish(s, j, 'failed', e instanceof AppError ? { code: e.code, message: e.message } : { code: 'INTERNAL', message: 'The refresh stopped' });
  }
}

/** Both halves refreshed within `days` days. */
async function checkedRecently(rt: LibraryRuntime, docId: DocumentId, days: number): Promise<boolean> {
  const f = await rt.store.citations.get(docId).catch(() => null);
  const at = f?.referencesCheckedAt && f.citedByCheckedAt ? Math.min(Date.parse(f.referencesCheckedAt), Date.parse(f.citedByCheckedAt)) : NaN;
  return Number.isFinite(at) && Date.now() - at < days * DAY_MS;
}

/** Resolves when no citation job is running or queued (tests). */
export async function whenCitationJobsIdle(): Promise<void> {
  for (let i = 0; i < 2000 && jobs.some(active); i++) await new Promise((r) => setTimeout(r, 5));
}

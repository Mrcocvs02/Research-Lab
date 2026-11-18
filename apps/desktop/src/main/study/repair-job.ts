/**
 * Repair of the annotations saved while the PDF page was stretched, WITHOUT opening the documents (D-373, completes D-347).
 * In the library worker pdf.js `getTextContent()` gives the position of the text, so the rectangle of each quoted text is
 * computed again (`@rl/data` `repairQuotes`); the reader refines it when the document is opened. Only the annotation store
 * is written: the PDF files are only read, and an annotation without `geom: 2` is never written into a PDF (D-316).
 *
 * One document at a time, a pause between documents (low priority), cancellable. Annotations that are already `geom: 2`
 * are skipped; those that cannot be placed (no text, text not found, text found more than once at the same height) are
 * left untouched for the reader's "Da controllare" flow.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type Annotation, type DocumentId, type DocumentRecord, type LibraryStore, type Logger } from '@rl/core';
import type { QuoteOutcome, QuoteQuery } from '@rl/data';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { RepairArgs } from '../library/worker-protocol.js';
import type { MainServices } from '../ipc/handlers/services.js';

export interface RepairStatus {
  state: 'running' | 'done' | 'cancelled';
  libraryId: string;
  /** Documents with annotations to check (the "N documenti" of the Activity line; known once the plan is made). */
  total: number;
  done: number;
  /** Annotations whose rectangles were replaced. */
  repaired: number;
  /** Annotations that were already right and only got the marker. */
  confirmed: number;
  /** Annotations left to the reader. */
  left: number;
  /** Documents that could not be read (encrypted, damaged, missing). */
  failed: number;
}

export interface RepairDeps {
  libraryId: string;
  store: Pick<LibraryStore, 'rootPath' | 'documents' | 'annotations'>;
  /** The library worker (`LibraryRuntime.repairAnnotations`). */
  repair(args: RepairArgs, signal: AbortSignal): Promise<QuoteOutcome[]>;
  /** An annotation file changed (the renderer reloads it). */
  changed(docId: string): void;
  onStatus(status: RepairStatus): void;
  /** Gives the machine back between two documents. */
  pause?(): Promise<void>;
  log?: Pick<Logger, 'warn'>;
}

interface Plan {
  rec: DocumentRecord;
  /** The annotations as read, with the `updatedAt` they had: a change since then (the reader repaired it) wins. */
  todo: Annotation[];
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
const stops = (e: unknown, signal: AbortSignal) => signal.aborted || isAbort(e) || (e instanceof AppError && (e.code === 'CANCELLED' || e.code === 'LIBRARY_NOT_ACTIVE'));

/** What could still need the job, for one document: annotations with text, without `geom: 2`, made on the file as it is now. */
function candidates(file: { forHash?: string | undefined; annotations: Annotation[] }, hash: string): Annotation[] {
  return file.annotations.filter((a) => a.geom !== 2 && a.text.trim() !== '' && (a.forHash ?? file.forHash ?? hash) === hash);
}

/** Runs the job over the whole library. Resolves with the final status; never throws for a document (it is counted in `failed`). */
export async function runRepair(d: RepairDeps, signal: AbortSignal): Promise<RepairStatus> {
  const st: RepairStatus = { state: 'running', libraryId: d.libraryId, total: 0, done: 0, repaired: 0, confirmed: 0, left: 0, failed: 0 };
  const emit = () => d.onStatus({ ...st });
  const pause = d.pause ?? (() => new Promise<void>((r) => setTimeout(r, 40)));
  const plan: Plan[] = [];
  const dropped = (e: unknown) => d.log?.warn('annotation check skipped a document', { reason: e instanceof AppError ? e.code : 'error' });

  // 1. Which documents have annotations to check: the annotation files only, no PDF is opened.
  for (const id of await d.store.documents.listIds()) {
    if (signal.aborted) break;
    try {
      const file = await d.store.annotations.get(id as DocumentId);
      if (!file || !file.annotations.some((a) => a.geom !== 2)) continue;
      const rec = await d.store.documents.get(id);
      if (!rec || rec.missing || !rec.path.toLowerCase().endsWith('.pdf')) continue;
      const todo = candidates(file, rec.hash);
      if (todo.length > 0) plan.push({ rec, todo });
    } catch (e) {
      dropped(e);
    }
    await pause();
  }
  st.total = plan.length;
  emit();

  // 2. One document at a time.
  for (const { rec, todo } of plan) {
    if (signal.aborted) break;
    const queries: QuoteQuery[] = todo.map((a) => ({ id: a.id, page: a.page, text: a.text, rects: a.rects }));
    try {
      const outcomes = await d.repair({ rootPath: d.store.rootPath, path: rec.path, queries }, signal);
      const byId = new Map(outcomes.map((o) => [o.id, o]));
      const now = new Date().toISOString();
      let changed = false;
      await d.store.annotations.update(rec.id, (file) => {
        if (!file) throw new AppError('NOT_FOUND', 'The annotations are gone');
        const asRead = new Map(todo.map((a) => [a.id, a.updatedAt]));
        const next = file.annotations.map((a) => {
          const o = byId.get(a.id);
          // Untouched when the reader (or the user) changed it since it was read, or when it cannot be placed.
          if (!o || o.status !== 'found' || a.geom === 2 || asRead.get(a.id) !== a.updatedAt) return a;
          changed = true;
          return { ...a, rects: o.unchanged ? a.rects : o.rects, geom: 2 as const, updatedAt: now };
        });
        return changed ? { ...file, annotations: next } : file;
      });
      for (const o of outcomes) {
        if (o.status !== 'found') st.left++;
        else if (o.unchanged) st.confirmed++;
        else st.repaired++;
      }
      if (changed) d.changed(rec.id);
    } catch (e) {
      if (stops(e, signal)) break;
      st.failed++;
      dropped(e);
    }
    st.done++;
    emit();
    await pause();
  }
  st.state = signal.aborted ? 'cancelled' : 'done';
  emit();
  return { ...st };
}

// --- Start, state and cancel ------------------------------------------------------------------------------------------

/** Machine-local record that a library was checked: the job runs once, at the first start after the update. */
const markerFile = (s: Pick<MainServices, 'localDataDir'>, libraryId: string) => path.join(s.localDataDir, 'repair-geom', `${libraryId.replace(/[^\w-]/g, '_')}.json`);

let current: { controller: AbortController; status: RepairStatus } | null = null;

/** The state of the job (for the Activity list), or null when it never ran in this session. */
export const repairStatus = (): RepairStatus | null => (current ? { ...current.status } : null);

/** Cancels the job that is running; the library is checked again at the next start. */
export function cancelRepair(): boolean {
  const running = current?.status.state === 'running';
  if (running) current!.controller.abort();
  return running;
}

/** Milliseconds from the start (and from the end of the first scan) to the job; `RL_REPAIR_DELAY_MS` changes it for tests. */
const delayMs = (): number => {
  const v = Number(process.env['RL_REPAIR_DELAY_MS']);
  return Number.isFinite(v) && v >= 0 ? v : 5000;
};

const RETRIES = 30;

async function start(s: MainServices, rt: LibraryRuntime): Promise<void> {
  if (current?.status.state === 'running') return;
  const marker = markerFile(s, rt.libraryId);
  if (await readFile(marker, 'utf8').then(() => true, () => false)) return;
  const controller = new AbortController();
  current = { controller, status: { state: 'running', libraryId: rt.libraryId, total: 0, done: 0, repaired: 0, confirmed: 0, left: 0, failed: 0 } };
  const job = current;
  const final = await runRepair(
    {
      libraryId: rt.libraryId,
      store: rt.store,
      repair: (args, signal) => rt.repairAnnotations(args, signal),
      changed: (docId) => s.emit('library:changed', { kind: 'annotations', ids: [docId] }),
      onStatus: (status) => {
        job.status = status;
      },
      log: s.log,
    },
    controller.signal,
  ).catch((e: unknown): RepairStatus => {
    s.log.warn('the annotation check failed', { error: e });
    return { ...job.status, state: 'cancelled' };
  });
  job.status = final;
  if (final.state === 'done') {
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, JSON.stringify({ v: 1, at: new Date().toISOString(), documents: final.total, repaired: final.repaired }));
  }
}

/**
 * Starts the job a few seconds after the app started and its first scan ended, once per library. Waits (a few tries) for
 * a library to be active. Never throws: a failed check only means the reader repairs the annotations when it opens them.
 */
export function scheduleRepairJob(s: MainServices): void {
  const attempt = (left: number): void => {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const rt = await s.runtime.require();
          if (typeof rt.repairAnnotations !== 'function') return;
          await rt.whenIdle();
          await new Promise<void>((r) => setTimeout(r, delayMs()));
          await start(s, rt);
        } catch (e) {
          if (e instanceof AppError && e.code === 'LIBRARY_NOT_ACTIVE' && left > 0) attempt(left - 1);
          else s.log.warn('the annotation check did not run', { error: e });
        }
      })();
    }, delayMs());
    timer.unref();
  };
  attempt(RETRIES);
}

/**
 * Repair of annotations saved while the PDF page was stretched, WITHOUT opening the documents (D-373, completes D-347):
 * the library worker recomputes each rectangle from the quoted text (`@rl/data` `repairQuotes`); the reader refines it
 * when the document is opened. Only the annotation store is written, never a PDF. One document at a time, a pause
 * between documents, cancellable. Annotations already `geom: 2` are skipped; those that cannot be placed are left
 * untouched for the reader's "Da controllare" flow.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type Annotation, type DocumentId, type DocumentRecord, type LibraryStore, type Logger } from '@rl/core';
import type { QuoteOutcome } from '@rl/data';
import type { MainServices } from '../ipc/handlers/services.js';
import type { RepairArgs } from '../library/worker-protocol.js';

/** For the Activity line "Controllo delle evidenziazioni: {total} documenti" (i18n `reader.repair.job`). */
export interface RepairStatus {
  state: 'running' | 'done' | 'cancelled';
  libraryId: string;
  /** Documents with annotations to check (known once the plan is made). */
  total: number;
  done: number;
  /** Replaced rectangles / left to the reader / documents that could not be read. */
  repaired: number;
  left: number;
  failed: number;
}

export interface RepairDeps {
  libraryId: string;
  store: Pick<LibraryStore, 'rootPath' | 'documents' | 'annotations'>;
  repair(args: RepairArgs, signal: AbortSignal): Promise<QuoteOutcome[]>;
  changed(docId: string): void;
  onStatus(status: RepairStatus): void;
  /** Gives the machine back between two documents. */
  pause?(): Promise<void>;
  log?: Pick<Logger, 'warn'>;
}

/** Runs the job over the library; a document that fails is counted in `failed`, never thrown. */
export async function runRepair(d: RepairDeps, signal: AbortSignal): Promise<RepairStatus> {
  const st: RepairStatus = { state: 'running', libraryId: d.libraryId, total: 0, done: 0, repaired: 0, left: 0, failed: 0 };
  const emit = () => d.onStatus({ ...st });
  const pause = d.pause ?? (() => new Promise<void>((r) => setTimeout(r, 40)));
  const plan: Array<{ rec: DocumentRecord; todo: Annotation[] }> = [];

  // The annotation files only: no PDF is opened to make the plan.
  for (const id of await d.store.documents.listIds()) {
    if (signal.aborted) break;
    try {
      const file = await d.store.annotations.get(id as DocumentId);
      const rec = file?.annotations.some((a) => a.geom !== 2) ? await d.store.documents.get(id) : null;
      // Text to look for, and made on the file as it is now.
      const todo = file && rec ? file.annotations.filter((a) => a.geom !== 2 && a.text.trim() !== '' && (a.forHash ?? file.forHash ?? rec.hash) === rec.hash) : [];
      if (rec && !rec.missing && rec.path.toLowerCase().endsWith('.pdf') && todo.length > 0) plan.push({ rec, todo });
    } catch (e) {
      d.log?.warn('annotation check skipped a document', { error: e });
    }
    await pause();
  }
  st.total = plan.length;
  emit();

  for (const { rec, todo } of plan) {
    if (signal.aborted) break;
    try {
      const outcomes = await d.repair({ rootPath: d.store.rootPath, path: rec.path, queries: todo.map(({ id, page, text, rects }) => ({ id, page, text, rects })) }, signal);
      const byId = new Map(outcomes.map((o) => [o.id, o]));
      const read = new Map(todo.map((a) => [a.id, a.updatedAt]));
      let changed = false;
      await d.store.annotations.update(rec.id, (file) => {
        if (!file) throw new AppError('NOT_FOUND', 'The annotations are gone');
        const annotations = file.annotations.map((a) => {
          const o = byId.get(a.id);
          // Untouched when it cannot be placed, or when the reader or the user changed it since it was read.
          if (o?.status !== 'found' || a.geom === 2 || read.get(a.id) !== a.updatedAt) return a;
          changed = true;
          return { ...a, rects: o.unchanged ? a.rects : o.rects, geom: 2 as const, updatedAt: new Date().toISOString() };
        });
        return changed ? { ...file, annotations } : file;
      });
      for (const o of outcomes) {
        if (o.status !== 'found') st.left++;
        else if (!o.unchanged) st.repaired++;
      }
      if (changed) d.changed(rec.id);
    } catch (e) {
      if (signal.aborted || (e instanceof AppError && (e.code === 'CANCELLED' || e.code === 'LIBRARY_NOT_ACTIVE'))) break;
      st.failed++;
      d.log?.warn('annotation check failed for a document', { error: e });
    }
    st.done++;
    emit();
    await pause();
  }
  st.state = signal.aborted ? 'cancelled' : 'done';
  emit();
  return { ...st };
}

// --- Start, state and cancel ---

let current: { controller: AbortController; status: RepairStatus } | null = null;

/** The state of the job for the Activity list; null when it did not run in this session. */
export const repairStatus = (): RepairStatus | null => (current ? { ...current.status } : null);

/** Cancels the running job; the library is checked again at the next start. */
export function cancelRepair(): boolean {
  const running = current?.status.state === 'running';
  if (running) current!.controller.abort();
  return running;
}

/** Wait before the job, after the start and after the first scan (`RL_REPAIR_DELAY_MS` changes it for tests). */
const delayMs = (): number => {
  const v = Number(process.env['RL_REPAIR_DELAY_MS']);
  return Number.isFinite(v) && v >= 0 ? v : 5000;
};

/**
 * Starts the job once per library, at the first start after the update (a machine-local marker says it was done), a few
 * seconds after the first scan. Never throws: if it does not run, the reader repairs the annotations when it opens them.
 */
export function scheduleRepairJob(s: MainServices, tries = 30): void {
  setTimeout(() => {
    void (async () => {
      try {
        const rt = await s.runtime.require();
        if (typeof rt.repairAnnotations !== 'function') return;
        await rt.whenIdle();
        await new Promise<void>((r) => setTimeout(r, delayMs()));
        const marker = path.join(s.localDataDir, 'repair-geom', `${rt.libraryId.replace(/[^\w-]/g, '_')}.json`);
        if (current?.status.state === 'running' || (await readFile(marker).then(() => true, () => false))) return;
        const controller = new AbortController();
        const job: NonNullable<typeof current> = (current = { controller, status: { state: 'running', libraryId: rt.libraryId, total: 0, done: 0, repaired: 0, left: 0, failed: 0 } });
        job.status = await runRepair(
          {
            libraryId: rt.libraryId,
            store: rt.store,
            repair: (args, signal) => rt.repairAnnotations(args, signal),
            changed: (docId) => s.emit('library:changed', { kind: 'annotations', ids: [docId] }),
            onStatus: (status) => (job.status = status),
            log: s.log,
          },
          controller.signal,
        );
        if (job.status.state === 'done') {
          await mkdir(path.dirname(marker), { recursive: true });
          await writeFile(marker, JSON.stringify({ v: 1, at: new Date().toISOString(), documents: job.status.total }));
        }
      } catch (e) {
        if (current?.status.state === 'running') current.status.state = 'cancelled';
        if (e instanceof AppError && e.code === 'LIBRARY_NOT_ACTIVE' && tries > 0) scheduleRepairJob(s, tries - 1);
        else s.log.warn('the annotation check did not run', { error: e });
      }
    })();
  }, delayMs()).unref();
}

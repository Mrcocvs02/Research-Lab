import { AppError } from '@rl/core';
import type { LibraryWorker, WorkerHooks } from './worker-protocol.js';

/** A started worker thread: its proxy and a way to kill it. */
export interface RawWorker {
  client: LibraryWorker;
  /** Kills the thread at once; pending calls of the client fail. */
  terminate(): Promise<void>;
}

export interface WatchdogOptions {
  /** A text extraction that shows no sign of life (no result, no page) for this long is killed. Default 60 s. */
  extractFileMs: number;
  /** Once an extraction has reported a page, the next sign of life is expected within this time. Default 20 s. */
  extractPageMs: number;
  /** A scan that reports no progress (walking, hashing) for this long is killed. Default 5 min. */
  scanMs: number;
  /** Index calls and the open/reset/remove calls. Default 60 s. */
  indexMs: number;
  /** After a cancel (abort), how long the worker has to answer before it is killed. Default 5 s. */
  abortGraceMs: number;
  /** `dispose()` asks the worker to close politely; after this it is killed. Default 3 s. */
  disposeMs: number;
}

export const DEFAULT_WATCHDOG: WatchdogOptions = {
  extractFileMs: 60_000,
  extractPageMs: 20_000,
  scanMs: 300_000,
  indexMs: 60_000,
  abortGraceMs: 5_000,
  disposeMs: 3_000,
};

export interface SupervisedWorkerOptions {
  /** Starts a worker thread; `onExit` must be called when it stops, whatever the reason. */
  spawn(onExit: () => void): RawWorker;
  watchdog?: Partial<WatchdogOptions>;
  /** Short, document-free notes for the log. */
  note?(message: string, details?: Record<string, unknown>): void;
}

type Op = 'openIndex' | 'resetIndex' | 'scan' | 'extract' | 'index' | 'remove';

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Error of a call that the watchdog gave up on (`details.reason === 'timeout'`, permanent for the file). */
export const timeoutError = () => new AppError('IO_ERROR', 'The background worker did not answer in time and was stopped', { reason: 'timeout' });

/**
 * Wraps the worker thread of a library with a watchdog in the main process (D-070). pdf.js or a regular expression
 * can block the worker thread synchronously, so that neither the worker's own timeouts nor a cancel can reach it:
 * only the main thread can notice. A call that shows no progress for too long is cut (the worker is terminated and
 * the call fails with `reason: 'timeout'`); a cancel that the worker does not answer in `abortGraceMs` ends the
 * same way. The worker is started lazily and started again after it was killed or died (the index is reopened),
 * so one bad file or one crash never leaves the library without a working runtime.
 */
export function createSupervisedWorker(options: SupervisedWorkerOptions): LibraryWorker {
  const wd: WatchdogOptions = { ...DEFAULT_WATCHDOG, ...options.watchdog };
  let raw: (RawWorker & { gone: boolean; killedByUs: boolean }) | null = null;
  let starting: Promise<RawWorker & { gone: boolean; killedByUs: boolean }> | null = null;
  let indexPath: string | null = null;
  let disposed = false;

  const kill = async (w: NonNullable<typeof raw>): Promise<void> => {
    w.killedByUs = true;
    if (raw === w) raw = null;
    await w.terminate().catch(() => {});
  };

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(timeoutError()), ms);
      p.then(
        (v) => (clearTimeout(t), resolve(v)),
        (e: unknown) => (clearTimeout(t), reject(e)),
      );
    });

  const ensure = (): Promise<NonNullable<typeof raw>> => {
    if (disposed) return Promise.reject(new AppError('LIBRARY_NOT_ACTIVE', 'The library was closed'));
    if (raw) return Promise.resolve(raw);
    starting ??= (async () => {
      const w = Object.assign(
        options.spawn(() => {
          w.gone = true;
          if (raw === w) raw = null;
        }),
        { gone: false, killedByUs: false },
      );
      try {
        // A worker that starts again reopens the index it had.
        if (indexPath !== null) await withTimeout(w.client.openIndex(indexPath), wd.indexMs);
      } catch (e) {
        await kill(w);
        throw e;
      }
      raw = w;
      return w;
    })().finally(() => {
      starting = null;
    });
    return starting;
  };

  /** Runs one call on the worker under the watchdog. */
  const run = async <T>(op: Op, hooks: WorkerHooks<any> | undefined, invoke: (w: RawWorker, hooks: WorkerHooks<any>) => Promise<T>): Promise<T> => {
    const w = await ensure();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let progressed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      const idleMs = () => (op === 'extract' ? (progressed ? wd.extractPageMs : wd.extractFileMs) : op === 'scan' ? wd.scanMs : wd.indexMs);
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(abortTimer);
        hooks?.signal?.removeEventListener('abort', onAbort);
        settle();
      };
      const giveUp = (error: Error) => {
        finish(() => reject(error));
        options.note?.('worker killed by the watchdog', { op, reason: error instanceof AppError ? error.details?.['reason'] : 'abort' });
        void kill(w);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => giveUp(timeoutError()), idleMs());
      };
      const onAbort = () => {
        abortTimer ??= setTimeout(() => giveUp(abortError()), wd.abortGraceMs);
      };
      hooks?.signal?.addEventListener('abort', onAbort, { once: true });
      if (hooks?.signal?.aborted) onAbort();
      arm();
      invoke(w, {
        ...hooks,
        onEvent: (event: unknown) => {
          if (settled) return;
          progressed = true;
          arm();
          hooks?.onEvent?.(event);
        },
      }).then(
        (v) => finish(() => resolve(v)),
        (e: unknown) =>
          finish(() => {
            // The worker was killed for ANOTHER call's sake (its watchdog): this call did nothing wrong, it may be retried.
            if (w.killedByUs && !(e instanceof Error && e.name === 'AbortError')) reject(new AppError('IO_ERROR', 'The background worker was restarted', { reason: 'restarted' }));
            else reject(e);
          }),
      );
    });
  };

  return {
    async openIndex(dbPath) {
      await run('openIndex', undefined, (w) => w.client.openIndex(dbPath));
      indexPath = dbPath;
    },
    resetIndex: () => run('resetIndex', undefined, (w) => w.client.resetIndex()),
    scan: (args, hooks) => run('scan', hooks, (w, h) => w.client.scan(args, h)),
    extract: (args, hooks) => run('extract', hooks, (w, h) => w.client.extract(args, h)),
    index: (args) => run('index', undefined, (w) => w.client.index(args)),
    remove: (ids) => run('remove', undefined, (w) => w.client.remove(ids)),
    async dispose() {
      disposed = true;
      const w = raw ?? (await starting?.catch(() => null)) ?? null;
      if (!w) return;
      try {
        await withTimeout(w.client.dispose(), wd.disposeMs);
      } catch {
        // killed below
      }
      await kill(w);
    },
    async terminate() {
      const w = raw ?? (await starting?.catch(() => null)) ?? null;
      if (w) await kill(w);
    },
  };
}

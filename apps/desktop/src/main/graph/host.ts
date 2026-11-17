import { Worker } from 'node:worker_threads';
import { AppError, type Logger } from '@rl/core';
import type { BuildProgress, CallHooks, GraphEngine } from './engine.js';
import { createGraphClient } from './rpc.js';

export interface RawGraphWorker {
  client: GraphEngine;
  /** Kills the thread at once; pending calls of the client fail. */
  terminate(): Promise<void>;
}

export interface GraphHostOptions {
  /** Starts a worker thread; `onExit` must be called when it stops, whatever the reason. */
  spawn(onExit: () => void): RawGraphWorker;
  /** The worker is closed after this long without a call in flight (default 30 s; 0 keeps it). */
  idleCloseMs?: number;
  /** After a cancel, how long the worker has to answer before it is killed (default 5 s). */
  abortGraceMs?: number;
  /** A call that reports nothing for this long is killed (default 10 min). */
  stallMs?: number;
  /** No call runs longer than this, progress or not (default 30 min): a hostile or enormous library cannot pin the thread. */
  maxCallMs?: number;
}

/** Engine handed to the handlers: also able to stop everything at quit. */
export interface GraphHost extends GraphEngine {
  terminate(): Promise<void>;
}

type Live = RawGraphWorker & { gone: boolean };
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/**
 * The graph worker thread under the main process's care, like the library worker (D-173): started by the first call,
 * closed after `idleCloseMs` without one, started again by the next. A cancel that the thread does not see (a
 * synchronous loop) kills it after `abortGraceMs`; a call that reports no progress for `stallMs` is killed too.
 */
export function createGraphHost(options: GraphHostOptions): GraphHost {
  const idleCloseMs = options.idleCloseMs ?? 30_000;
  const graceMs = options.abortGraceMs ?? 5_000;
  const stallMs = options.stallMs ?? 600_000;
  const maxCallMs = options.maxCallMs ?? 1_800_000;
  let raw: Live | null = null;
  let inFlight = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let similarTail: Promise<void> = Promise.resolve();
  const noop = () => {};

  const start = (): Live => {
    if (disposed) throw new AppError('LIBRARY_NOT_ACTIVE', 'The graph worker was closed');
    if (raw && !raw.gone) return raw;
    const w = options.spawn(() => {
      w.gone = true;
      if (raw === w) raw = null;
    }) as Live;
    w.gone = false;
    raw = w;
    return w;
  };
  const kill = async (w: Live) => {
    w.gone = true;
    if (raw === w) raw = null;
    await w.terminate().catch(() => {});
  };
  const armIdle = () => {
    clearTimeout(idle);
    if (idleCloseMs <= 0 || disposed || !raw || inFlight > 0) return;
    const w = raw;
    idle = setTimeout(() => {
      if (raw !== w || inFlight > 0) return;
      // Retired before it is told to close: a call that arrives meanwhile starts a fresh thread instead of reaching this one.
      raw = null;
      w.gone = true;
      void w.client.dispose().catch(() => {}).then(() => w.terminate().catch(() => {}));
    }, idleCloseMs);
    idle.unref?.();
  };

  const run = async <T>(invoke: (w: Live, hooks: CallHooks<BuildProgress>) => Promise<T>, hooks: CallHooks<BuildProgress> = {}): Promise<T> => {
    clearTimeout(idle);
    const w = start();
    inFlight++;
    let stall: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let limit: ReturnType<typeof setTimeout> | undefined;
    let fail: ((e: unknown) => void) | undefined;
    const watchdog = new Promise<never>((_, reject) => (fail = reject));
    watchdog.catch(() => {});
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        fail?.(new AppError('IO_ERROR', 'The graph worker did not answer in time and was stopped', { reason: 'timeout' }));
        void kill(w);
      }, stallMs);
      stall.unref?.();
    };
    arm();
    limit = setTimeout(() => {
      fail?.(new AppError('IO_ERROR', 'The graph worker took too long and was stopped', { reason: 'timeout' }));
      void kill(w);
    }, maxCallMs);
    limit.unref?.();
    const onAbort = () => {
      grace = setTimeout(() => {
        fail?.(abortError());
        void kill(w);
      }, graceMs);
      grace.unref?.();
    };
    hooks.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.race([
        invoke(w, {
          signal: hooks.signal,
          onProgress: (p) => {
            arm();
            hooks.onProgress?.(p);
          },
        }),
        watchdog,
      ]);
    } finally {
      clearTimeout(stall);
      clearTimeout(grace);
      clearTimeout(limit);
      hooks.signal?.removeEventListener('abort', onAbort);
      inFlight--;
      armIdle();
    }
  };

  return {
    build: (args, hooks) => run((w, h) => w.client.build(args, h), hooks),
    // One on-the-fly analysis at a time: several at once would each hold the whole library in the thread's heap.
    similar: (args, hooks) => {
      const turn = similarTail.then(() => run((w, h) => w.client.similar(args, h), hooks));
      similarTail = turn.then(noop, noop);
      return turn;
    },
    async dispose() {
      disposed = true;
      clearTimeout(idle);
      const w = raw;
      if (w) {
        await Promise.race([w.client.dispose().catch(() => {}), new Promise((r) => setTimeout(r, 3_000).unref?.())]);
        await kill(w);
      }
    },
    async terminate() {
      disposed = true;
      clearTimeout(idle);
      if (raw) await kill(raw);
    },
  };
}

/** Heap limit of the graph thread: a runaway build kills the thread, not the app. */
const GRAPH_WORKER_MAX_OLD_GENERATION_MB = 1024;

/** Starts the graph worker thread (`graph-worker.js`, built next to the main bundle) on demand. */
export function spawnGraphWorker(file: string, options: { log?: Logger; idleCloseMs?: number } = {}): GraphHost {
  return createGraphHost({
    ...(options.idleCloseMs !== undefined ? { idleCloseMs: options.idleCloseMs } : {}),
    spawn: (onExit) => {
      const worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: GRAPH_WORKER_MAX_OLD_GENERATION_MB } });
      worker.on('error', (e) => options.log?.warn('graph worker error', { error: e }));
      return { client: createGraphClient(worker, onExit), terminate: async () => void (await worker.terminate()) };
    },
  });
}

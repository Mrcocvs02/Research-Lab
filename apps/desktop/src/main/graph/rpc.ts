import { AppError, type ErrorCode } from '@rl/core';
import type { BuildArgs, BuildProgress, BuildSummary, CallHooks, GraphEngine, GraphStoreArgs, SimilarItem } from './engine.js';

/** The part of `worker_threads.Worker` / `MessagePort` that the transport needs. */
export interface Port {
  postMessage(value: unknown): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

type Op = 'build' | 'similar' | 'dispose';
type ToWorker = { id: number; op: Op; args: unknown } | { id: number; op: 'abort' };
type FromWorker = { id: number; type: 'progress'; value: BuildProgress } | { id: number; type: 'result'; value: unknown } | { id: number; type: 'error'; code: string; message: string; aborted: boolean; reason?: string };

/** Worker side: answers the calls of `createGraphClient` with `engine`. */
export function serveGraph(port: Port, engine: GraphEngine): void {
  const aborts = new Map<number, AbortController>();
  port.on('message', (msg: ToWorker) => {
    if (msg.op === 'abort') {
      aborts.get(msg.id)?.abort();
      return;
    }
    const { id } = msg;
    const ac = new AbortController();
    aborts.set(id, ac);
    const hooks = { signal: ac.signal, onProgress: (value: BuildProgress) => port.postMessage({ id, type: 'progress', value } satisfies FromWorker) };
    Promise.resolve()
      .then(async (): Promise<unknown> => {
        if (msg.op === 'build') return engine.build(msg.args as BuildArgs, hooks);
        if (msg.op === 'similar') return engine.similar(msg.args as GraphStoreArgs & { docId: string; limit: number }, hooks);
        return engine.dispose();
      })
      .then(
        (value) => port.postMessage({ id, type: 'result', value } satisfies FromWorker),
        (e: unknown) => {
          const code = e instanceof AppError ? e.code : 'IO_ERROR';
          const message = e instanceof AppError ? e.message.slice(0, 300) : 'graph worker error';
          const reason = e instanceof AppError && typeof e.details?.['reason'] === 'string' ? e.details['reason'] : undefined;
          port.postMessage({ id, type: 'error', code, message, aborted: ac.signal.aborted, ...(reason ? { reason } : {}) } satisfies FromWorker);
        },
      )
      .finally(() => aborts.delete(id));
  });
}

/** Main side: a `GraphEngine` whose calls run behind `port`. */
export function createGraphClient(port: Port, onExit?: () => void): GraphEngine {
  let nextId = 1;
  let dead: Error | null = null;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; onProgress?: ((p: BuildProgress) => void) | undefined }>();
  const failAll = (error: Error) => {
    dead ??= error;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  port.on('message', (m: FromWorker) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') return p.onProgress?.(m.value);
    pending.delete(m.id);
    if (m.type === 'result') p.resolve(m.value);
    else if (m.aborted) p.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    else p.reject(new AppError(m.code as ErrorCode, m.message, m.reason ? { reason: m.reason } : undefined));
  });
  port.on('error', (e?: { code?: string }) => failAll(new AppError('IO_ERROR', 'The graph worker crashed', { reason: e?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'memory' : 'crash' })));
  port.on('exit', () => {
    failAll(new AppError('IO_ERROR', 'The graph worker stopped', { reason: 'crash' }));
    onExit?.();
  });
  const call = <T>(op: Op, args: unknown, hooks: CallHooks<BuildProgress> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (dead) return reject(dead);
      if (hooks.signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const id = nextId++;
      const onAbort = () => port.postMessage({ id, op: 'abort' } satisfies ToWorker);
      const cleanup = () => hooks.signal?.removeEventListener('abort', onAbort);
      pending.set(id, {
        resolve: (v) => (cleanup(), (resolve as (v: unknown) => void)(v)),
        reject: (e) => (cleanup(), reject(e)),
        onProgress: hooks.onProgress,
      });
      hooks.signal?.addEventListener('abort', onAbort, { once: true });
      port.postMessage({ id, op, args } satisfies ToWorker);
    });
  return {
    build: (args, hooks) => call<BuildSummary>('build', args, hooks),
    similar: (args, hooks) => call<SimilarItem[]>('similar', args, hooks),
    dispose: () => call<void>('dispose', undefined),
  };
}

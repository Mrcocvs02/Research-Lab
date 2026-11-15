import { AppError, type ErrorCode } from '@rl/core';
import type { FromWorker, LibraryWorker, ToWorker, WorkerHooks } from './worker-protocol.js';

/** The part of `worker_threads.Worker` / `MessagePort` that the transport needs. */
export interface Port {
  postMessage(value: unknown): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

type Method = Exclude<ToWorker['op'], 'abort'>;

/** Worker side: answers the calls of `createWorkerClient` with `service`. */
export function serveWorker(port: Port, service: LibraryWorker): void {
  const aborts = new Map<number, AbortController>();
  port.on('message', (msg: ToWorker) => {
    if (msg.op === 'abort') {
      aborts.get(msg.id)?.abort();
      return;
    }
    const { id } = msg;
    const ac = new AbortController();
    aborts.set(id, ac);
    const hooks: WorkerHooks<unknown> = { onEvent: (event) => port.postMessage({ id, type: 'event', event } satisfies FromWorker), signal: ac.signal };
    const fn = service[msg.op as Method] as (args: unknown, hooks?: WorkerHooks<unknown>) => Promise<unknown>;
    Promise.resolve()
      .then(() => fn.call(service, msg.args, hooks))
      .then(
        (value) => port.postMessage({ id, type: 'result', value } satisfies FromWorker),
        (e: unknown) => {
          const code = e instanceof AppError ? e.code : 'IO_ERROR';
          const message = e instanceof Error ? e.message.slice(0, 300) : 'worker error';
          port.postMessage({ id, type: 'error', code, message, aborted: ac.signal.aborted } satisfies FromWorker);
        },
      )
      .finally(() => aborts.delete(id));
  });
}

/** Main side: a `LibraryWorker` whose calls run in the worker behind `port`. */
export function createWorkerClient(port: Port, onExit?: () => void): LibraryWorker {
  let nextId = 1;
  let dead: Error | null = null;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; onEvent?(e: unknown): void }>();

  const failAll = (error: Error) => {
    dead ??= error;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  port.on('message', (m: FromWorker) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'event') {
      p.onEvent?.(m.event);
      return;
    }
    pending.delete(m.id);
    if (m.type === 'result') p.resolve(m.value);
    else if (m.aborted) p.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    else p.reject(new AppError(m.code as ErrorCode, m.message));
  });
  port.on('error', (e: unknown) => failAll(e instanceof Error ? e : new Error('worker crashed')));
  port.on('exit', () => {
    failAll(new AppError('IO_ERROR', 'The background worker stopped'));
    onExit?.();
  });

  const call = <T>(op: Method, args: unknown, hooks?: WorkerHooks<any>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (dead) return reject(dead);
      if (hooks?.signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent: hooks?.onEvent });
      hooks?.signal?.addEventListener('abort', () => port.postMessage({ id, op: 'abort' } satisfies ToWorker), { once: true });
      port.postMessage({ id, op, args } satisfies ToWorker);
    });

  return {
    openIndex: (dbPath) => call('openIndex', dbPath),
    resetIndex: () => call('resetIndex', undefined),
    scan: (args, hooks) => call('scan', args, hooks),
    extract: (args, hooks) => call('extract', args, hooks),
    index: (args) => call('index', args),
    remove: (ids) => call('remove', ids),
    dispose: () => call('dispose', undefined),
  };
}

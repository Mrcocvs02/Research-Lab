import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { AppError } from '@rl/core';
import type { BuildArgs, GraphEngine } from './engine.js';
import { createGraphHost, type GraphHost } from './host.js';
import { createGraphClient, serveGraph } from './rpc.js';

const args = { rootPath: 'r', dataDir: 'd', deviceId: 'x', cacheDir: 'c', modelFile: 'm', seed: 1 } satisfies BuildArgs;
const summary = { documents: 3, builtAt: '2026-01-01T00:00:00.000Z', seed: 1 };

/** A worker "thread" on a message channel: the real transport, in this thread. */
function fakeThread(engine: GraphEngine, log: string[]) {
  const { port1, port2 } = new MessageChannel();
  serveGraph(port2, engine);
  const client = createGraphClient(port1);
  log.push('spawn');
  return {
    client,
    terminate: async () => {
      log.push('terminate');
      port1.close();
      port2.close();
    },
  };
}

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

const host = (engine: GraphEngine, log: string[], options: Partial<Parameters<typeof createGraphHost>[0]> = {}): GraphHost => createGraphHost({ spawn: () => fakeThread(engine, log), idleCloseMs: 0, ...options });

describe('graph worker host', () => {
  it('carries a build with its progress over the thread boundary', async () => {
    const engine: GraphEngine = {
      async build(_a, hooks) {
        hooks?.onProgress?.({ phase: 'vectors', done: 1, total: 2 });
        hooks?.onProgress?.({ phase: 'layout', done: 2, total: 2 });
        return summary;
      },
      async similar() {
        return [{ docId: 'a', score: 0.5, reasons: ['text'], shared: { tags: [], citations: 0, terms: ['x'] } }];
      },
      async dispose() {},
    };
    const log: string[] = [];
    const h = host(engine, log);
    const seen: string[] = [];
    expect(await h.build(args, { onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`) })).toEqual(summary);
    expect(seen).toEqual(['vectors:1/2', 'layout:2/2']);
    expect((await h.similar({ rootPath: 'r', dataDir: 'd', deviceId: 'x', docId: 'a', limit: 3 }))[0]?.docId).toBe('a');
    expect(log).toEqual(['spawn']);
    await h.dispose();
    expect(log).toEqual(['spawn', 'terminate']);
  });

  it('cancels a build that checks its signal: the call ends with an AbortError', async () => {
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    const engine: GraphEngine = {
      async build(_a, hooks) {
        started();
        await new Promise<void>((resolve) => hooks?.signal?.addEventListener('abort', () => resolve(), { once: true }));
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
      async similar() {
        return [];
      },
      async dispose() {},
    };
    const log: string[] = [];
    const h = host(engine, log, { abortGraceMs: 5000 });
    const ac = new AbortController();
    const call = h.build(args, { signal: ac.signal });
    await running;
    ac.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toEqual(['spawn']); // answered in time: the thread stays
    await h.dispose();
  });

  it('kills a thread that does not see the cancel (a synchronous loop) after the grace time, and starts a new one next time', async () => {
    let calls = 0;
    const engine: GraphEngine = {
      build: () => (calls++ === 0 ? new Promise<never>(() => {}) : Promise.resolve(summary)),
      async similar() {
        return [];
      },
      async dispose() {},
    };
    const log: string[] = [];
    const h = host(engine, log, { abortGraceMs: 30 });
    const ac = new AbortController();
    const call = h.build(args, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toEqual(['spawn', 'terminate']);
    expect(await h.build(args)).toEqual(summary);
    expect(log).toEqual(['spawn', 'terminate', 'spawn']);
    await h.dispose();
  });

  it('kills a call that reports nothing for too long', async () => {
    const engine: GraphEngine = { build: () => new Promise<never>(() => {}), similar: async () => [], dispose: async () => {} };
    const log: string[] = [];
    const h = host(engine, log, { stallMs: 40 });
    await expect(h.build(args)).rejects.toMatchObject({ code: 'IO_ERROR', details: { reason: 'timeout' } });
    expect(log).toEqual(['spawn', 'terminate']);
    await h.dispose();
  });

  it('closes the thread when idle and starts it again on the next call', async () => {
    const engine: GraphEngine = { build: async () => summary, similar: async () => [], dispose: async () => {} };
    const log: string[] = [];
    const h = host(engine, log, { idleCloseMs: 20 });
    await h.build(args);
    await waitFor(() => log.includes('terminate'));
    expect(log).toEqual(['spawn', 'terminate']);
    await h.build(args);
    await waitFor(() => log.length === 4);
    expect(log).toEqual(['spawn', 'terminate', 'spawn', 'terminate']);
    await h.dispose();
  });

  it('never closes a thread while a call is running', async () => {
    let release!: () => void;
    const engine: GraphEngine = {
      build: () => new Promise((resolve) => (release = () => resolve(summary))),
      similar: async () => [],
      dispose: async () => {},
    };
    const log: string[] = [];
    const h = host(engine, log, { idleCloseMs: 10 });
    const call = h.build(args);
    await new Promise((r) => setTimeout(r, 60));
    expect(log).toEqual(['spawn']);
    release();
    await call;
    await h.dispose();
  });

  it('turns an error of the engine into the same error code on the main side', async () => {
    const engine: GraphEngine = {
      build: async () => {
        throw new AppError('NOT_FOUND', 'Unknown document');
      },
      similar: async () => [],
      dispose: async () => {},
    };
    const h = host(engine, []);
    await expect(h.build(args)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await h.dispose();
    await expect(h.build(args)).rejects.toMatchObject({ code: 'LIBRARY_NOT_ACTIVE' });
  });

  it('a call that arrives while the idle thread is being closed gets a fresh thread, not the dying one', async () => {
    let closing!: () => void;
    const closeStarted = new Promise<void>((r) => (closing = r));
    let finishClose!: () => void;
    const engines: GraphEngine[] = [];
    const make = (slow: boolean): GraphEngine => ({
      build: async () => summary,
      similar: async () => [],
      dispose: slow
        ? () => {
            closing();
            return new Promise<void>((resolve) => (finishClose = resolve));
          }
        : async () => {},
    });
    const log: string[] = [];
    let spawned = 0;
    const h = createGraphHost({
      spawn: () => {
        const e = make(spawned++ === 0);
        engines.push(e);
        return fakeThread(e, log);
      },
      idleCloseMs: 20,
    });
    await h.build(args);
    await closeStarted; // the idle timer fired and the thread has been told to close
    expect(await h.build(args)).toEqual(summary);
    expect(log.filter((l) => l === 'spawn')).toHaveLength(2);
    finishClose();
    await h.dispose();
  });

  it('stops a call that keeps reporting progress past the total time limit', async () => {
    const engine: GraphEngine = {
      build: (_a, hooks) =>
        new Promise<never>(() => {
          setInterval(() => hooks?.onProgress?.({ phase: 'vectors', done: 1, total: 2 }), 5).unref();
        }),
      similar: async () => [],
      dispose: async () => {},
    };
    const log: string[] = [];
    const h = host(engine, log, { stallMs: 10_000, maxCallMs: 80 });
    await expect(h.build(args)).rejects.toMatchObject({ code: 'IO_ERROR', details: { reason: 'timeout' } });
    expect(log).toEqual(['spawn', 'terminate']);
    await h.dispose();
  });

  it('runs on-the-fly similarity one call at a time', async () => {
    let running = 0;
    let peak = 0;
    const engine: GraphEngine = {
      build: async () => summary,
      similar: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
        return [];
      },
      dispose: async () => {},
    };
    const h = host(engine, []);
    const a = { rootPath: 'r', dataDir: 'd', deviceId: 'x', docId: 'a', limit: 3 };
    await Promise.all([h.similar(a), h.similar(a), h.similar(a)]);
    expect(peak).toBe(1);
    await h.dispose();
  });

  it('carries the reason of an error across the thread boundary', async () => {
    const engine: GraphEngine = {
      build: async () => {
        throw new AppError('INVALID_REQUEST', 'too many documents', { reason: 'too-large' });
      },
      similar: async () => [],
      dispose: async () => {},
    };
    const h = host(engine, []);
    await expect(h.build(args)).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'too-large' } });
    await h.dispose();
  });
});

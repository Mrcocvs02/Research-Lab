import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupervisedWorker, type RawWorker } from './supervised-worker.js';
import type { LibraryWorker } from './worker-protocol.js';

/** A worker thread stand-in that records what happens to it. */
function fakeSpawner(scanMs = 0) {
  const log = { spawned: 0, terminated: 0, disposed: 0, opened: [] as string[], removes: 0 };
  const spawn = (onExit: () => void): RawWorker => {
    log.spawned++;
    const client = {
      openIndex: async (p: string) => void log.opened.push(p),
      resetIndex: async () => {},
      scan: async () => {
        await new Promise((r) => setTimeout(r, scanMs));
        return {} as never;
      },
      extract: async () => ({}) as never,
      repairAnnotations: async () => [],
      index: async () => {},
      remove: async () => void log.removes++,
      dispose: async () => void log.disposed++,
    } as LibraryWorker;
    return {
      client,
      terminate: async () => {
        log.terminated++;
        onExit();
      },
    };
  };
  return { log, spawn };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('supervised worker: start on demand and close when idle', () => {
  it('does not start a thread for openIndex, starts one for the first real call and reopens the index there', async () => {
    const { log, spawn } = fakeSpawner();
    const w = createSupervisedWorker({ spawn, watchdog: { idleCloseMs: 0 } });
    await w.openIndex('/tmp/index.db');
    expect(log.spawned).toBe(0);
    await w.remove(['a']);
    expect(log.spawned).toBe(1);
    expect(log.opened).toEqual(['/tmp/index.db']);
    await w.dispose();
  });

  it('closes the thread after the idle time and starts a new one (with the index reopened) for the next call', async () => {
    const { log, spawn } = fakeSpawner();
    const w = createSupervisedWorker({ spawn, watchdog: { idleCloseMs: 60 } });
    await w.openIndex('/tmp/index.db');
    await w.remove(['a']);
    expect(log.terminated).toBe(0);
    await wait(250);
    expect(log.terminated).toBe(1);
    expect(log.disposed).toBe(1);
    await w.remove(['b']);
    expect(log.spawned).toBe(2);
    expect(log.opened).toEqual(['/tmp/index.db', '/tmp/index.db']);
    await w.dispose();
  });

  it('never closes a thread that has a call in flight, and counts the idle time from the end of the call', async () => {
    const { log, spawn } = fakeSpawner(200);
    const w = createSupervisedWorker({ spawn, watchdog: { idleCloseMs: 80, scanMs: 5_000 } });
    await w.openIndex('/tmp/index.db');
    await w.scan({} as never);
    // The scan lasted 200 ms (more than the idle time) and the thread is still there right after it.
    expect(log.terminated).toBe(0);
    await wait(300);
    expect(log.terminated).toBe(1);
    await w.dispose();
  });

  it('dispose cancels the idle timer', async () => {
    const { log, spawn } = fakeSpawner();
    const w = createSupervisedWorker({ spawn, watchdog: { idleCloseMs: 50 } });
    await w.remove(['a']);
    await w.dispose();
    expect(log.terminated).toBe(1);
    await wait(150);
    expect(log.terminated).toBe(1);
  });
});

/** A stand-in whose polite close, termination and index opening are held until the test lets them go. */
function gatedSpawner() {
  const log = { spawned: 0, terminated: 0, opened: [] as string[] };
  const gates = { dispose: [] as Array<() => void>, terminate: [] as Array<() => void>, open: [] as Array<() => void> };
  const hold = (list: Array<() => void>) => new Promise<void>((r) => list.push(r));
  const spawn = (onExit: () => void): RawWorker => {
    log.spawned++;
    const client = {
      openIndex: async (p: string) => {
        log.opened.push(p);
        await hold(gates.open);
      },
      resetIndex: async () => {},
      scan: async () => ({}) as never,
      extract: async () => ({}) as never,
      repairAnnotations: async () => [],
      index: async () => {},
      remove: async () => {},
      dispose: () => hold(gates.dispose),
    } as LibraryWorker;
    return {
      client,
      terminate: async () => {
        await hold(gates.terminate);
        log.terminated++;
        onExit();
      },
    };
  };
  return { log, gates, spawn };
}

describe('supervised worker: races (fake timers)', () => {
  afterEach(() => vi.useRealTimers());

  it('dispose during an idle close waits until the old thread is really terminated', async () => {
    vi.useFakeTimers();
    const { log, gates, spawn } = gatedSpawner();
    const w = createSupervisedWorker({ spawn, watchdog: { idleCloseMs: 100, disposeMs: 1_000 } });
    const first = w.remove(['a']);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.spawned).toBe(1);
    await first;
    await vi.advanceTimersByTimeAsync(100); // idle: the polite close starts, `raw` is already null
    expect(gates.dispose).toHaveLength(1);

    let disposed = false;
    const d = w.dispose().then(() => (disposed = true));
    await vi.advanceTimersByTimeAsync(0);
    gates.dispose[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(disposed).toBe(false); // the old thread is still being terminated
    expect(log.terminated).toBe(0);
    gates.terminate[0]!();
    await d;
    expect(disposed).toBe(true);
    expect(log.terminated).toBe(1);
    expect(log.spawned).toBe(1); // nothing was started again
  });

  it('openIndex while a worker is starting switches that worker to the new path, and later workers use it too', async () => {
    vi.useFakeTimers();
    const { log, gates, spawn } = gatedSpawner();
    const w = createSupervisedWorker({ spawn, watchdog: { idleCloseMs: 100, disposeMs: 1_000 } });
    await w.openIndex('/old.db'); // only records the path
    const call = w.remove(['a']); // starts a worker that opens the OLD path and waits for it
    await vi.advanceTimersByTimeAsync(0);
    expect(log.opened).toEqual(['/old.db']);

    const switched = w.openIndex('/new.db');
    await vi.advanceTimersByTimeAsync(0);
    expect(log.opened).toEqual(['/old.db']); // waiting for the start to finish
    gates.open[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.opened).toEqual(['/old.db', '/new.db']); // the running worker was switched
    gates.open[1]!();
    await Promise.all([call, switched]);

    // After an idle close the next worker opens the new path only.
    await vi.advanceTimersByTimeAsync(100);
    gates.dispose[0]!();
    await vi.advanceTimersByTimeAsync(0);
    gates.terminate[0]!();
    await vi.advanceTimersByTimeAsync(0);
    const again = w.remove(['b']);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.spawned).toBe(2);
    expect(log.opened.at(-1)).toBe('/new.db');
    gates.open[2]!();
    await again;
    const end = w.dispose();
    await vi.advanceTimersByTimeAsync(0);
    gates.dispose[1]!();
    await vi.advanceTimersByTimeAsync(0);
    gates.terminate[1]!();
    await end;
  });
});

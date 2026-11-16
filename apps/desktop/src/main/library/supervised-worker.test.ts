import { describe, expect, it } from 'vitest';
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

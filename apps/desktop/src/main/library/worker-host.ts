import { Worker } from 'node:worker_threads';
import type { Logger } from '@rl/core';
import { createSupervisedWorker, type WatchdogOptions } from './supervised-worker.js';
import type { LibraryWorker } from './worker-protocol.js';
import { createWorkerClient } from './worker-transport.js';

/** Heap limit of the worker thread: a runaway document kills the worker (and is retried never), not the app. */
export const WORKER_MAX_OLD_GENERATION_MB = 1024;

export interface SpawnOptions {
  watchdog?: Partial<WatchdogOptions>;
  log?: Logger;
  maxOldGenerationSizeMb?: number;
}

/**
 * Watchdog times from the environment, for the test runs only (an installed app ignores them, like every other
 * test hook, see `runtime.ts`): `RL_WORKER_FILE_TIMEOUT_MS`, `RL_WORKER_PAGE_TIMEOUT_MS`, `RL_WORKER_IDLE_MS` (idle time before the worker is closed).
 */
export function watchdogFromEnv(env: NodeJS.ProcessEnv, isPackaged: boolean): Partial<WatchdogOptions> {
  if (isPackaged) return {};
  const num = (v: string | undefined) => (v && /^\d{1,7}$/.test(v) && Number(v) >= 200 ? Number(v) : undefined);
  const out: Partial<WatchdogOptions> = {};
  const file = num(env['RL_WORKER_FILE_TIMEOUT_MS']);
  const page = num(env['RL_WORKER_PAGE_TIMEOUT_MS']);
  const idle = num(env['RL_WORKER_IDLE_MS']);
  if (idle !== undefined) out.idleCloseMs = idle;
  if (file !== undefined) out.extractFileMs = file;
  if (page !== undefined) out.extractPageMs = page;
  return out;
}

/**
 * Starts the library worker thread (`scan-worker.js`, built next to the main bundle) under the watchdog of
 * `supervised-worker.ts`: lazily, with a heap limit, started again after it was killed or crashed.
 */
export function spawnScanWorker(file: string, options: SpawnOptions = {}): LibraryWorker {
  return createSupervisedWorker({
    spawn: (onExit) => {
      const worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? WORKER_MAX_OLD_GENERATION_MB } });
      const client = createWorkerClient(worker, onExit);
      return { client, terminate: async () => void (await worker.terminate()) };
    },
    watchdog: options.watchdog,
    note: (message, details) => options.log?.warn(message, details),
  });
}

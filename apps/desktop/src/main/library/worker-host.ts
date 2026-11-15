import { Worker } from 'node:worker_threads';
import type { LibraryWorker } from './worker-protocol.js';
import { createWorkerClient } from './worker-transport.js';

/** Starts the library worker thread (`scan-worker.js`, built next to the main bundle) and returns its proxy. */
export function spawnScanWorker(file: string): LibraryWorker {
  const worker = new Worker(file);
  const client = createWorkerClient(worker);
  return {
    ...client,
    async dispose() {
      await client.dispose().catch(() => {});
      await worker.terminate();
    },
  };
}

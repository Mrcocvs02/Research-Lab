/**
 * Worker thread entry for the tests (bundled by `build-test-worker.ts`): the real worker service with the real
 * scanner, store, index and extractor, except that the extractor misbehaves on files whose NAME says so:
 * `hang-*` blocks the thread in a synchronous loop (what a pathological PDF or regex does), `oom-*` fills the
 * heap until the thread is killed, `crash-*` ends the thread, `slow-*` reports pages for a while and then finishes.
 */
import { parentPort } from 'node:worker_threads';
import { createLibraryStore, createScanner, createTextExtractor } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { createWorkerService } from '../worker-service.js';
import { serveWorker } from '../worker-transport.js';

if (!parentPort) throw new Error('must run in a worker thread');

serveWorker(
  parentPort,
  createWorkerService({
    createScanner: () => createScanner(),
    createTextExtractor: (options) => {
      const real = createTextExtractor(options);
      return {
        async extract(root, rel, opts) {
          const name = rel.slice(rel.lastIndexOf('/') + 1);
          if (name.startsWith('hang-')) {
            for (;;) {
              // synchronous busy loop: no timer, no message, no abort can reach this thread
            }
          }
          if (name.startsWith('oom-')) {
            const keep: number[][] = [];
            for (;;) keep.push(new Array<number>(1_000_000).fill(1));
          }
          if (name.startsWith('crash-')) process.exit(3);
          if (name.startsWith('slow-')) {
            const onPage = opts?.onPage;
            for (let page = 1; page <= 6; page++) {
              await new Promise((r) => setTimeout(r, 150));
              onPage?.(page, 6);
            }
          }
          return real.extract(root, rel, opts);
        },
      };
    },
    createIndex: createSearchIndex,
    createStore: (options) => createLibraryStore({ ...options, logDocumentChanges: false }),
  }),
);

/**
 * Worker thread entry (bundled as `out/main/scan-worker.js`, see electron.vite.config.ts): scanning,
 * text extraction and index writes of a library, away from the main process.
 */
import { parentPort } from 'node:worker_threads';
import { createLibraryStore, createScanner, createTextExtractor } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { createWorkerService } from './library/worker-service.js';
import { serveWorker } from './library/worker-transport.js';

if (!parentPort) throw new Error('scan-worker must run in a worker thread');
serveWorker(
  parentPort,
  createWorkerService({
    createScanner: () => createScanner(),
    createTextExtractor: (options) => createTextExtractor(options),
    createIndex: createSearchIndex,
    createStore: (options) => createLibraryStore({ ...options, logDocumentChanges: false }),
  }),
);

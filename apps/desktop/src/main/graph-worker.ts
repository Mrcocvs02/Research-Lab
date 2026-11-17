/**
 * Worker thread entry (bundled as `out/main/graph-worker.js`, see electron.vite.config.ts): builds the graph model of a
 * library and answers similarity on the fly, away from the main process. Started on demand, closed when idle.
 */
import { parentPort } from 'node:worker_threads';
import { createLibraryStore } from '@rl/data';
import { createGraphEngine } from './graph/engine.js';
import { serveGraph } from './graph/rpc.js';

if (!parentPort) throw new Error('graph-worker must run in a worker thread');
serveGraph(parentPort, createGraphEngine({ createStore: (o) => createLibraryStore({ ...o, logDocumentChanges: false }) }));

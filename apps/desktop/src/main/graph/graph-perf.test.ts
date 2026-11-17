import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultLibraryConfig } from '@rl/core';
import { createLibraryStore, createScanner, createTextExtractor } from '@rl/data';
import { generateCorpus } from '@rl/testkit';
import { createGraphEngine } from './engine.js';

/**
 * Heavy (RL_HEAVY_TESTS=1, see `npm run test:heavy`): the graph build on a 1000-document corpus against the scan's own
 * work on the same files (walk, hash, write the records, extract and cache the text). The build must cost a fraction of it.
 */
describe.skipIf(!process.env['RL_HEAVY_TESTS'])('graph build on 1000 documents', () => {
  it('takes well under the scan time of the same corpus, with a model of bounded size', async () => {
    const corpus = await generateCorpus(1000, { seed: 4, pdfShare: 0 });
    const local = await mkdtemp(path.join(os.tmpdir(), 'rl-graph-perf-'));
    try {
      const store = createLibraryStore({ rootPath: corpus.root, deviceId: 'device-perf' });
      await store.init();
      const config = defaultLibraryConfig();
      config.scan.extensions = ['md', 'txt'];
      const cacheDir = path.join(local, 'cache');

      const t0 = performance.now();
      await createScanner().scan(corpus.root, { config, store });
      const extractor = createTextExtractor({ cacheDir });
      const records = await store.documents.list();
      for (const r of records) await extractor.extract(corpus.root, r.path, { hash: r.hash });
      const scanMs = performance.now() - t0;
      expect(records.length).toBeGreaterThan(950); // files with the very same content are one document

      const modelFile = path.join(local, 'graph', 'model.json');
      const t1 = performance.now();
      const summary = await createGraphEngine({ createStore: () => store }).build({ rootPath: corpus.root, dataDir: store.dataDir, deviceId: 'device-perf', cacheDir, modelFile, seed: 1 });
      const buildMs = performance.now() - t1;
      const { size } = await (await import('node:fs/promises')).stat(modelFile);
      console.log(`graph perf: scan+extract ${Math.round(scanMs)} ms, build ${Math.round(buildMs)} ms (${(buildMs / scanMs).toFixed(2)} of the scan), model ${Math.round(size / 1024)} KiB, heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MiB`);
      expect(summary.documents).toBe(records.length);
      expect(buildMs).toBeLessThan(scanMs * 0.5);
      expect(size).toBeLessThan(8 * 1024 * 1024);
    } finally {
      await corpus.cleanup();
      await rm(local, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 120_000);
});

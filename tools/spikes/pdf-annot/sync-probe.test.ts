// Probe for commitStrategy 'rename' vs 'append' inside a synced folder (opt-in: RL_S2_PROBE_DIR=<new folder with synthetic files only>).
// Stage "create" writes four synthetic PDFs; stage "rewrite" annotates two by temp-file + rename and two by appending in place.
import { closeSync, copyFileSync, fsyncSync, openSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { classify } from './classify';
import { fileSource } from './doc';
import { libPdf } from './pdfs';
import { buildUpdate } from './writer';

const dir = process.env.RL_S2_PROBE_DIR;
const stage = process.env.RL_S2_PROBE_STAGE ?? 'create';
const NAMES = { rename: ['probe-rename-1.pdf', 'probe-rename-2.pdf'], append: ['probe-append-1.pdf', 'probe-append-2.pdf'] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!dir)('synced-folder probe', () => {
  it.skipIf(stage !== 'create')('creates synthetic files', async () => {
    for (const n of [...NAMES.rename, ...NAMES.append]) writeFileSync(join(dir!, n), await libPdf({ pages: 3, pad: 150_000, objectStreams: n.includes('2') }));
  });

  it.skipIf(stage !== 'rewrite')('rewrites them, several rounds each, pause configurable', async () => {
    const rounds = Number(process.env.RL_S2_PROBE_ROUNDS ?? 4);
    for (let i = 0; i < rounds; i++) {
      for (const strategy of ['rename', 'append'] as const) {
        for (const n of NAMES[strategy]) {
          const path = join(dir!, n);
          const src = fileSource(path);
          const c = classify(src);
          if (!c.ok) throw new Error('refused');
          const u = buildUpdate(c.doc, { add: [{ nm: `rl-probe-${i}-${strategy}`, subtype: i % 2 ? 'Underline' : 'Highlight', page: i % 3, rects: [[40, 300 - i * 20, 200, 316 - i * 20]], color: [1, 0.8, 0] }] });
          const old = src.size;
          src.close();
          if (strategy === 'rename') {
            const tmp = join(dir!, `.${n}.rl-${i}.tmp`);
            copyFileSync(path, tmp);
            const fd = openSync(tmp, 'r+');
            writeSync(fd, u.bytes, 0, u.bytes.length, old);
            fsyncSync(fd);
            closeSync(fd);
            renameSync(tmp, path);
          } else {
            const fd = openSync(path, 'r+');
            writeSync(fd, u.bytes, 0, u.bytes.length, old);
            fsyncSync(fd);
            closeSync(fd);
          }
          if (statSync(path).size !== old + u.bytes.length) throw new Error('size');
        }
      }
      await sleep(Number(process.env.RL_S2_PROBE_GAP ?? 1500));
    }
  }, 120_000);
});

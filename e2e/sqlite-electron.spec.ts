import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

/** D-007: node:sqlite with FTS5 must also work inside Electron's main process. */
test('node:sqlite FTS5 works in the Electron runtime', () => {
  const require = createRequire(import.meta.url);
  const electronBin = require('electron') as unknown as string;
  const script = path.resolve(import.meta.dirname, '../tools/spikes/sqlite-fts5.cjs');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const out = execFileSync(electronBin, [script], { env, encoding: 'utf8', timeout: 30_000 });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT '));
  expect(line).toBeTruthy();
  const result = JSON.parse(line!.slice('RESULT '.length)) as { electron: string | null; hits: string[]; accentHits: string[]; error?: string };
  expect(result.error).toBeUndefined();
  expect(result.electron).toBeTruthy();
  expect(result.hits).toEqual(['Alpha']);
  expect(result.accentHits).toEqual(['Beta']);
});

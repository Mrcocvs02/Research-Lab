import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appSettingsSchema, channels, createDispatcher, createMemoryLogger, scanReportSchema, type LibraryProfile } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import { createLibraryStore } from '@rl/data';
import { scanReportFile } from '../library/library-runtime.js';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rl-usage-all-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const profile = (id: string, rootPath: string): LibraryProfile => ({ id, name: id, rootPath, dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' });
const services = (profiles: LibraryProfile[], active: string | null): MainServices => {
  const settings = { ...appSettingsSchema.parse({}), libraries: profiles, activeLibraryId: active };
  return {
    log: createMemoryLogger(),
    localDataDir: path.join(tmp, 'local'),
    settings: { get: async () => structuredClone(settings) },
    libraries: { list: async () => ({ profiles, activeLibraryId: active }), dataDir: async (id: string) => path.join(profiles.find((p) => p.id === id)!.rootPath, '.lab') },
  } as unknown as MainServices;
};
const call = (s: MainServices, c: string, p: unknown = {}) => createDispatcher(channels, buildHandlers(s), createMemoryLogger())(c, p);

describe('ai:usageAll', () => {
  it('adds up the month of every reachable library and reports the unreachable ones', async () => {
    const root = path.join(tmp, 'lib-a');
    await mkdir(root);
    const store = createLibraryStore({ rootPath: root, dataDir: path.join(root, '.lab'), deviceId: 'dev-test' });
    await store.init();
    const at = new Date().toISOString();
    for (const usd of [0.25, 0.5]) {
      await store.appendLog({ type: 'ai-send', at, deviceId: 'dev-test', provider: 'claude-agent-sdk', model: 'claude-haiku-5-5', purpose: 'chat', docIds: [], folders: [], approxInputTokens: 10, approxOutputTokens: 5, estimatedCostUsd: usd, confirmed: true });
    }
    const s = services([profile('lib-a', root), profile('lib-gone', path.join(tmp, 'unplugged'))], 'lib-a');
    const r = await call(s, 'ai:usageAll');
    expect(r).toMatchObject({ ok: true, data: { totalUsd: 0.75, sends: 2, libraries: [{ libraryId: 'lib-a', usd: 0.75, reachable: true }, { libraryId: 'lib-gone', usd: null, reachable: false }] } });
  });
});

describe('scan:report', () => {
  it('answers the empty report before any scan, and the saved one after', async () => {
    const s = services([profile('lib-a', path.join(tmp, 'lib-a'))], 'lib-a');
    expect(await call(s, 'scan:report')).toMatchObject({ ok: true, data: { finishedAt: null, summary: null, added: [], truncated: false } });
    const saved = scanReportSchema.parse({ finishedAt: '2026-11-18T10:00:00.000Z', summary: { added: 1, changed: 0, moved: 0, missing: 0, unchanged: 0, extracted: 1, failed: 0 }, firstScan: true, added: ['0'.repeat(16)], changed: [], moved: [], missing: [], failed: [], truncated: false });
    await atomicWriteJson(scanReportFile(path.join(tmp, 'local'), 'lib-a'), saved);
    expect(await call(s, 'scan:report', {})).toMatchObject({ ok: true, data: { firstScan: true, added: saved.added } });
    // A damaged file is the empty report, never an error.
    await atomicWriteJson(scanReportFile(path.join(tmp, 'local'), 'lib-a'), { nonsense: true });
    expect(await call(s, 'scan:report', {})).toMatchObject({ ok: true, data: { finishedAt: null } });
  });
});

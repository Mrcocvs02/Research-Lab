import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAiProvider, type MockScript } from '@rl/ai';
import { AppError, channels, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope, type LibraryConfig } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { abortAllJobs, whenJobsIdle } from './jobs.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, p: string, extra: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: 'ab'.repeat(32), path: p, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: `Paper about robotics ${n}`, year: 2020, ...extra });
const aiField = (value: unknown, status: string) => ({ value, meta: { model: 'm', provider: 'mock', date: NOW, source: 'job:suggest' }, review: { status } });

let root: string;
let local: string;
let store: FileLibraryStore;
let progress: any[];
let wrap: ((p: any) => any) | null;
let script: MockScript;
let activeLib = 'lib-1';

const config = (over: Partial<LibraryConfig> & { ai?: Partial<LibraryConfig['ai']> } = {}): LibraryConfig => {
  const base = defaultLibraryConfig();
  return { ...base, aiEnabledFolders: ['open'], ...over, ai: { ...base.ai, confirmBeforeSend: false, ...over.ai } } as LibraryConfig;
};

function harness() {
  const log = createMemoryLogger();
  const rt = { get libraryId() { return activeLib; }, store, search: async () => ({ total: 0, hits: [] }), reindexDocuments: async () => {} };
  const services = {
    log,
    localDataDir: local,
    emit: (e: string, p: any) => {
      if (e === 'jobs:progress') progress.push(structuredClone(p));
    },
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    libraries: { profile: async () => ({ rootPath: root, id: 'lib-1' }), dataDir: async () => store.dataDir },
    settings: { get: async () => ({ deviceId: 'device-12345678', ai: { claudeCodePath: null, tokenCap: { monthlyTokens: null, warnAtPct: 80 } } }) },
    secrets: { get: async () => null },
    aiProvider: (cfg: { models: any }) => {
      const p: any = createMockAiProvider({ models: cfg.models, ...script });
      return wrap ? Object.assign(wrap(p), { access: () => p.access(), isAvailable: () => p.isAvailable() }) : p;
    },
    isOnline: () => true,
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  return async (c: string, p: unknown = {}) => dispatch(c, p);
}
const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const req = (over: Record<string, unknown> = {}) => ({ kind: 'suggest', docIds: [hex(1), hex(2), hex(3)], fields: ['tags', 'description'], model: 'claude-haiku-5-5', reasoning: 'low', ...over });
const sends = async () => (await store.readLog({ type: 'ai-send' })) as any[];
const bigSend = () => ({ type: 'ai-send' as const, at: new Date().toISOString(), deviceId: 'd', provider: 'mock' as const, model: 'claude-haiku-5-5', purpose: 'chat', docIds: [], folders: [], approxInputTokens: 1, estimatedCostUsd: 5, confirmed: true });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-job-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-job-local-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeConfig(config());
  await store.writeTaxonomy(
    taxonomyFileSchema.parse({
      nodes: [
        { id: 'robotics', label: 'Robotics' },
        { id: 'vision', label: 'Vision' },
        { id: 'retired', label: 'Retired', status: 'deprecated' },
      ],
    }),
  );
  await store.documents.put(doc(1, 'open/p1.pdf'));
  await store.documents.put(doc(2, 'open/p2.pdf'));
  await store.documents.put(doc(3, 'closed/p3.pdf'));
  progress = [];
  wrap = null;
  script = {};
  activeLib = 'lib-1';
});
afterEach(async () => {
  abortAllJobs();
  await whenJobsIdle();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(local, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('jobs:estimate', () => {
  it('counts what would be sent, what is refused and what is skipped', async () => {
    await store.documents.put(doc(2, 'open/p2.pdf', { ai: { description: aiField('x', 'proposed'), suggestedTags: aiField(['robotics'], 'rejected') } }));
    const call = harness();
    const e = ok(await call('jobs:estimate', req()));
    expect(e.toSend).toBe(1);
    expect(e.skipped).toBe(1);
    expect(e.preview.allowed).toEqual([hex(1)]);
    expect(e.preview.refused).toEqual([{ docId: hex(3), reason: 'folder-not-enabled' }]);
    expect(e.preview.approxInputTokens).toBeGreaterThan(0);
    // With `regenerate`, proposed and rejected values are proposed again.
    expect(ok(await call('jobs:estimate', req({ regenerate: true }))).toSend).toBe(2);
  });

  it('never re-sends accepted or edited fields, even with regenerate', async () => {
    await store.documents.put(doc(2, 'open/p2.pdf', { ai: { description: aiField('x', 'accepted'), suggestedTags: aiField(['robotics'], 'edited') } }));
    const e = ok(await harness()('jobs:estimate', req({ docIds: [hex(2)], regenerate: true })));
    expect(e).toMatchObject({ toSend: 0, skipped: 1 });
  });

  it('asks for confirmation (setting, or estimate above the threshold) and flags the cap', async () => {
    expect(ok(await harness()('jobs:estimate', req())).preview.needsConfirmation).toBe(false);
    await store.writeConfig(config({ ai: { confirmBeforeSend: true } as never }));
    expect(ok(await harness()('jobs:estimate', req())).preview.needsConfirmation).toBe(true);
    await store.writeConfig(config({ ai: { usageCap: { monthlyUsd: 0.000001, confirmBatchAboveUsd: 0.0000001 } } as never }));
    const p = ok(await harness()('jobs:estimate', req())).preview;
    expect(p).toMatchObject({ needsConfirmation: true, overCap: true });
  });
});

describe('jobs:start', () => {
  it('writes proposals for each document, logs each call, and never touches accepted values', async () => {
    await store.documents.put(doc(2, 'open/p2.pdf', { ai: { description: aiField('mine', 'edited') } }));
    const call = harness();
    const { jobId } = ok(await call('jobs:start', req({ docIds: [hex(1), hex(2)], regenerate: true })));
    await whenJobsIdle();
    const job = ok(await call('jobs:list')).items[0];
    expect(job).toMatchObject({ jobId, state: 'done', total: 2, done: 2, failed: 0 });
    const d1 = (await store.documents.get(hex(1) as never))!;
    expect(d1.ai.suggestedTags).toMatchObject({ value: ['robotics'], review: { status: 'proposed' }, meta: { provider: 'mock', source: 'job:suggest' } });
    expect(d1.ai.description?.value).toBe('Mock description of the document.');
    const d2 = (await store.documents.get(hex(2) as never))!;
    expect(d2.ai.description).toMatchObject({ value: 'mine', review: { status: 'edited' } });
    expect(d2.ai.suggestedTags?.review.status).toBe('proposed');
    expect(d1.tags).toEqual([]);
    const log = await sends();
    expect(log.filter((l) => l.purpose === 'job:suggest')).toHaveLength(2);
    expect(log[0]).toMatchObject({ docIds: [hex(1)], folders: ['open'], confirmed: false });
    expect(progress.some((p) => p.state === 'running')).toBe(true);
    expect(progress.at(-1).state).toBe('done');
  });

  it('skips documents that already have the value and refuses when nothing would be sent', async () => {
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1)], fields: ['summary'] })));
    await whenJobsIdle();
    const again = fail(await call('jobs:start', req({ docIds: [hex(1)], fields: ['summary'] })));
    expect(again).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fail(await call('jobs:start', req({ docIds: [hex(3)] }))).code).toBe('INVALID_REQUEST');
  });

  it('refuses like the chat: confirmation, cap, access, unknown model', async () => {
    const call = harness();
    await store.writeConfig(config({ ai: { confirmBeforeSend: true } as never }));
    const c = fail(await call('jobs:start', req()));
    expect(c).toMatchObject({ code: 'CONFLICT', details: { reason: 'needs-confirmation' } });
    ok(await call('jobs:start', req({ confirmed: true, docIds: [hex(1)] })));
    await whenJobsIdle();
    expect((await sends())[0]!.confirmed).toBe(true);
    await store.writeConfig(config({ ai: { usageCap: { monthlyUsd: 1, confirmBatchAboveUsd: 5 } } as never }));
    await store.appendLog(bigSend());
    expect(fail(await call('jobs:start', req({ docIds: [hex(2)] }))).code).toBe('AI_BUDGET_EXCEEDED');
    expect(fail(await call('jobs:start', req({ model: 'nope' }))).code).toBe('INVALID_REQUEST');
    script = { available: false };
    await store.writeConfig(config());
    expect(fail(await call('jobs:start', req({ docIds: [hex(2)] }))).code).toBe('AI_PROVIDER_ERROR');
  });

  it('stops with AI_BUDGET_EXCEEDED when the cap is reached between two documents', async () => {
    await store.writeConfig(config({ ai: { usageCap: { monthlyUsd: 3, confirmBatchAboveUsd: 5 } } as never }));
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        await store.appendLog(bigSend());
        return p.completeStructured(r);
      },
    });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1), hex(2)] })));
    await whenJobsIdle();
    const job = ok(await call('jobs:list')).items[0];
    expect(job).toMatchObject({ state: 'failed', done: 1, error: { code: 'AI_BUDGET_EXCEEDED' } });
    expect((await store.documents.get(hex(2) as never))!.ai.suggestedTags).toBeUndefined();
  });

  it('checks the folder gate again before each document', async () => {
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        await store.writeConfig(config({ aiEnabledFolders: [] }));
        return p.completeStructured(r);
      },
    });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1), hex(2)] })));
    await whenJobsIdle();
    const job = ok(await call('jobs:list')).items[0];
    expect(job).toMatchObject({ state: 'done', done: 1, failed: 1, error: { code: 'FOLDER_NOT_AI_ENABLED' } });
    expect((await sends()).filter((l) => l.purpose === 'job:suggest')).toHaveLength(1);
  });

  it('cancels a running job and keeps what was done; a queued job is cancelled at once', async () => {
    let calls = 0;
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        if (++calls === 1) return p.completeStructured(r);
        await new Promise((_res, rej) => r.signal.addEventListener('abort', () => rej(new AppError('CANCELLED', 'Cancelled'))));
        throw new Error('unreachable');
      },
    });
    const call = harness();
    const a = ok(await call('jobs:start', req({ docIds: [hex(1), hex(2)] }))).jobId;
    const b = ok(await call('jobs:start', req({ docIds: [hex(1)], fields: ['keywords'] }))).jobId;
    for (let i = 0; i < 300 && calls < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const list = ok(await call('jobs:list')).items.filter((x: any) => x.jobId === a || x.jobId === b);
    expect(list.map((x: any) => [x.jobId, x.state])).toEqual([[b, 'queued'], [a, 'running']]);
    expect(ok(await call('jobs:cancel', { jobId: b })).cancelled).toBe(true);
    expect(ok(await call('jobs:cancel', { jobId: a })).cancelled).toBe(true);
    await whenJobsIdle();
    const after = ok(await call('jobs:list')).items;
    expect(after.find((x: any) => x.jobId === a)).toMatchObject({ state: 'cancelled', done: 1 });
    expect(after.find((x: any) => x.jobId === b)).toMatchObject({ state: 'cancelled', done: 0 });
    expect((await store.documents.get(hex(1) as never))!.ai.suggestedTags).toBeDefined();
    expect(ok(await call('jobs:cancel', { jobId: a })).cancelled).toBe(false);
  });

  it('drops tag ids the model invents or that are deprecated, and keeps valid new tags', async () => {
    script = { structured: { tagIds: ['robotics', 'retired', 'zzz'], newTags: [{ label: 'Soft robots', parentId: 'robotics', aliases: ['SR'], reason: 'none fits' }], description: 'd' } };
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1)] })));
    await whenJobsIdle();
    const d = (await store.documents.get(hex(1) as never))!;
    expect(d.ai.suggestedTags?.value).toEqual(['robotics']);
    expect(d.ai.suggestedNewTags?.value).toEqual([{ label: 'Soft robots', parentId: 'robotics', aliases: ['SR'], reason: 'none fits' }]);
  });
});

describe('jobs: failures, cost, stale runtime', () => {
  const many = async (n: number) => {
    for (let i = 4; i < 4 + n; i++) await store.documents.put(doc(i, `open/p${i}.pdf`));
    return [hex(1), hex(2), ...Array.from({ length: n }, (_, i) => hex(i + 4))];
  };

  it('stops after three consecutive provider failures instead of trying every document, and logs no send when nothing left', async () => {
    const ids = await many(6);
    let calls = 0;
    script = { fail: { code: 'AI_PROVIDER_ERROR', message: 'Claude could not be started', sent: false } };
    wrap = (p) => ({ ...p, completeStructured: async (r: any) => (calls++, p.completeStructured(r)) });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: ids })));
    await whenJobsIdle();
    const job = ok(await call('jobs:list')).items[0];
    expect(calls).toBe(3);
    expect(job).toMatchObject({ state: 'failed', failed: 3, error: { code: 'AI_PROVIDER_ERROR' } });
    expect((await sends()).filter((l) => l.purpose === 'job:suggest')).toHaveLength(0);
  });

  it('a provider failure that may have sent the content is still logged, with the tokens it reports', async () => {
    wrap = (p) => ({
      ...p,
      completeStructured: async () => {
        throw new AppError('AI_PROVIDER_ERROR', 'schema mismatch', { sent: true, usage: { inputTokens: 700, outputTokens: 40, costUsd: 0.25 } });
      },
    });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1)] })));
    await whenJobsIdle();
    const log = (await sends()).filter((l) => l.purpose === 'job:suggest');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ approxInputTokens: 700, estimatedCostUsd: 0.25 });
    expect(ok(await call('jobs:list')).items[0].usd).toBeCloseTo(0.25, 6);
  });

  it('a consecutive-failure count restarts after a success', async () => {
    const ids = await many(4);
    let n = 0;
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        n++;
        if (n % 3 === 0) return p.completeStructured(r);
        throw new AppError('AI_PROVIDER_ERROR', 'down', { sent: false });
      },
    });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: ids })));
    await whenJobsIdle();
    expect(ok(await call('jobs:list')).items[0]).toMatchObject({ state: 'done', done: 2, failed: 4 });
  });

  it('counts the cost the provider reports (cache reads priced by the provider), in the log and in the job total', async () => {
    script = { usage: { inputTokens: 1_000_000, outputTokens: 1000, costUsd: 0.0421 } };
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1)] })));
    await whenJobsIdle();
    expect(ok(await call('jobs:list')).items[0].usd).toBeCloseTo(0.0421, 6);
    expect((await sends()).find((l) => l.purpose === 'job:suggest')).toMatchObject({ estimatedCostUsd: 0.0421, approxInputTokens: 1_000_000 });
  });

  it('writes nothing when the job is aborted after the model answered; the send is still logged', async () => {
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        const out = await p.completeStructured(r);
        abortAllJobs();
        return out;
      },
    });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1), hex(2)] })));
    await whenJobsIdle();
    expect(ok(await call('jobs:list')).items[0]).toMatchObject({ state: 'cancelled', done: 0 });
    expect((await store.documents.get(hex(1) as never))!.ai.suggestedTags).toBeUndefined();
    expect((await sends()).filter((l) => l.purpose === 'job:suggest')).toHaveLength(1);
  });

  it('a library switch while the model answers (running) or before the next document stops the job without writing to the wrong library', async () => {
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        const out = await p.completeStructured(r);
        activeLib = 'lib-2'; // setActive: another library is current now
        return out;
      },
    });
    const call = harness();
    ok(await call('jobs:start', req({ docIds: [hex(1), hex(2)] })));
    await whenJobsIdle();
    expect(ok(await call('jobs:list')).items[0]).toMatchObject({ state: 'cancelled', done: 0 });
    expect((await store.documents.get(hex(1) as never))!.ai.suggestedTags).toBeUndefined();
    expect((await store.documents.get(hex(2) as never))!.ai.suggestedTags).toBeUndefined();
  });

  it('a queued job is stopped by abortAllJobs (library switch) without ever calling the provider', async () => {
    let calls = 0;
    wrap = (p) => ({
      ...p,
      completeStructured: async (r: any) => {
        calls++;
        await new Promise((_res, rej) => r.signal.addEventListener('abort', () => rej(new AppError('CANCELLED', 'Cancelled'))));
        return p.completeStructured(r);
      },
    });
    const call = harness();
    const a = ok(await call('jobs:start', req({ docIds: [hex(1)] }))).jobId;
    const b = ok(await call('jobs:start', req({ docIds: [hex(2)], fields: ['keywords'] }))).jobId;
    for (let i = 0; i < 300 && calls < 1; i++) await new Promise((r) => setTimeout(r, 10));
    abortAllJobs();
    await whenJobsIdle();
    const items = ok(await call('jobs:list')).items;
    expect(items.find((x: any) => x.jobId === a).state).toBe('cancelled');
    expect(items.find((x: any) => x.jobId === b).state).toBe('cancelled');
    expect(calls).toBe(1);
  });
});

describe('analysisCallsOf (I4)', () => {
  it('counts the note calls with the stronger model plus the analysis call, or only the latter with a note', async () => {
    const { analysisCallsOf } = await import('./jobs.js');
    expect(analysisCallsOf({ chars: 90_000, calls: 5 }, null, 1000)).toMatchObject({ strongChars: 90_000, strongCalls: 5, chosenCalls: 1 });
    expect(analysisCallsOf(null, 4000, 1000)).toEqual({ strongChars: 0, strongCalls: 0, chosenChars: 5000, chosenCalls: 1 });
    expect(analysisCallsOf(null, null, 1000).chosenCalls).toBe(0);
  });
});

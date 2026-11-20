import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAiProvider, type MockScript } from '@rl/ai';
import { createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type LibraryConfig, type TagAiProgress } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import type { MainServices } from '../../ipc/handlers/services.js';
import { AI_SYSTEM, BATCH_PAIRS, aiCancel, aiPreview, aiRun } from './ai.js';
import { getReview } from './index.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, tags: string[]) => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `open/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, tags });
const node = (id: string, label: string) => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', origin: 'user' });
/** Letters only: "xxxtion" / "xxxsion" is what the detector calls a spelling variant it is not sure of, one question per pair. */
const word = (i: number) => [i % 26, Math.floor(i / 26) % 26, Math.floor(i / 676)].map((c) => String.fromCharCode(97 + c)).join('');

const PAIRS = 320;
let root: string;
let store: FileLibraryStore;
let s: MainServices;
let script: MockScript;
let events: TagAiProgress[];
let calls: Array<{ system: string; prompt: string }>;
let onCall: ((n: number) => void) | null;

const config = (over: Partial<LibraryConfig['ai']['usageCap']> = {}): LibraryConfig => {
  const base = defaultLibraryConfig();
  return { ...base, aiEnabledFolders: ['open'], ai: { ...base.ai, confirmBeforeSend: false, usageCap: { ...base.ai.usageCap, ...over } } } as LibraryConfig;
};

/** The mock answers every numbered pair of the prompt: "same" with a high confidence for the even ones, a low one for the others. */
const answerAll = (req: { prompt: string }) => {
  const n = [...req.prompt.matchAll(/^(\d+)\. t\d+ \| t\d+$/gm)].length;
  return { answers: Array.from({ length: n }, (_, i) => ({ n: i + 1, verdict: 'same', note: 'plural', keep: 'A', confidence: i % 2 === 0 ? 'high' : 'low' })) };
};

async function setup(pairs: number, cap: Partial<LibraryConfig['ai']['usageCap']> = {}) {
  await store.writeConfig(config(cap));
  const nodes = [];
  for (let i = 0; i < pairs; i++) nodes.push(node(`a${i}`, `${word(i)}tion`), node(`b${i}`, `${word(i)}sion`));
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes }));
  for (let i = 0; i < pairs; i++) {
    await store.documents.put(doc(2 * i + 1, [`a${i}`]));
    await store.documents.put(doc(2 * i + 2, [`b${i}`]));
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-tagrun-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  await store.init();
  events = [];
  calls = [];
  onCall = null;
  script = { structuredFn: answerAll as never };
  const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  const rt = { store, organizer, reindexDocuments: async () => {} };
  s = {
    log: createMemoryLogger(),
    emit: (e: string, p: unknown) => {
      if (e === 'tagReview:aiProgress') events.push(p as TagAiProgress);
    },
    runtime: { require: async () => rt },
    settings: { get: async () => ({ deviceId: 'device-12345678', ai: { claudeCodePath: null, tokenCap: { monthlyTokens: null, warnAtPct: 80 } } }) },
    aiProvider: (cfg: { models: never }) => {
      const p = createMockAiProvider({ models: cfg.models, ...script });
      return Object.assign(Object.create(p), {
        completeStructured: async (r: { system: string; prompt: string }) => {
          calls.push({ system: r.system, prompt: r.prompt });
          onCall?.(calls.length);
          return p.completeStructured(r as never);
        },
        access: () => p.access(),
        isAvailable: () => p.isAvailable(),
      });
    },
    isOnline: () => true,
  } as unknown as MainServices;
});
afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe('Haiku decides all the pending questions (D-515), with the mock AI', () => {
  it('previews every question in as few calls as fit, with the total estimate', async () => {
    await setup(PAIRS);
    const plan = await aiPreview(s, {});
    expect(plan.pairs).toBeGreaterThan(BATCH_PAIRS);
    expect(plan.batchSize).toBe(BATCH_PAIRS);
    expect(plan.batches).toBe(Math.ceil(plan.pairs / BATCH_PAIRS));
    expect(plan.fitsPairs).toBe(plan.pairs);
    expect(plan.overCap).toBe(false);
    expect(plan.estimatedUsd).not.toBeNull();
  });

  it('one run asks all of them, the instructions are the same bytes in every call, and progress is reported per call', async () => {
    await setup(PAIRS);
    const plan = await aiPreview(s, {});
    const r = await aiRun(s, { confirmed: true, decide: true });
    expect(r.asked).toBe(plan.pairs);
    expect(calls).toHaveLength(plan.batches);
    expect(new Set(calls.map((c) => c.system)).size).toBe(1);
    expect(calls[0]?.system).toBe(AI_SYSTEM);
    const running = events.filter((e) => e.state === 'running');
    expect(running[0]).toMatchObject({ done: 0, total: plan.pairs, batches: plan.batches });
    expect(running.map((e) => e.done)).toEqual([0, ...Array.from({ length: plan.batches }, (_, i) => Math.min(plan.pairs, (i + 1) * BATCH_PAIRS))]);
    expect(events.at(-1)).toMatchObject({ state: 'done', done: plan.pairs, decided: r.decided?.items.length });
    expect(r.decided?.items.length).toBeGreaterThan(0);
    expect(r.errors).toBe(0);
    // the answers are cached: nothing is left to ask
    expect((await aiPreview(s, {})).pairs).toBe(0);
  });

  it('a pair is described once per call and a question costs fewer input tokens than before (about one tag line plus a short pair line)', async () => {
    await setup(PAIRS);
    await aiRun(s, { confirmed: true });
    const chars = calls.reduce((n, c) => n + c.system.length + c.prompt.length, 0);
    const asked = calls.reduce((n, c) => n + [...c.prompt.matchAll(/^\d+\. t\d+ \| t\d+$/gm)].length, 0);
    // Before: 60 questions a call, each line with both full names, path and counts, and the instructions in every call.
    const tag = new Map<string, string>();
    for (const c of calls) for (const m of c.prompt.matchAll(/^(t\d+) "(.*?)" \((\d+)/gm)) tag.set(`${c.prompt.length}:${m[1]}`, `"${m[2]}" (${m[3]} papers)`);
    let oldChars = 0;
    for (const c of calls) {
      for (const m of c.prompt.matchAll(/^(\d+)\. (t\d+) \| (t\d+)$/gm)) oldChars += `${m[1]}. A: ${tag.get(`${c.prompt.length}:${m[2]}`)} | B: ${tag.get(`${c.prompt.length}:${m[3]}`)}
`.length;
    }
    const legacy = (oldChars + Math.ceil(asked / 60) * (AI_SYSTEM.length + 40)) / 4 / asked;
    const now = chars / 4 / asked;
    console.log(`input tokens per question: before ~${legacy.toFixed(1)} after ${now.toFixed(1)} (calls ${calls.length}, questions ${asked})`);
    expect(now).toBeLessThan(legacy);
  });

  it('the cap: the preview says how many fit, and the run asks only those', async () => {
    await setup(PAIRS);
    const all = await aiPreview(s, {});
    // room for about a third of the estimate
    await store.writeConfig(config({ monthlyUsd: (all.estimatedUsd as number) / 3 }));
    const plan = await aiPreview(s, {});
    expect(plan.overCap).toBe(true);
    expect(plan.fitsPairs).toBeGreaterThan(0);
    expect(plan.fitsPairs).toBeLessThan(plan.pairs);
    expect(plan.capUsd).toBeCloseTo((all.estimatedUsd as number) / 3, 10);
    const r = await aiRun(s, { confirmed: true });
    expect(r.asked).toBe(plan.fitsPairs);
    expect(r.capped).toBe(plan.pairs - plan.fitsPairs);
  });

  it('a cap with no room refuses and sends nothing', async () => {
    await setup(PAIRS, { monthlyUsd: 1e-9 });
    expect((await aiPreview(s, {})).fitsPairs).toBe(0);
    await expect(aiRun(s, { confirmed: true })).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    expect(calls).toHaveLength(0);
  });

  it('cancel keeps what is already decided as its own undoable change', async () => {
    await setup(PAIRS);
    const before = (await store.readTaxonomy()).nodes.filter((n) => n.status === 'active').length;
    onCall = (n) => {
      if (n === 1) expect(aiCancel()).toEqual({ ok: true });
    };
    const r = await aiRun(s, { confirmed: true, decide: true });
    expect(calls).toHaveLength(1);
    expect(r.cancelled).toBe(true);
    expect(r.asked).toBe(BATCH_PAIRS);
    expect(r.decided?.items.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ state: 'cancelled', done: BATCH_PAIRS });
    const after = (await store.readTaxonomy()).nodes.filter((n) => n.status === 'active').length;
    expect(after).toBe(before - (r.decided?.items.length ?? 0));
    await (await s.runtime.require()).organizer.undo(r.decided?.changeId as string);
    expect((await store.readTaxonomy()).nodes.filter((n) => n.status === 'active').length).toBe(before);
    // what was not asked stays pending
    expect((await aiPreview(s, {})).pairs).toBeGreaterThan(0);
    expect(aiCancel()).toEqual({ ok: false });
  });

  it('a failed call counts its questions as errors and the run goes on; the summary has the three numbers', async () => {
    await setup(PAIRS);
    let n = 0;
    script = {
      structuredFn: ((req: { prompt: string }) => {
        if (++n === 1) throw new Error('boom');
        return answerAll(req);
      }) as never,
    };
    const plan = await aiPreview(s, {});
    const r = await aiRun(s, { confirmed: true, decide: true });
    expect(r.errors).toBe(BATCH_PAIRS);
    expect(r.asked).toBe(plan.pairs - BATCH_PAIRS);
    expect(r.left).toBe(plan.pairs - (r.decided?.items.length ?? 0) - BATCH_PAIRS);
    expect(events.at(-1)).toMatchObject({ state: 'done', errors: BATCH_PAIRS });
  });

  it('the review still lists what Haiku left (nothing is lost)', async () => {
    await setup(40);
    await aiRun(s, { confirmed: true, decide: true });
    expect((await getReview(s, {})).auto.haiku?.items.length).toBeGreaterThan(0);
  });
});

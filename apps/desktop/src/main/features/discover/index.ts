import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError, DISCOVER_LIMITS, documentIdSchema, itemIdSchema, type DiscoverCandidate, type DiscoverKind, type DiscoverOutcome, type DiscoverRun, type DiscoverSummary, type DocumentId, type DocumentRecord } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import { availability, loadCtx, monthUsage } from '../../ai/service.js';
import { aiSends, isToolPurpose, monthOf } from '../../ai/usage.js';
import { callStructured } from '../../analysis/call.js';
import { online, ownedIndex } from '../../citations/context.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import type { LibraryRuntime } from '../../library/library-runtime.js';
import { cacheHash, chunk, costDecision } from '../ai/batch.js';
import { abstracts, bridge, extend, question, resolveSeed, type Deps, type Seed } from './engine.js';
import { listRuns, pruneRuns, readRun, removeRun, writeRun } from './store.js';
import { cleanSummaries, readCachedSummary, SUMMARY_BLOCK, SUMMARY_TOKENS, SUMMARY_VERSION, summaryAnswerSchema, summaryPrompt, summarySystem } from './summary.js';

/**
 * Discovery runs (features 41 and 42, §17.4.17): "Estendi la bibliografia", "Da una domanda" and "Trova un ponte". The
 * default result needs no Claude and downloads nothing; each run is saved in `discover/runs/<id>.json`. "✦ Sintesi" is the
 * only step that uses Claude, on request, for the best 10, 20 or 50 and from their public abstracts. Loaded on demand.
 */
const running = new Map<string, AbortController>();

const titleOf = (d: DocumentRecord): string => d.title ?? path.basename(d.path);
const ref = (d: DocumentRecord) => ({ docId: d.id, title: titleOf(d) });

async function docsOf(rt: LibraryRuntime, g: { docIds: string[]; projectId?: string | undefined } | undefined): Promise<DocumentRecord[]> {
  const ids = [...(g?.docIds ?? [])];
  if (g?.projectId) {
    const p = await rt.store.projects.get(itemIdSchema.parse(g.projectId));
    if (!p) throw new AppError('NOT_FOUND', 'Unknown project');
    ids.push(...p.members.map((m) => m.docId));
  }
  const out: DocumentRecord[] = [];
  for (const id of [...new Set(ids)].slice(0, DISCOVER_LIMITS.seeds)) {
    const d = await rt.store.documents.get(documentIdSchema.parse(id) as DocumentId).catch(() => null);
    if (d) out.push(d);
  }
  return out;
}

async function seedOf(rt: LibraryRuntime, d: DocumentRecord): Promise<Seed> {
  const file = await rt.store.citations.get(d.id).catch(() => null);
  return { docId: d.id, title: titleOf(d), doi: d.doi, arxivId: d.arxivId, externalId: file?.externalId ?? null };
}

/** Resolves the documents to OpenAlex ids; the ones that cannot be resolved are returned apart. */
async function resolveAll(rt: LibraryRuntime, deps: Deps, docs: DocumentRecord[]) {
  const ids: string[] = [];
  const missing: DocumentRecord[] = [];
  for (const d of docs) {
    const id = await resolveSeed(deps, await seedOf(rt, d));
    if (id) ids.push(id);
    else missing.push(d);
  }
  return { ids: [...new Set(ids)], missing };
}

const isOffline = (e: unknown): boolean => AppError.from(e).details?.['reason'] === 'offline';

/** The one place a run is made: what to search and with which parameters (kept in the file, so "Riesegui" needs nothing more). */
interface Params {
  kind: DiscoverKind;
  query: string;
  a: DocumentRecord[];
  b: DocumentRecord[];
  /** The name shown for an extend or bridge run (a project or the documents). */
  label: string;
}

async function execute(s: MainServices, p: Params, signal: AbortSignal): Promise<Omit<DiscoverRun, 'id' | 'createdAt'>> {
  const rt = await s.runtime.require();
  const base = { kind: p.kind, title: p.kind === 'question' ? p.query : p.label, sides: p.kind === 'bridge' ? [p.a.map(ref), p.b.map(ref)] : p.kind === 'extend' ? [p.a.map(ref)] : [], missing: [] as DiscoverRun['missing'], local: [] as DiscoverRun['local'], seedCount: p.a.length + p.b.length, items: [] as DiscoverCandidate[], summarizedWith: null, candidates: 0, fresh: 0 };
  const done = (outcome: DiscoverOutcome, items: DiscoverCandidate[] = [], more: Partial<typeof base> = {}) => ({ ...base, ...more, outcome, items, candidates: items.length });
  // The local index answers a question without any network (and says what the library already has).
  let local: DiscoverRun['local'] = [];
  if (p.kind === 'question') {
    const hits = await rt.search({ text: p.query, limit: 8 }).catch(() => ({ hits: [] as Array<{ docId: string; title: string | null; path: string }> }));
    local = hits.hits.map((h) => ({ docId: h.docId as DocumentId, title: h.title ?? path.basename(h.path) }));
  }
  let deps: Deps;
  try {
    const o = await online(s);
    deps = { net: o.net, owned: await ownedIndex(rt, true), signal };
  } catch (e) {
    if (isOffline(e)) return done('offline', [], { local });
    throw e;
  }
  try {
    if (p.kind === 'question') {
      const items = await question(deps, p.query);
      return done(items.length > 0 ? 'ok' : 'no-candidates', items, { local });
    }
    const a = await resolveAll(rt, deps, p.a);
    const b = p.kind === 'bridge' ? await resolveAll(rt, deps, p.b) : { ids: [] as string[], missing: [] as DocumentRecord[] };
    const missing = [...a.missing, ...b.missing].map(ref);
    // A bridge needs both sides; an extension needs at least one document the source knows.
    if (a.ids.length === 0 || (p.kind === 'bridge' && b.ids.length === 0)) return done('missing-id', [], { missing });
    if (p.kind === 'extend') {
      const items = await extend(deps, a.ids);
      return done(items.length > 0 ? 'ok' : 'no-candidates', items, { missing });
    }
    const items = await bridge(deps, a.ids, b.ids);
    if (items.length === 0) return done('no-candidates', [], { missing });
    return done(items.some((c) => !c.weak) ? 'ok' : 'no-bridge', items, { missing });
  } catch (e) {
    if (isOffline(e)) return done('offline', [], { local });
    throw e;
  }
}

/** Offline and missing-identifier answers are shown, not stored: there is nothing in them to come back to. */
const persisted = (o: DiscoverOutcome): boolean => o === 'ok' || o === 'no-candidates' || o === 'no-bridge';

async function guarded<T>(token: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  running.get(token)?.abort();
  running.set(token, ctl);
  try {
    return await fn(ctl.signal);
  } finally {
    if (running.get(token) === ctl) running.delete(token);
  }
}

export async function startDiscover(s: MainServices, req: { token: string; kind: DiscoverKind; query?: string | undefined; a?: { docIds: string[]; projectId?: string | undefined } | undefined; b?: { docIds: string[]; projectId?: string | undefined } | undefined }): Promise<{ run: DiscoverRun }> {
  const rt = await s.runtime.require();
  const a = await docsOf(rt, req.a);
  const b = await docsOf(rt, req.b);
  if (req.kind === 'question' && !req.query?.trim()) throw new AppError('INVALID_REQUEST', 'A question is needed');
  if (req.kind !== 'question' && a.length === 0) throw new AppError('INVALID_REQUEST', 'No documents to start from');
  if (req.kind === 'bridge' && b.length === 0) throw new AppError('INVALID_REQUEST', 'A bridge needs two sides');
  const project = req.a?.projectId ? await rt.store.projects.get(itemIdSchema.parse(req.a.projectId)) : null;
  const label = project?.name ?? a.slice(0, 3).map(titleOf).join(' · ');
  const out = await guarded(req.token, (signal) => execute(s, { kind: req.kind, query: req.query?.trim() ?? '', a, b, label }, signal));
  const run: DiscoverRun = { ...out, id: randomUUID(), createdAt: new Date().toISOString() };
  if (persisted(run.outcome)) await writeRun(rt.store.dataDir, run);
  return { run };
}

export async function rerunDiscover(s: MainServices, req: { token: string; id: string }): Promise<{ run: DiscoverRun }> {
  const rt = await s.runtime.require();
  const old = await readRun(rt.store.dataDir, req.id);
  if (!old) throw new AppError('NOT_FOUND', 'Unknown search');
  const refetch = async (side: ReadonlyArray<{ docId: string }> | undefined) => (await docsOf(rt, { docIds: (side ?? []).map((d) => d.docId) }));
  const params: Params = { kind: old.kind, query: old.title, a: await refetch(old.sides[0]), b: await refetch(old.sides[1]), label: old.title };
  if (old.kind !== 'question' && (params.a.length === 0 || (old.kind === 'bridge' && params.b.length === 0))) throw new AppError('NOT_FOUND', 'The documents of this search are no longer in the library');
  const out = await guarded(req.token, (signal) => execute(s, params, signal));
  if (!persisted(out.outcome)) return { run: { ...out, id: old.id, createdAt: old.createdAt } };
  const before = new Map(old.items.map((c) => [c.key, c]));
  // What was seen before keeps the user's choice and its summary; what was not is new.
  const items = out.items.map((c) => {
    const was = before.get(c.key);
    return was ? { ...c, state: was.state, summary: was.summary, fresh: false } : { ...c, fresh: old.items.length > 0 };
  });
  const run: DiscoverRun = { ...out, items, fresh: items.filter((c) => c.fresh).length, id: old.id, createdAt: old.createdAt, summarizedWith: old.summarizedWith };
  await writeRun(rt.store.dataDir, run);
  return { run };
}

export const cancelDiscover = async (req: { token: string }): Promise<{ ok: true }> => {
  running.get(req.token)?.abort();
  return { ok: true };
};

export async function listDiscover(s: MainServices) {
  return { items: await listRuns((await s.runtime.require()).store.dataDir) };
}

export async function getDiscover(s: MainServices, req: { id: string }): Promise<{ run: DiscoverRun }> {
  const run = await readRun((await s.runtime.require()).store.dataDir, req.id);
  if (!run) throw new AppError('NOT_FOUND', 'Unknown search');
  return { run };
}

export async function markDiscover(s: MainServices, req: { id: string; key: string; state: DiscoverCandidate['state'] }): Promise<{ ok: true }> {
  const dir = (await s.runtime.require()).store.dataDir;
  const run = await readRun(dir, req.id);
  if (!run) throw new AppError('NOT_FOUND', 'Unknown search');
  await writeRun(dir, { ...run, items: run.items.map((c) => (c.key === req.key ? { ...c, state: req.state } : c)) });
  return { ok: true };
}

export async function removeDiscover(s: MainServices, req: { id: string }) {
  return { removed: await removeRun((await s.runtime.require()).store.dataDir, req.id) };
}

export async function pruneDiscover(s: MainServices, req: { days: number; dryRun: boolean }) {
  return { count: await pruneRuns((await s.runtime.require()).store.dataDir, req.days, req.dryRun) };
}

/* --------------------------------------------- ✦ Sintesi --------------------------------------------- */

/** The best N that can still be summarised: not dismissed, not weak. */
const bestOf = (run: DiscoverRun, count: number): DiscoverCandidate[] => run.items.filter((c) => c.state !== 'dismissed' && !c.weak).sort((a, b) => b.score - a.score).slice(0, count);

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** The cheap model by default: the configured one whose id says "haiku", else the default (D-419). */
const modelOf = (models: ReadonlyArray<{ id: string }>, fallback: string, wanted?: string): string => {
  const m = wanted ?? models.find((x) => /haiku/i.test(x.id))?.id ?? fallback;
  if (!models.some((x) => x.id === m)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  return m;
};

export async function estimateDiscover(s: MainServices, req: { id: string; count: 10 | 20 | 50; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const run = await readRun(rt.store.dataDir, req.id);
  if (!run) throw new AppError('NOT_FOUND', 'Unknown search');
  const model = modelOf(cfg.ai.models, cfg.ai.defaultModel, req.model);
  const todo = bestOf(run, req.count).filter((c) => c.summary === null);
  const requests = chunk(todo, SUMMARY_BLOCK).length;
  const approx = todo.length * SUMMARY_TOKENS.perAbstract + requests * SUMMARY_TOKENS.perRequest;
  const outTokens = todo.length * SUMMARY_TOKENS.outPerAbstract;
  const sends = aiSends(await rt.store.readLog({ type: 'ai-send' })).filter((e) => !isToolPurpose(e.purpose));
  const since = startOfLocalDay();
  const todayTokens = sends.filter((e) => e.at >= since).reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const cached = todo.length === 0;
  // Public abstracts only: no folder of the user is involved, so there is no first send and no folder to enable.
  const d = costDecision({ approxTokens: approx, cached, firstFolderSend: false, thresholdTokens: cfg.ai.costThresholdTokens, todayTokens, dailyCap: cfg.ai.dailyTokenCap, outTokens });
  const est = ctx.provider?.estimateCost({ model, promptChars: approx * 4, expectedOutputTokens: outTokens });
  return {
    model,
    approxTokens: approx,
    estimatedUsd: est?.usd ?? null,
    cached,
    folderEnabled: true,
    firstFolderSend: false,
    thresholdTokens: cfg.ai.costThresholdTokens,
    needsDialog: d.needsDialog,
    todayTokens,
    dailyCap: cfg.ai.dailyTokenCap,
    overDailyCap: d.overDailyCap,
    todayPct: d.todayPct,
    toWrite: todo.length,
    requests,
  };
}

export async function summarizeDiscover(s: MainServices, req: { token: string; id: string; count: 10 | 20 | 50; model?: string | undefined; confirmed: boolean }) {
  const ctx = await loadCtx(s);
  const { rt, cfg, provider } = ctx;
  const dir = rt.store.dataDir;
  const run = await readRun(dir, req.id);
  if (!run) throw new AppError('NOT_FOUND', 'Unknown search');
  const est = await estimateDiscover(s, req);
  const model = est.model;
  const todo = bestOf(run, req.count).filter((c) => c.summary === null);
  if (todo.length === 0) return { run, written: 0, cached: 0, noAbstract: 0 };
  if (est.needsDialog && !req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  if (est.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap', todayTokens: est.todayTokens, dailyCap: est.dailyCap });
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && (await monthUsage(rt, monthOf(new Date()))).usd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached');
  const av = await availability(s, provider);
  if (!av.available || !provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
  const o = await online(s);
  const deviceId = (await s.settings.get()).deviceId;
  const cacheDir = path.join(s.localDataDir, 'cache', 'discover', itemIdSchema.parse(rt.libraryId));
  const text = await abstracts({ net: o.net, owned: await ownedIndex(rt), signal: undefined }, todo.map((c) => c.key));
  const found = new Map<string, DiscoverSummary>();
  let cached = 0;
  const toSend: Array<{ key: string; title: string; abstract: string; file: string }> = [];
  for (const c of todo) {
    const abstract = text.get(c.key);
    if (!abstract) continue;
    const file = path.join(cacheDir, `${cacheHash([SUMMARY_VERSION, model, cfg.language, abstract])}.json`);
    const hit = await readCachedSummary(file);
    if (hit) {
      found.set(c.key, hit);
      cached++;
    } else toSend.push({ key: c.key, title: c.title ?? '', abstract, file });
  }
  const ctl = new AbortController();
  running.set(req.token, ctl);
  try {
    await mkdir(cacheDir, { recursive: true });
    for (const block of chunk(toSend, SUMMARY_BLOCK)) {
      const { value } = await callStructured(
        { s, ctx, provider, signal: ctl.signal, confirmed: true, deviceId, addUsd: () => {} },
        { purpose: 'discover', model, reasoning: cfg.ai.defaultReasoning, system: summarySystem(cfg.language), prompt: summaryPrompt(block), schema: summaryAnswerSchema, docIds: [], folders: [] },
      );
      const clean = cleanSummaries(value, new Set(block.map((b) => b.key)));
      for (const b of block) {
        const sum = clean.get(b.key);
        if (!sum) continue;
        found.set(b.key, sum);
        await atomicWriteJson(b.file, sum).catch((e: unknown) => s.log.warn('could not cache a summary', { error: e }));
      }
    }
  } finally {
    if (running.get(req.token) === ctl) running.delete(req.token);
  }
  // The run as it is now (the user may have marked candidates while the blocks were written).
  const fresh = (await readRun(dir, req.id)) ?? run;
  const next: DiscoverRun = { ...fresh, summarizedWith: found.size > 0 ? model : fresh.summarizedWith, items: fresh.items.map((c) => (found.has(c.key) ? { ...c, summary: found.get(c.key)! } : c)) };
  await writeRun(dir, next);
  return { run: next, written: found.size - cached, cached, noAbstract: todo.length - text.size };
}


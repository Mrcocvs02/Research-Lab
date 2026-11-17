import { randomUUID } from 'node:crypto';
import { activeTagNodes, cleanSuggestion, folderOf, inEnabledFolder, suggestPrompt, suggestSchema, suggestSystem, taxonomyBlock, type SuggestClean, type SuggestField, type SuggestRaw } from '@rl/ai';
import { AI_LIMITS, AppError, type AiJobStatus, type AiMeta, type DocumentId, type DocumentRecord, type ReasoningLevel, type ReviewStatus, type TokenUsage } from '@rl/core';
import type { z } from 'zod';
import type { aiJobRequestSchema, aiPreviewSchema } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';
import { availability, buildDataBlock, classifyDocs, computePreview, loadCtx, monthUsage, type AiCtx } from './service.js';
import { abortTracked } from './abort-registry.js';
import { createToolsHost } from './tools-host.js';
import { monthOf, usdOfUsage } from './usage.js';

type JobRequest = z.infer<typeof aiJobRequestSchema>;
type Preview = z.infer<typeof aiPreviewSchema>;

/** Pages characters of the excerpt one document sends (plus its metadata): a few thousand, never the whole text. */
export const JOB_EXCERPT_CHARS = 4000;
/** Pages read for the excerpt. */
const EXCERPT_PAGES = [1, 2, 3];
/** Consecutive provider failures after which a job stops (Claude unavailable would otherwise fail every document). */
export const JOB_MAX_PROVIDER_FAILURES = 3;
/** Progress events per second, at most. */
const PROGRESS_INTERVAL_MS = 250;

/** The `document.ai` key a job field fills, and the extra key tags also fill. */
const AI_KEY = { tags: 'suggestedTags', description: 'description', summary: 'summary', keywords: 'keywords', synonyms: 'synonyms' } as const;

const isUsage = (u: unknown): u is TokenUsage => typeof u === 'object' && u !== null && typeof (u as TokenUsage).inputTokens === 'number' && typeof (u as TokenUsage).outputTokens === 'number';

const status = (rec: DocumentRecord, key: keyof typeof rec.ai): ReviewStatus | undefined => rec.ai[key]?.review.status;

/** Fields a job would send for a document: without `regenerate` only those with no value; accepted and edited ones never. */
export function fieldsToSend(rec: DocumentRecord, fields: readonly SuggestField[], regenerate: boolean): SuggestField[] {
  return fields.filter((f) => {
    const st = status(rec, AI_KEY[f]);
    if (st === undefined) return true;
    if (st === 'accepted' || st === 'edited') return false;
    return regenerate;
  });
}

interface JobRec {
  status: AiJobStatus;
  libraryId: string;
  req: JobRequest;
  confirmed: boolean;
  plan: Array<{ docId: string }>;
  controller: AbortController;
  lastEmit: number;
  timer: NodeJS.Timeout | null;
  s: MainServices;
}

const jobs: JobRec[] = [];
const runningByLibrary = new Set<string>();

const toStatus = (j: JobRec): AiJobStatus => structuredClone(j.status);

function emit(j: JobRec, force: boolean): void {
  const now = Date.now();
  const send = () => {
    j.timer = null;
    j.lastEmit = Date.now();
    j.s.emit('jobs:progress', toStatus(j));
  };
  if (force || now - j.lastEmit >= PROGRESS_INTERVAL_MS) {
    if (j.timer) clearTimeout(j.timer);
    send();
  } else j.timer ??= setTimeout(send, PROGRESS_INTERVAL_MS - (now - j.lastEmit));
}

/** What a job would do: the allowed documents with something to send, those skipped, and the preview. */
async function plan(s: MainServices, ctx: AiCtx, req: JobRequest) {
  const classified = await classifyDocs(ctx.rt, ctx.cfg, req.docIds);
  const todo: DocumentRecord[] = [];
  let skipped = 0;
  for (const rec of classified.allowed) {
    if (fieldsToSend(rec, req.fields, req.regenerate).length > 0) todo.push(rec);
    else skipped++;
  }
  const tax = req.fields.includes('tags') ? await ctx.rt.store.readTaxonomy().catch(() => null) : null;
  const fixed = suggestSystem(req.fields, ctx.cfg.language).length + (req.fields.includes('tags') ? taxonomyBlock(activeTagNodes(tax)).length : 0) + 200;
  const { preview } = await computePreview(s, ctx, {
    purpose: 'job:suggest',
    model: req.model,
    docIds: [...todo.map((d) => d.id), ...classified.refused.map((r) => r.docId)],
    promptChars: fixed * todo.length,
  });
  return { todo, skipped, preview: preview as Preview };
}

export async function estimateJob(s: MainServices, req: JobRequest) {
  const ctx = await loadCtx(s);
  if (!ctx.cfg.ai.models.some((m) => m.id === req.model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  const p = await plan(s, ctx, req);
  return { preview: p.preview, skipped: p.skipped, toSend: p.todo.length };
}

export async function startJob(s: MainServices, req: JobRequest & { confirmed: boolean }): Promise<{ jobId: string }> {
  const ctx = await loadCtx(s);
  const { rt, cfg, provider } = ctx;
  if (!cfg.ai.models.some((m) => m.id === req.model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  const monthUsd = (await monthUsage(rt, monthOf(new Date()))).usd;
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && monthUsd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached', { monthUsd, capUsd: cap });
  const av = await availability(s, provider);
  if (!av.available || !provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
  const p = await plan(s, ctx, req);
  if (p.todo.length === 0) throw new AppError('INVALID_REQUEST', 'No document would be sent', { reason: 'nothing-to-send', skipped: p.skipped, refused: p.preview.refused.length });
  if (cap !== null && p.preview.overCap) throw new AppError('AI_BUDGET_EXCEEDED', 'This job would go over the monthly AI spending cap', { monthUsd, capUsd: cap, estimatedUsd: p.preview.estimatedUsd });
  if (p.preview.needsConfirmation && !req.confirmed) throw new AppError('CONFLICT', 'The job needs the confirmation of the user', { reason: 'needs-confirmation', preview: p.preview });

  const job: JobRec = {
    status: { jobId: randomUUID(), kind: 'suggest', fields: [...req.fields], model: req.model, state: 'queued', total: p.todo.length, done: 0, failed: 0, skipped: p.skipped, usd: 0, createdAt: new Date().toISOString() },
    libraryId: rt.libraryId,
    req,
    confirmed: req.confirmed,
    plan: p.todo.map((d) => ({ docId: d.id })),
    controller: new AbortController(),
    lastEmit: 0,
    timer: null,
    s,
  };
  jobs.unshift(job);
  trim();
  emit(job, true);
  void pump(rt.libraryId);
  return { jobId: job.status.jobId };
}

/** Drops the oldest finished jobs beyond the number kept. */
function trim(): void {
  for (let i = jobs.length - 1; i >= 0 && jobs.length > AI_LIMITS.jobsKept; i--) {
    if (jobs[i]!.status.state !== 'queued' && jobs[i]!.status.state !== 'running') jobs.splice(i, 1);
  }
}

export function cancelJob(jobId: string): boolean {
  const j = jobs.find((x) => x.status.jobId === jobId);
  if (!j || (j.status.state !== 'queued' && j.status.state !== 'running')) return false;
  j.controller.abort();
  if (j.status.state === 'queued') finish(j, 'cancelled');
  return true;
}

export function listJobs(): AiJobStatus[] {
  return jobs.map(toStatus);
}

/** Aborts every job (app quit or another library opened): the Claude Code processes end with them. */
export function abortAllJobs(): void {
  abortTracked();
  for (const j of jobs) if (j.status.state === 'queued' || j.status.state === 'running') j.controller.abort();
}

/** Resolves when no job of the library is running or queued (tests). */
export async function whenJobsIdle(): Promise<void> {
  for (let i = 0; i < 2000 && jobs.some((j) => j.status.state === 'queued' || j.status.state === 'running'); i++) await new Promise((r) => setTimeout(r, 5));
}

function finish(j: JobRec, state: AiJobStatus['state'], error?: { code: string; message: string }): void {
  j.status.state = state;
  j.status.finishedAt = new Date().toISOString();
  delete j.status.currentDocId;
  if (error) j.status.error = error;
  emit(j, true);
}

/** One job at a time per library: runs the next queued job of the library, then the one after it. */
async function pump(libraryId: string): Promise<void> {
  if (runningByLibrary.has(libraryId)) return;
  runningByLibrary.add(libraryId);
  try {
    for (;;) {
      const next = [...jobs].reverse().find((j) => j.libraryId === libraryId && j.status.state === 'queued');
      if (!next) break;
      await run(next).catch((e: unknown) => {
        next.s.log.error('AI job crashed', { error: e });
        finish(next, 'failed', { code: 'INTERNAL', message: 'The job stopped because of an internal error' });
      });
    }
  } finally {
    runningByLibrary.delete(libraryId);
  }
}

async function run(j: JobRec): Promise<void> {
  const { s, req } = j;
  j.status.state = 'running';
  emit(j, true);
  let ctx = await loadCtx(s);
  if (!ctx.provider) return finish(j, 'failed', { code: 'AI_PROVIDER_ERROR', message: 'Claude is not available' });
  const provider = ctx.provider;
  const host = createToolsHost({ s, rt: ctx.rt, provider: provider.id, model: req.model, confirmed: j.confirmed });
  const deviceId = (await s.settings.get()).deviceId;
  let providerFailures = 0;
  for (const item of j.plan) {
    if (j.controller.signal.aborted) return finish(j, 'cancelled');
    // The library may have changed (another one opened): stop, nothing is sent for the wrong library.
    const active = await s.runtime.require().catch(() => null);
    if (!active || active.libraryId !== j.libraryId) return finish(j, 'cancelled');
    ctx = { ...ctx, rt: active, cfg: await active.store.readConfig() };
    const { rt, cfg } = ctx;
    // The monthly cap, before EACH document.
    const monthUsd = (await monthUsage(rt, monthOf(new Date()))).usd;
    const cap = cfg.ai.usageCap.monthlyUsd;
    if (cap !== null && monthUsd >= cap) return finish(j, 'failed', { code: 'AI_BUDGET_EXCEEDED', message: 'The monthly AI spending cap is reached' });

    const rec = await rt.store.documents.get(item.docId as DocumentId).catch(() => null);
    if (!rec || rec.missing) {
      j.status.failed++;
      j.status.error = { code: 'NOT_FOUND', message: 'A document is missing' };
      emit(j, false);
      continue;
    }
    // The folder gate, read again for each document: a change made during the job counts at once.
    if (!inEnabledFolder(rec.path, cfg.aiEnabledFolders)) {
      j.status.failed++;
      j.status.error = { code: 'FOLDER_NOT_AI_ENABLED', message: 'A document is in a folder not enabled for AI' };
      emit(j, false);
      continue;
    }
    const fields = fieldsToSend(rec, req.fields, req.regenerate);
    if (fields.length === 0) {
      j.status.skipped++;
      j.status.total = Math.max(0, j.status.total - 1);
      emit(j, false);
      continue;
    }
    j.status.currentDocId = rec.id;
    emit(j, false);
    try {
      await suggestOne({ s, ctx, provider, host, j, rec, fields, deviceId });
      providerFailures = 0;
    } catch (e) {
      const err = AppError.from(e);
      if (j.controller.signal.aborted || err.code === 'CANCELLED') return finish(j, 'cancelled');
      if (err.code === 'AI_BUDGET_EXCEEDED') return finish(j, 'failed', { code: err.code, message: err.message });
      j.status.failed++;
      j.status.error = { code: err.code === 'INTERNAL' ? 'AI_PROVIDER_ERROR' : err.code, message: err.message.slice(0, 300) };
      emit(j, false);
      // Circuit breaker: Claude not answering is not going to get better one document later.
      providerFailures = err.code === 'AI_PROVIDER_ERROR' ? providerFailures + 1 : 0;
      if (providerFailures >= JOB_MAX_PROVIDER_FAILURES) return finish(j, 'failed', { code: 'AI_PROVIDER_ERROR', message: `Stopped after ${JOB_MAX_PROVIDER_FAILURES} failures in a row: ${err.message}`.slice(0, 300) });
    }
  }
  finish(j, 'done');
}

interface OneArgs {
  s: MainServices;
  ctx: AiCtx;
  provider: NonNullable<AiCtx['provider']>;
  host: ReturnType<typeof createToolsHost>;
  j: JobRec;
  rec: DocumentRecord;
  fields: SuggestField[];
  deviceId: string;
}

async function suggestOne(a: OneArgs): Promise<void> {
  const { s, ctx, provider, host, j, rec, fields } = a;
  const { rt, cfg } = ctx;
  const req = j.req;
  const tax = fields.includes('tags') ? await rt.store.readTaxonomy().catch(() => null) : null;
  const nodes = activeTagNodes(tax);
  const pages = await host.pageTexts(rec, EXCERPT_PAGES);
  const data = buildDataBlock(rec, pages, undefined, JOB_EXCERPT_CHARS);
  const system = suggestSystem(fields, cfg.language);
  const prompt = suggestPrompt(fields, data, nodes);
  const folder = folderOf(rec.path);
  const sendLog = (inputTokens: number, outputTokens: number | undefined, usd: number | null) =>
    rt.store.appendLog({
      type: 'ai-send',
      at: new Date().toISOString(),
      deviceId: a.deviceId,
      provider: provider.id,
      model: req.model,
      purpose: 'job:suggest',
      docIds: [rec.id],
      folders: [folder],
      approxInputTokens: inputTokens,
      ...(outputTokens !== undefined ? { approxOutputTokens: outputTokens } : {}),
      ...(usd !== null ? { estimatedCostUsd: usd } : {}),
      confirmed: j.confirmed,
    });
  const approxIn = Math.ceil((system.length + prompt.length) / 4);
  let result;
  try {
    result = await provider.completeStructured({ model: req.model, reasoning: req.reasoning as ReasoningLevel, system, prompt, schema: suggestSchema(fields), source: 'job:suggest', signal: j.controller.signal });
  } catch (e) {
    const d = AppError.from(e).details;
    // Logged when the content was (or may have been) sent, even if no usable answer came back; NOT when the provider
    // says nothing left the machine (a process that never started). The tokens it spent, when it reports them, count.
    if (d?.['sent'] !== false) {
      const spent = isUsage(d?.['usage']) ? d['usage'] : null;
      const usd = spent ? usdOfUsage(cfg.ai.models, req.model, spent) : null;
      j.status.usd += usd ?? 0;
      await sendLog(spent?.inputTokens ?? approxIn, spent?.outputTokens, usd).catch((err: unknown) => s.log.warn('could not log an AI send', { error: err }));
    }
    throw e;
  }
  const usd = usdOfUsage(cfg.ai.models, req.model, result.usage);
  j.status.usd += usd ?? 0;
  // The record of the send comes first and never decides the outcome; the write that follows needs a live, current library.
  await sendLog(result.usage.inputTokens, result.usage.outputTokens, usd).catch((err: unknown) => s.log.warn('could not log an AI send', { error: err }));
  // The job may have been cancelled, or another library opened, while the model was answering: write nothing then.
  if (j.controller.signal.aborted) throw new AppError('CANCELLED', 'Cancelled');
  const active = await s.runtime.require().catch(() => null);
  if (!active || active.libraryId !== j.libraryId) throw new AppError('CANCELLED', 'The library changed');
  const clean = cleanSuggestion(result.value as SuggestRaw, fields, tax);
  await writeProposals(s, rt, rec.id, clean, { ...result.meta, source: 'job:suggest' }, a.deviceId);
  j.status.done++;
  emit(j, false);
}

/** Writes the cleaned fields as PROPOSED; never over an accepted or edited value, nothing empty. Logged like the AI tool's writes. */
export async function writeProposals(s: MainServices, rt: AiCtx['rt'], docId: string, c: SuggestClean, meta: AiMeta, deviceId: string): Promise<string[]> {
  const written: string[] = [];
  const now = new Date().toISOString();
  const field = <T>(value: T) => ({ value, meta, review: { status: 'proposed' as const } });
  await rt.store.documents.update(docId as DocumentId, (cur) => {
    if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
    const ai = { ...cur.ai };
    const put = <K extends keyof typeof ai>(key: K, value: NonNullable<(typeof ai)[K]>['value'] | undefined, empty: boolean) => {
      const st = ai[key]?.review.status;
      if (value === undefined || empty || st === 'accepted' || st === 'edited') return;
      (ai as Record<string, unknown>)[key] = field(value);
      written.push(key);
    };
    put('suggestedTags', c.tags as never, !c.tags || c.tags.length === 0);
    put('suggestedNewTags', c.newTags as never, !c.newTags || c.newTags.length === 0);
    put('description', c.description as never, !c.description);
    put('summary', c.summary as never, !c.summary);
    put('keywords', c.keywords as never, !c.keywords || c.keywords.length === 0);
    put('synonyms', c.synonyms as never, !c.synonyms || c.synonyms.length === 0);
    return written.length > 0 ? { ...cur, ai, updatedAt: now } : cur;
  });
  if (written.length === 0) return written;
  await rt.store
    .appendLog({ type: 'change', at: now, deviceId, actor: 'ai', target: { kind: 'document', id: docId }, action: 'ai.field.write', summary: `AI proposed ${written.join(', ')}`, before: null, after: { fields: written, status: 'proposed', model: meta.model, source: meta.source } })
    .catch((e: unknown) => s.log.warn('could not log an AI proposal', { error: e }));
  await rt.reindexDocuments([docId as DocumentId]).catch((e: unknown) => s.log.warn('index refresh after an AI proposal failed', { error: e }));
  s.emit('library:changed', { kind: 'documents', ids: [docId] });
  return written;
}

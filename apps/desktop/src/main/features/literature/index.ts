import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { aiVisible, approxTokens, folderOf } from '@rl/ai';
import { splitSections } from '@rl/ai/analysis';
import { AppError, documentIdSchema, itemIdSchema, LITERATURE_KEYS, LITERATURE_MAX_DOCS, type DocumentId, type DocumentRecord, type LiteratureKey, type LiteratureNote } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import { callStructured } from '../../analysis/call.js';
import { createToolsHost } from '../../ai/tools-host.js';
import { availability, loadCtx, monthUsage, type AiCtx } from '../../ai/service.js';
import { aiSends, isToolPurpose, monthOf } from '../../ai/usage.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { cacheHash, costDecision } from '../ai/batch.js';
import { builtinTemplate, BUILTIN_ID, docValues, fillTemplate, listTemplates } from '../templates/index.js';
import { cleanLiterature, literaturePrompt, literatureSchema, literatureSystem, LITERATURE_OUT_TOKENS, LITERATURE_PAGES, LITERATURE_TEXT_CHARS, LITERATURE_VERSION, sectionMarkdown, type CleanSection } from './prompt.js';
import { readLiterature, removeLiterature, writeLiterature } from './store.js';

/**
 * Literature notes (feature 2, D-390, D-418): the note of a paper in seven sections, written from the enabled folders only.
 * - An enabled folder: one request per paper, logged, cached by hash(text) + model + prompt version, and the result is a
 *   draft ("proposed") until the user approves it. The text goes only on the user's request (the caller queues the papers,
 *   at most five per send).
 * - A folder not enabled: NO request. A poor note is made on this machine from the title and the abstract of the paper.
 * Loaded on demand (dynamic import behind the IPC handler).
 */
interface PaperPlan {
  rec: DocumentRecord;
  enabled: boolean;
  folder: string;
  system: string;
  prompt: string;
  pageCount: number;
  cacheFile: string;
  approxTokens: number;
}

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const hostOf = (s: MainServices, ctx: AiCtx, model: string, confirmed: boolean) => createToolsHost({ s, rt: ctx.rt, provider: ctx.cfg.ai.provider, model, confirmed });

/** The text of the paper with each page marked (`[page N]`), the longest pages shortened so that the whole fits the budget. */
export function pagesText(pages: ReadonlyArray<{ page: number; text: string }>, budget: number): string {
  const each = Math.max(400, Math.floor(budget / Math.max(1, pages.length)));
  return pages.map((p) => `[page ${p.page}]\n${p.text.trim().slice(0, each)}`).join('\n\n');
}

async function getRecord(ctx: AiCtx, docId: string): Promise<DocumentRecord> {
  const rec = await ctx.rt.store.documents.get(documentIdSchema.parse(docId) as DocumentId);
  if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
  return rec;
}

const isEnabled = (ctx: AiCtx, rec: DocumentRecord): boolean => aiVisible(rec.path, ctx.cfg) && !rec.missing;

async function plan(s: MainServices, ctx: AiCtx, docId: string, model: string): Promise<PaperPlan> {
  const rec = await getRecord(ctx, docId);
  const enabled = isEnabled(ctx, rec);
  const folder = folderOf(rec.path);
  const lang = ctx.cfg.language;
  const base = { rec, enabled, folder };
  const cacheOf = (hash: string) => path.join(s.localDataDir, 'cache', 'literature', itemIdSchema.parse(ctx.rt.libraryId), `${hash}.json`);
  // A document that may not be sent is not even read here: nothing about it goes into a prompt.
  if (!enabled) return { ...base, system: '', prompt: '', pageCount: 0, cacheFile: cacheOf('none'), approxTokens: 0 };
  const pages = await hostOf(s, ctx, model, false).pageTexts(rec, Array.from({ length: LITERATURE_PAGES }, (_, i) => i + 1));
  const text = pagesText(pages, LITERATURE_TEXT_CHARS);
  const meta = [`title: ${rec.title ?? path.basename(rec.path)}`, rec.authors.length ? `authors: ${rec.authors.slice(0, 6).join('; ')}` : '', rec.year ? `year: ${rec.year}` : ''].filter(Boolean).join('\n');
  const system = literatureSystem(lang);
  const prompt = literaturePrompt(meta, text);
  return { ...base, system, prompt, pageCount: pages.length, cacheFile: cacheOf(cacheHash([LITERATURE_VERSION, model, lang, text])), approxTokens: approxTokens(system.length + prompt.length) };
}

type Cached = { sections: CleanSection[]; model: string; at: string };
async function readCache(file: string): Promise<Cached | null> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as Partial<Cached>;
    const ok = Array.isArray(v.sections) && v.sections.every((x) => x && (LITERATURE_KEYS as readonly string[]).includes(x.key) && typeof x.text === 'string' && Array.isArray(x.pages));
    return ok && typeof v.model === 'string' && typeof v.at === 'string' ? (v as Cached) : null;
  } catch {
    return null;
  }
}

const modelOf = (ctx: AiCtx, wanted?: string): string => {
  const model = wanted ?? ctx.cfg.ai.defaultModel;
  if (!ctx.cfg.ai.models.some((m) => m.id === model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  return model;
};

export async function getLiterature(s: MainServices, req: { docId: string }): Promise<{ note: LiteratureNote | null; folderEnabled: boolean }> {
  const ctx = await loadCtx(s);
  const rec = await getRecord(ctx, req.docId);
  return { note: await readLiterature(ctx.rt.store.dataDir, req.docId), folderEnabled: isEnabled(ctx, rec) };
}

export async function estimateLiterature(s: MainServices, req: { docIds: string[]; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const ids = [...new Set(req.docIds)].slice(0, LITERATURE_MAX_DOCS);
  const model = modelOf(ctx, req.model);
  const plans: PaperPlan[] = [];
  for (const id of ids) plans.push(await plan(s, ctx, id, model));
  const caches = await Promise.all(plans.map(async (p) => (p.enabled ? (await readCache(p.cacheFile)) !== null : false)));
  const toSend = plans.filter((p, i) => p.enabled && !caches[i]);
  const approx = toSend.reduce((n, p) => n + p.approxTokens, 0);
  const sends = aiSends(await rt.store.readLog({ type: 'ai-send' })).filter((e) => !isToolPurpose(e.purpose));
  const since = startOfLocalDay();
  const todayTokens = sends.filter((e) => e.at >= since).reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const firstFolderSend = toSend.some((p) => !sends.some((e) => e.folders.includes(p.folder)));
  const outTokens = LITERATURE_OUT_TOKENS * toSend.length;
  const d = costDecision({ approxTokens: approx, cached: toSend.length === 0, firstFolderSend, thresholdTokens: cfg.ai.costThresholdTokens, todayTokens, dailyCap: cfg.ai.dailyTokenCap, outTokens });
  const est = ctx.provider?.estimateCost({ model, promptChars: approx * 4, expectedOutputTokens: outTokens });
  return {
    model,
    approxTokens: approx,
    estimatedUsd: est?.usd ?? null,
    cached: toSend.length === 0 && plans.some((p) => p.enabled),
    folderEnabled: plans.some((p) => p.enabled),
    firstFolderSend,
    thresholdTokens: cfg.ai.costThresholdTokens,
    // A literature note is always above the threshold (D-416): whatever is sent shows the dialog.
    needsDialog: toSend.length > 0,
    todayTokens,
    dailyCap: cfg.ai.dailyTokenCap,
    overDailyCap: d.overDailyCap,
    todayPct: d.todayPct,
    sent: toSend.length,
    cachedDocs: caches.filter(Boolean).length,
    abstractOnly: plans.filter((p) => !p.enabled).length,
  };
}

/** The template "Letteratura" as the user has it (a file in the data folder), or the built-in one. */
async function noteTemplate(s: MainServices, ctx: AiCtx): Promise<string> {
  const t = (await listTemplates(s)).items.find((x) => x.id === BUILTIN_ID);
  return (t ?? builtinTemplate(ctx.cfg.language)).body;
}

const SECTION_FOR: Record<LiteratureKey, string> = { problem: 'problema', contribution: 'contributo', method: 'metodo', results: 'risultati', data: 'dati', limits: 'limiti' };

async function render(s: MainServices, ctx: AiCtx, rec: DocumentRecord, sections: readonly CleanSection[], abstract?: string): Promise<string> {
  const values = await docValues(s, rec.id);
  for (const k of LITERATURE_KEYS) values[SECTION_FOR[k]] = '—';
  for (const sec of sections) values[SECTION_FOR[sec.key]] = sectionMarkdown(sec, rec.id);
  if (abstract !== undefined) values['problema'] = abstract === '' ? '—' : abstract;
  return fillTemplate(await noteTemplate(s, ctx), values).trimEnd();
}

/** The abstract of a paper, found on this machine (the section named so in the first pages, else a description of the record). Never sent. */
export async function abstractOf(s: MainServices, ctx: AiCtx, rec: DocumentRecord, model: string): Promise<string> {
  const pages = await hostOf(s, ctx, model, false).pageTexts(rec, [1, 2, 3]);
  const sec = splitSections(pages).find((x) => /^(?:\d+[.)]?\s*)?(?:abstract|summary|sommario|riassunto)\b/i.test(x.title) && x.text.trim().length > 40);
  const text = sec?.text ?? rec.userDescription ?? rec.ai.description?.value ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 1800);
}

export async function runLiterature(s: MainServices, req: { docId: string; model?: string | undefined; confirmed: boolean; regenerate: boolean }): Promise<{ note: LiteratureNote; cached: boolean }> {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const model = modelOf(ctx, req.model);
  const dataDir = rt.store.dataDir;
  const existing = await readLiterature(dataDir, req.docId);
  if (existing && !req.regenerate) return { note: existing, cached: true };
  if (existing?.review === 'approved' && existing.ai && !req.confirmed) throw new AppError('CONFLICT', 'The note was approved by the user: confirm to replace it', { reason: 'approved' });
  const p = await plan(s, ctx, req.docId, model);
  const done = (note: LiteratureNote) => {
    s.emit('library:changed', { kind: 'notes', ids: [req.docId] });
    return note;
  };
  if (!p.enabled) {
    const body = await render(s, ctx, p.rec, [], await abstractOf(s, ctx, p.rec, model));
    const note: LiteratureNote = { body, review: 'approved', ai: false, model: null, generatedAt: new Date().toISOString(), abstractOnly: true };
    await writeLiterature(dataDir, req.docId, note, LITERATURE_VERSION);
    return { note: done(note), cached: false };
  }
  let value = await readCache(p.cacheFile);
  const cached = value !== null;
  if (!value) {
    const est = await estimateLiterature(s, { docIds: [req.docId], model });
    if (est.needsDialog && !req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
    if (est.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap', todayTokens: est.todayTokens, dailyCap: est.dailyCap });
    const monthUsd = (await monthUsage(rt, monthOf(new Date()))).usd;
    const cap = cfg.ai.usageCap.monthlyUsd;
    if (cap !== null && monthUsd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached', { monthUsd, capUsd: cap });
    const provider = ctx.provider;
    const av = await availability(s, provider);
    if (!av.available || !provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
    const deviceId = (await s.settings.get()).deviceId;
    const { value: raw } = await callStructured(
      { s, ctx, provider, signal: new AbortController().signal, confirmed: true, deviceId, addUsd: () => {} },
      { purpose: 'literature', model, reasoning: cfg.ai.defaultReasoning, system: p.system, prompt: p.prompt, schema: literatureSchema, docIds: [req.docId], folders: [p.folder] },
    );
    value = { sections: cleanLiterature(raw, Math.max(p.pageCount, 1)), model, at: new Date().toISOString() };
    await mkdir(path.dirname(p.cacheFile), { recursive: true });
    await atomicWriteJson(p.cacheFile, value).catch((e: unknown) => s.log.warn('could not cache a literature note', { error: e }));
  }
  const note: LiteratureNote = { body: await render(s, ctx, p.rec, value.sections), review: 'proposed', ai: true, model: value.model, generatedAt: value.at, abstractOnly: false };
  await writeLiterature(dataDir, req.docId, note, LITERATURE_VERSION);
  return { note: done(note), cached };
}

export async function approveLiterature(s: MainServices, req: { docId: string }): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  const cur = await readLiterature(rt.store.dataDir, req.docId);
  if (!cur) throw new AppError('NOT_FOUND', 'There is no literature note for this document');
  if (cur.review !== 'approved') await writeLiterature(rt.store.dataDir, req.docId, { ...cur, review: 'approved' }, LITERATURE_VERSION);
  s.emit('library:changed', { kind: 'notes', ids: [req.docId] });
  return { ok: true };
}

export async function discardLiterature(s: MainServices, req: { docId: string }): Promise<{ removed: boolean }> {
  const rt = await s.runtime.require();
  const removed = await removeLiterature(rt.store.dataDir, req.docId);
  if (removed) s.emit('library:changed', { kind: 'notes', ids: [req.docId] });
  return { removed };
}

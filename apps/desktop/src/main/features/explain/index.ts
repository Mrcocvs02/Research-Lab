import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { approxTokens, folderOf } from '@rl/ai';
import { cleanExplain, EXPLAIN_VERSION, explainPrompt, explainSchema, explainSystem } from '@rl/ai/analysis';
import { AppError, explainResultSchema, itemIdSchema, type ExplainResult, type TokenUsage } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import { availability, classifyDocs, loadCtx, monthUsage, type AiCtx, providerError, capError, assertModel } from '../../ai/service.js';
import { assertTokenCap, noteSend } from '../../ai/token-cap.js';
import { aiSends, isToolPurpose, monthOf, usdOfUsage } from '../../ai/usage.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { cacheHash, costDecision } from '../ai/batch.js';

/**
 * "✦ Spiega" (feature 31, D-416, D-440): explains a selection, a crop caption and the paragraph around them. Sends only to an
 * enabled folder, only on request; logs the send; caches the answer by hash(content) + model + prompt version in the local
 * cache folder, so the same request is never sent twice. Loaded on demand (dynamic import behind the IPC handler).
 */
export interface ExplainReq {
  docId: string;
  page: number;
  text: string;
  around: string;
  detail: boolean;
  model?: string | undefined;
}

/** Output tokens assumed for the estimate (a short structured answer). */
const OUT_TOKENS = 400;

interface Plan {
  ctx: AiCtx;
  model: string;
  system: string;
  prompt: string;
  folder: string;
  folderEnabled: boolean;
  cacheFile: string;
  approxTokens: number;
}

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

async function plan(s: MainServices, req: ExplainReq): Promise<Plan> {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const model = req.model ?? cfg.ai.defaultModel;
  assertModel(cfg, model);
  const docs = await classifyDocs(rt, cfg, [req.docId]);
  const rec = docs.allowed[0];
  const system = explainSystem(cfg.language, req.detail);
  const prompt = explainPrompt({ page: req.page, text: req.text, around: req.around });
  const hash = cacheHash([EXPLAIN_VERSION, model, cfg.language, req.detail, req.text, req.around]);
  return {
    ctx,
    model,
    system,
    prompt,
    folder: rec ? folderOf(rec.path) : '',
    folderEnabled: rec !== undefined,
    cacheFile: path.join(s.localDataDir, 'cache', 'explain', itemIdSchema.parse(rt.libraryId), `${hash}.json`),
    approxTokens: approxTokens(system.length + prompt.length),
  };
}

type Cached = { result: ExplainResult; model: string; at: string };
async function readCache(p: Plan): Promise<Cached | null> {
  try {
    const v = JSON.parse(await readFile(p.cacheFile, 'utf8')) as Partial<Cached>;
    const r = explainResultSchema.safeParse(v.result);
    return r.success && typeof v.model === 'string' && typeof v.at === 'string' ? { result: r.data, model: v.model, at: v.at } : null;
  } catch {
    return null;
  }
}

export async function estimateExplain(s: MainServices, req: ExplainReq) {
  const p = await plan(s, req);
  const { rt, cfg } = p.ctx;
  const sends = aiSends(await rt.store.readLog({ type: 'ai-send' })).filter((e) => !isToolPurpose(e.purpose));
  const since = startOfLocalDay();
  const todayTokens = sends.filter((e) => e.at >= since).reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const cached = (await readCache(p)) !== null;
  const firstFolderSend = p.folderEnabled && !sends.some((e) => e.folders.includes(p.folder));
  const thresholdTokens = cfg.ai.costThresholdTokens;
  const dailyCap = cfg.ai.dailyTokenCap;
  const d = costDecision({ approxTokens: p.approxTokens, cached, firstFolderSend, thresholdTokens, todayTokens, dailyCap, outTokens: OUT_TOKENS });
  const est = p.ctx.provider?.estimateCost({ model: p.model, promptChars: p.system.length + p.prompt.length, expectedOutputTokens: OUT_TOKENS });
  return {
    model: p.model,
    approxTokens: p.approxTokens,
    estimatedUsd: est?.usd ?? null,
    cached,
    folderEnabled: p.folderEnabled,
    firstFolderSend,
    thresholdTokens,
    needsDialog: p.folderEnabled && d.needsDialog,
    todayTokens,
    dailyCap,
    overDailyCap: d.overDailyCap,
    todayPct: d.todayPct,
  };
}

const isUsage = (u: unknown): u is TokenUsage => typeof u === 'object' && u !== null && typeof (u as TokenUsage).inputTokens === 'number' && typeof (u as TokenUsage).outputTokens === 'number';

export async function runExplain(s: MainServices, req: ExplainReq & { confirmed: boolean }) {
  const p = await plan(s, req);
  const { rt, cfg, provider } = p.ctx;
  // Folder gate first: a document outside the enabled folders sends nothing.
  if (!p.folderEnabled) throw new AppError('FOLDER_NOT_AI_ENABLED', 'The folder of this document is not enabled for sending text', { docIds: [req.docId] });
  const hit = await readCache(p);
  if (hit) return { ...hit, cached: true };
  const est = await estimateExplain(s, req);
  if (est.needsDialog && !req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  if (est.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap', todayTokens: est.todayTokens, dailyCap: est.dailyCap });
  const monthUsd = (await monthUsage(rt, monthOf(new Date()))).usd;
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && monthUsd >= cap) throw capError(monthUsd, cap);
  await assertTokenCap(s, p.approxTokens);
  const av = await availability(s, provider);
  if (!av.available || !provider) throw providerError(av);
  const deviceId = (await s.settings.get()).deviceId;
  const log = (inputTokens: number, outputTokens: number | undefined, usd: number | null) =>
    rt.store
      .appendLog({
        type: 'ai-send',
        at: new Date().toISOString(),
        deviceId,
        provider: provider.id,
        model: p.model,
        purpose: 'explain',
        docIds: [req.docId],
        folders: [p.folder],
        approxInputTokens: inputTokens,
        ...(outputTokens !== undefined ? { approxOutputTokens: outputTokens } : {}),
        ...(usd !== null ? { estimatedCostUsd: usd } : {}),
        confirmed: true,
      })
      .then(() => noteSend(s, 'explain', inputTokens, outputTokens))
      .catch((e: unknown) => s.log.warn('could not log an AI send', { error: e }));
  let out;
  try {
    out = await provider.completeStructured({ model: p.model, reasoning: cfg.ai.defaultReasoning, system: p.system, prompt: p.prompt, schema: explainSchema, source: 'explain' });
  } catch (e) {
    const d = AppError.from(e).details;
    // Logged when the text was, or may have been, sent; not when the provider says nothing left the machine.
    if (d?.['sent'] !== false) {
      const spent = isUsage(d?.['usage']) ? d['usage'] : null;
      await log(spent?.inputTokens ?? p.approxTokens, spent?.outputTokens, spent ? usdOfUsage(cfg.ai.models, p.model, spent) : null);
    }
    throw e;
  }
  await log(out.usage.inputTokens, out.usage.outputTokens, usdOfUsage(cfg.ai.models, p.model, out.usage));
  const value: Cached = { result: cleanExplain(out.value), model: p.model, at: new Date().toISOString() };
  await mkdir(path.dirname(p.cacheFile), { recursive: true });
  await atomicWriteJson(p.cacheFile, value).catch((e: unknown) => s.log.warn('could not cache an explanation', { error: e }));
  return { ...value, cached: false };
}

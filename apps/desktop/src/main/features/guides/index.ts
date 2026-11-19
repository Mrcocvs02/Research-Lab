import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { aiVisible, approxTokens, folderOf } from '@rl/ai';
import { AppError, contentHashOf, documentIdSchema, REFS_LIMITS, type DocumentId, type DocumentRecord, type GuidePassage } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import { callStructured } from '../../analysis/call.js';
import { createToolsHost } from '../../ai/tools-host.js';
import { availability, loadCtx, monthUsage, type AiCtx, providerError } from '../../ai/service.js';
import { aiSends, isToolPurpose, monthOf } from '../../ai/usage.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { costDecision } from '../ai/batch.js';
import { getRecord } from '../ai/pick.js';
import { readLiterature } from '../literature/store.js';
import { cleanGuide, guideFromNote, guidePrompt, guideSchema, guideSystem, GUIDE_APPROX_TOKENS, GUIDE_PAGES, GUIDE_TEXT_CHARS, GUIDE_VERSION } from './prompt.js';

/**
 * The guide (experiment 30, D-425). `guides/<docId>.json` in the data folder is AI-owned and written only by `prepare`, which
 * sends the text once, on the user's confirmation, from an enabled folder. `get` never sends anything: the cache, else the
 * literature note, else "not prepared". Loaded on demand (dynamic import behind the IPC handler).
 */
interface GuideFile {
  version: string;
  ai: true;
  /** The content hash the guide was made for: a changed file makes it stale. */
  hash: string;
  model: string;
  at: string;
  passages: GuidePassage[];
}

const fileOf = (dataDir: string, docId: string) => path.join(dataDir, 'guides', `${documentIdSchema.parse(docId)}.json`);

async function readGuide(dataDir: string, docId: string, hash: string): Promise<GuideFile | null> {
  try {
    const v = JSON.parse(await readFile(fileOf(dataDir, docId), 'utf8')) as Partial<GuideFile>;
    const ok = v.version === GUIDE_VERSION && v.hash === hash && Array.isArray(v.passages) && v.passages.length <= REFS_LIMITS.passages && v.passages.every((p) => p && typeof p.page === 'number' && ['C', 'M', 'R', 'L'].includes(p.kind));
    return ok ? (v as GuideFile) : null;
  } catch {
    return null;
  }
}

export async function getGuide(s: MainServices, req: { docId: string }) {
  const ctx = await loadCtx(s);
  const rec = await getRecord(ctx, req.docId);
  const cached = await readGuide(ctx.rt.store.dataDir, req.docId, contentHashOf(rec));
  if (cached) return { state: 'ready' as const, source: 'cache' as const, passages: cached.passages, approxTokens: 0 };
  const note = await readLiterature(ctx.rt.store.dataDir, req.docId);
  const fromNote = note ? guideFromNote(note.body) : [];
  if (fromNote.length > 0) return { state: 'ready' as const, source: 'note' as const, passages: fromNote, approxTokens: 0 };
  const enabled = aiVisible(rec.path, ctx.cfg) && !rec.missing;
  return { state: enabled ? ('none' as const) : ('disabled' as const), source: null, passages: [], approxTokens: enabled ? GUIDE_APPROX_TOKENS : 0 };
}

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export async function prepareGuide(s: MainServices, req: { docId: string; confirmed: boolean }): Promise<{ passages: GuidePassage[] }> {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const rec = await getRecord(ctx, req.docId);
  const hash = contentHashOf(rec);
  const cached = await readGuide(rt.store.dataDir, req.docId, hash);
  if (cached) return { passages: cached.passages };
  if (!aiVisible(rec.path, cfg) || rec.missing) throw new AppError('PERMISSION_DENIED', 'The folder of this document is not enabled for sending text', { reason: 'folder-not-enabled' });
  // A guide always asks (D-416: above the threshold), whatever the settings say.
  if (!req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  const model = (cfg.ai.models.find((m) => /haiku/i.test(m.id)) ?? cfg.ai.models.find((m) => m.id === cfg.ai.defaultModel))?.id ?? cfg.ai.defaultModel;
  const host = createToolsHost({ s, rt, provider: cfg.ai.provider, model, confirmed: true });
  const pages = await host.pageTexts(rec, Array.from({ length: GUIDE_PAGES }, (_, i) => i + 1));
  if (pages.every((p) => p.text.trim() === '')) throw new AppError('INVALID_REQUEST', 'The document has no text to read', { reason: 'no-text' });
  const folder = folderOf(rec.path);
  const system = guideSystem(cfg.language);
  const each = Math.max(400, Math.floor(GUIDE_TEXT_CHARS / Math.max(1, pages.length)));
  const text = pages.map((p) => `[page ${p.page}]\n${p.text.trim().slice(0, each)}`).join('\n\n');
  const meta = [`title: ${rec.title ?? path.basename(rec.path)}`, rec.year ? `year: ${rec.year}` : ''].filter(Boolean).join('\n');
  const prompt = guidePrompt(meta, text);
  const sends = aiSends(await rt.store.readLog({ type: 'ai-send' })).filter((e) => !isToolPurpose(e.purpose));
  const since = startOfLocalDay();
  const todayTokens = sends.filter((e) => e.at >= since).reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const d = costDecision({ approxTokens: approxTokens(system.length + prompt.length), cached: false, firstFolderSend: false, thresholdTokens: cfg.ai.costThresholdTokens, todayTokens, dailyCap: cfg.ai.dailyTokenCap, outTokens: 900 });
  if (d.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap', todayTokens, dailyCap: cfg.ai.dailyTokenCap });
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && (await monthUsage(rt, monthOf(new Date()))).usd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached');
  const provider = ctx.provider;
  const av = await availability(s, provider);
  if (!av.available || !provider) throw providerError(av);
  const deviceId = (await s.settings.get()).deviceId;
  const { value: raw } = await callStructured(
    { s, ctx, provider, signal: new AbortController().signal, confirmed: true, deviceId, addUsd: () => {} },
    { purpose: 'guide', model, reasoning: cfg.ai.defaultReasoning, system, prompt, schema: guideSchema, docIds: [req.docId], folders: [folder] },
  );
  const passages = cleanGuide(raw, pages);
  const file: GuideFile = { version: GUIDE_VERSION, ai: true, hash, model, at: new Date().toISOString(), passages };
  await mkdir(path.dirname(fileOf(rt.store.dataDir, req.docId)), { recursive: true });
  await atomicWriteJson(fileOf(rt.store.dataDir, req.docId), file);
  return { passages };
}

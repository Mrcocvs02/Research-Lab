import { aiVisible, approxTokens, folderOf } from '@rl/ai';
import { AppError, documentIdSchema, type DocumentId, type DocumentRecord, type Outline } from '@rl/core';
import { callStructured } from '../../analysis/call.js';
import { availability, loadCtx, monthUsage, type AiCtx } from '../../ai/service.js';
import { aiSends, isToolPurpose, monthOf } from '../../ai/usage.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { costDecision } from '../ai/batch.js';
import { ctxOf } from './index.js';
import { CITE_OUT_TOKENS, CITE_VERSION, citePrompt, citeSchema, citeSystem, EVIDENCE_OUT_TOKENS, evidencePrompt, evidenceSchema, evidenceSystem, linkMarkers, REPORT_CONTEXT_CHARS, REPORT_OUT_TOKENS, REPORT_VERSION, reportPrompt, reportSchema, reportSystem } from './prompt.js';
import { listClaims, readConsent, readOutline } from './store.js';

/**
 * The two things of the Schema tab that talk to Claude (X7): the report of a period (D-400) and the citation suggestions for
 * ONE paragraph (D-423). Both show the exact text that leaves (`*Preview`, nothing is sent) and both are sent only after the
 * dialog. The paragraph needs its own consent per project. Documents outside the enabled folders are left out of every prompt.
 */
type Req = { projectId: string; days: number; audience: 'advisor' | 'group' | 'me'; parts: readonly string[]; model?: string | undefined };

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
export const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
export const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();

export const modelOf = (ctx: AiCtx, wanted?: string): string => {
  const model = wanted ?? ctx.cfg.ai.defaultModel;
  if (!ctx.cfg.ai.models.some((m) => m.id === model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  return model;
};

/** Tokens and cost of one send; the dialog is always shown (text of the user, D-416). */
export async function costs(ctx: AiCtx, model: string, chars: number, outTokens: number) {
  const { rt, cfg } = ctx;
  const tokens = approxTokens(chars);
  const since = startOfLocalDay();
  const todayTokens = aiSends(await rt.store.readLog({ type: 'ai-send' }))
    .filter((e) => !isToolPurpose(e.purpose) && e.at >= since)
    .reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const d = costDecision({ approxTokens: tokens, cached: false, firstFolderSend: false, thresholdTokens: cfg.ai.costThresholdTokens, todayTokens, dailyCap: cfg.ai.dailyTokenCap, outTokens });
  const est = ctx.provider?.estimateCost({ model, promptChars: chars, expectedOutputTokens: outTokens });
  return { model, approxTokens: tokens, estimatedUsd: est?.usd ?? null, needsDialog: true, overDailyCap: d.overDailyCap };
}

/** The folders of the documents that leave, so the log and the first-send check see them. */
export async function foldersOf(ctx: AiCtx, docIds: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const id of docIds) {
    const rec = await ctx.rt.store.documents.get(id as DocumentId);
    if (rec) out.add(folderOf(rec.path));
  }
  return [...out];
}

export async function send<T>(s: MainServices, ctx: AiCtx, input: { purpose: string; model: string; system: string; prompt: string; schema: import('zod').ZodType<T>; docIds: string[] }, tokens: { overDailyCap: boolean }, confirmed: boolean): Promise<T> {
  const { rt, cfg } = ctx;
  if (tokens.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap' });
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && (await monthUsage(rt, monthOf(new Date()))).usd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached');
  const av = await availability(s, ctx.provider);
  if (!av.available || !ctx.provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
  const deviceId = (await s.settings.get()).deviceId;
  const { value } = await callStructured({ s, ctx, provider: ctx.provider, signal: new AbortController().signal, confirmed, deviceId, addUsd: () => {} }, { ...input, reasoning: cfg.ai.defaultReasoning, folders: await foldersOf(ctx, input.docIds) });
  return value;
}

/* --------------------------------------------------------------- report --------------------------------------------------------------- */

interface Ctx {
  text: string;
  refs: Map<string, { docId: string; title: string }>;
  ready: boolean;
  docIds: string[];
}

/** The context of a report, one block per selected part; only documents in enabled folders (and not missing) appear in it. */
async function reportContext(s: MainServices, ctx: AiCtx, req: Req, outline: Outline | null): Promise<Ctx> {
  const { rt, cfg } = ctx;
  const { project, dataDir } = await ctxOf(s, req.projectId);
  const since = new Date(Date.now() - req.days * 86_400_000).toISOString();
  const refs = new Map<string, { docId: string; title: string }>();
  const byDoc = new Map<string, string>();
  const recs = new Map<string, DocumentRecord>();
  for (const m of project.members) {
    const rec = await rt.store.documents.get(documentIdSchema.parse(m.docId) as DocumentId);
    if (rec && !rec.missing && aiVisible(rec.path, cfg)) recs.set(m.docId, rec);
  }
  const ref = (docId: string): string => {
    const have = byDoc.get(docId);
    if (have) return have;
    const key = `R${refs.size + 1}`;
    refs.set(key, { docId, title: oneLine(recs.get(docId)?.title ?? 'paper') });
    byDoc.set(docId, key);
    return key;
  };
  const label = (docId: string) => {
    const r = recs.get(docId);
    return r ? `[${ref(docId)}] ${oneLine(r.title ?? 'untitled')}${r.authors[0] ? ` (${oneLine(r.authors[0])}${r.year ? `, ${r.year}` : ''})` : ''}` : null;
  };
  const blocks: string[] = [];
  const has = (p: string) => req.parts.includes(p);
  if (outline) {
    blocks.push(`OUTLINE\nidea: ${oneLine(outline.idea)}\n${outline.questions.map((q, i) => `question ${i + 1}: ${q.text}`).join('\n')}\n${outline.hypotheses.map((h) => `hypothesis: ${h}`).join('\n')}\nplan: ${oneLine(outline.plan)}`);
  }
  const days = `last ${req.days} days`;
  if (has('reading')) {
    const lines = [...recs.values()].filter((r) => (r.study.updatedAt ?? r.updatedAt) >= since && (r.study.state === 'reading' || r.study.state === 'read')).map((r) => `- ${label(r.id)} — ${r.study.state}`);
    if (lines.length) blocks.push(`READING (${days})\n${lines.join('\n')}`);
  }
  if (has('papers')) {
    const lines = project.members.filter((m) => m.addedAt >= since && recs.has(m.docId)).map((m) => `- ${label(m.docId)}`);
    if (lines.length) blocks.push(`PAPERS ADDED (${days})\n${lines.join('\n')}`);
  }
  if (has('highlights')) {
    const lines: string[] = [];
    for (const [docId] of recs) {
      const file = await rt.store.annotations.get(docId as DocumentId);
      for (const a of file?.annotations ?? []) if (a.createdAt >= since && a.kind !== 'area' && a.text.trim()) lines.push(`- ${label(docId)} p. ${a.page}: «${clip(oneLine(a.text), 240)}»${a.comment ? ` — comment: ${clip(oneLine(a.comment), 160)}` : ''}`);
    }
    if (lines.length) blocks.push(`HIGHLIGHTS (${days})\n${lines.slice(0, 40).join('\n')}`);
  }
  if (has('claims')) {
    const lines = (await listClaims(dataDir, req.projectId)).map((c) => `- claim: ${c.text}${c.evidence.filter((e) => recs.has(e.docId)).map((e) => `\n  ${e.stance === 'supports' ? 'supports' : 'contradicts'}: ${label(e.docId)} p. ${e.page}`).join('')}`);
    if (lines.length) blocks.push(`CLAIMS AND EVIDENCE\n${lines.slice(0, 30).join('\n')}`);
  }
  if (has('notes') && project.notes.trim()) blocks.push(`PROJECT NOTES\n${clip(project.notes.trim(), 6000)}`);
  if (has('next') && outline?.plan.trim()) blocks.push('NEXT STEPS\nPropose the next steps from the plan and from what is open.');
  const text = clip(blocks.join('\n\n'), REPORT_CONTEXT_CHARS);
  return { text, refs, ready: !!outline && outline.idea.trim() !== '', docIds: [...recs.keys()] };
}

export async function reportPreview(s: MainServices, req: Req) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  const { dataDir } = await ctxOf(s, req.projectId);
  const outline = await readOutline(dataDir, req.projectId);
  const c = await reportContext(s, ctx, req, outline);
  const text = c.ready ? reportPrompt(c.text) : '';
  const k = await costs(ctx, model, text.length + reportSystem(ctx.cfg.language, req.audience).length, REPORT_OUT_TOKENS);
  return { text, ready: c.ready, reason: c.ready ? null : ('no-outline' as const), ...k };
}

export async function reportRun(s: MainServices, req: Req & { confirmed: boolean }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  const { dataDir } = await ctxOf(s, req.projectId);
  const outline = await readOutline(dataDir, req.projectId);
  const c = await reportContext(s, ctx, req, outline);
  if (!c.ready) throw new AppError('INVALID_REQUEST', 'The research outline of the project is needed', { reason: 'no-outline' });
  if (!req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  const system = reportSystem(ctx.cfg.language, req.audience);
  const prompt = reportPrompt(c.text);
  const k = await costs(ctx, model, system.length + prompt.length, REPORT_OUT_TOKENS);
  const raw = await send(s, ctx, { purpose: 'project-report', model, system, prompt, schema: reportSchema, docIds: c.docIds }, k, req.confirmed);
  const date = new Date().toISOString().slice(0, 10);
  const body = `${linkMarkers(raw.markdown.trim().slice(0, 30_000), c.refs)}\n\n<!-- ✦ ${REPORT_VERSION} · ${model} -->`;
  // Nothing is written here: the user's confirmation in the dialog (`project:reportSave`) writes the file (I1).
  return { date, body };
}

/* ----------------------------------------------------------- citations ----------------------------------------------------------- */

interface Cand {
  id: string;
  docId: string;
  rec: DocumentRecord;
  page: number | null;
  meta: string;
  snippet: string;
}

const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'which', 'their', 'there', 'been', 'were', 'than', 'then', 'into', 'also', 'such', 'dello', 'della', 'delle', 'degli', 'sono', 'come', 'anche', 'questo', 'questa', 'nella', 'nelle']);
/** Local retrieval (nothing leaves): the project's papers first, then the library, at most ten candidates. */
async function candidates(s: MainServices, ctx: AiCtx, projectId: string, text: string): Promise<Cand[]> {
  const { rt, cfg } = ctx;
  const { project } = await ctxOf(s, projectId);
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter((w) => !STOP.has(w)).sort((a, b) => b.length - a.length).slice(0, 8);
  if (words.length === 0) return [];
  const hits = (await rt.search({ text: words.join(' OR '), limit: 40 })).hits;
  const members = new Set(project.members.map((m) => m.docId));
  const ordered = [...hits.filter((h) => members.has(h.docId)), ...hits.filter((h) => !members.has(h.docId))];
  const out: Cand[] = [];
  for (const h of ordered) {
    if (out.some((c) => c.docId === h.docId)) continue;
    const rec = await rt.store.documents.get(h.docId as DocumentId);
    if (!rec || rec.missing) continue;
    // The passage of a document outside the enabled folders is not sent: only its title, authors and year.
    const visible = aiVisible(rec.path, cfg);
    const page = h.page ?? h.pages?.[0]?.page ?? null;
    const snippet = visible ? clip(oneLine((h.pages?.[0]?.snippet ?? h.snippet ?? '').replace(/[\u0001\u0002]/g, '')), 400) : '';
    const id = `C${out.length + 1}`;
    out.push({ id, docId: rec.id, rec, page, snippet, meta: `title: ${oneLine(rec.title ?? 'untitled')}${rec.authors.length ? `\nauthors: ${oneLine(rec.authors.slice(0, 3).join('; '))}` : ''}${rec.year ? `\nyear: ${rec.year}` : ''}${page && snippet ? `\npage: ${page}` : ''}` });
    if (out.length === 10) break;
  }
  return out;
}

const keyOf = (r: DocumentRecord): string => r.citeKey ?? `${(r.authors[0] ?? 'anon').split(/[\s,]+/).filter(Boolean).slice(-1)[0]!.toLowerCase().replace(/[^a-z0-9]/g, '') || 'anon'}${r.year ?? ''}`;

export async function citePreview(s: MainServices, req: { projectId: string; text: string; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  const { dataDir } = await ctxOf(s, req.projectId);
  const cands = await candidates(s, ctx, req.projectId, req.text);
  const text = cands.length ? citePrompt(req.text, cands) : '';
  const k = await costs(ctx, model, text.length + citeSystem(ctx.cfg.language).length, CITE_OUT_TOKENS);
  return { text, consent: (await readConsent(dataDir, req.projectId)) !== null, candidates: cands.length, ...k };
}

export async function citeRun(s: MainServices, req: { projectId: string; text: string; model?: string | undefined; confirmed: boolean }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  const { dataDir } = await ctxOf(s, req.projectId);
  // The paragraphs of the user are not covered by the consent of the folders: the project's own consent comes first (D-423).
  if ((await readConsent(dataDir, req.projectId)) === null) throw new AppError('CONFLICT', 'The user has not agreed to send paragraphs of this project to Claude', { reason: 'consent' });
  if (!req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  const cands = await candidates(s, ctx, req.projectId, req.text);
  if (cands.length === 0) return { items: [] };
  const system = citeSystem(ctx.cfg.language);
  const prompt = citePrompt(req.text, cands);
  const k = await costs(ctx, model, system.length + prompt.length, CITE_OUT_TOKENS);
  const raw = await send(s, ctx, { purpose: 'project-cite', model, system, prompt, schema: citeSchema, docIds: cands.map((c) => c.docId) }, k, req.confirmed);
  const seen = new Set<string>();
  const items = raw.ranking.flatMap((r) => {
    const c = cands.find((x) => x.id === r.id);
    if (!c || seen.has(c.id)) return [];
    seen.add(c.id);
    return [{ docId: c.docId, title: c.rec.title ?? '', authors: c.rec.authors.slice(0, 3), year: c.rec.year ?? null, reason: clip(oneLine(r.reason), 300), page: c.snippet ? c.page : null, key: keyOf(c.rec) }];
  });
  return { items: items.slice(0, 3) };
}

/* ------------------------------------------------------------ evidence ------------------------------------------------------------ */

/** The passages (not the documents outside the enabled folders, which have no snippet) a claim can be checked against: page and text are both needed. */
async function passagesFor(s: MainServices, ctx: AiCtx, projectId: string, claimId: string): Promise<{ claim: string; passages: Cand[] }> {
  const { dataDir } = await ctxOf(s, projectId);
  const claim = (await listClaims(dataDir, projectId)).find((c) => c.id === claimId);
  if (!claim) throw new AppError('NOT_FOUND', 'Unknown claim');
  const passages = (await candidates(s, ctx, projectId, claim.text)).filter((c) => c.page !== null && c.snippet !== '').map((c, i) => ({ ...c, id: `C${i + 1}` }));
  return { claim: claim.text, passages };
}

export async function evidencePreview(s: MainServices, req: { projectId: string; claimId: string; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  const { claim, passages } = await passagesFor(s, ctx, req.projectId, req.claimId);
  const text = passages.length ? evidencePrompt(claim, passages) : '';
  const k = await costs(ctx, model, text.length + evidenceSystem(ctx.cfg.language).length, EVIDENCE_OUT_TOKENS);
  return { text, candidates: passages.length, ...k };
}

/** Never writes a claim: the dialog adds the evidence the user accepts (`project:addEvidence`). */
export async function evidenceRun(s: MainServices, req: { projectId: string; claimId: string; model?: string | undefined; confirmed: boolean }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  if (!req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  const { claim, passages } = await passagesFor(s, ctx, req.projectId, req.claimId);
  if (passages.length === 0) return { items: [] };
  const system = evidenceSystem(ctx.cfg.language);
  const prompt = evidencePrompt(claim, passages);
  const k = await costs(ctx, model, system.length + prompt.length, EVIDENCE_OUT_TOKENS);
  const raw = await send(s, ctx, { purpose: 'project-evidence', model, system, prompt, schema: evidenceSchema, docIds: passages.map((c) => c.docId) }, k, req.confirmed);
  const seen = new Set<string>();
  const items = raw.verdicts.flatMap((v) => {
    const c = passages.find((x) => x.id === v.id);
    if (!c || c.page === null || v.stance === 'unrelated' || seen.has(c.id)) return [];
    seen.add(c.id);
    return [{ docId: c.docId, title: c.rec.title ?? '', page: c.page, stance: v.stance, excerpt: clip(c.snippet, 600) }];
  });
  return { items };
}

export { CITE_VERSION };

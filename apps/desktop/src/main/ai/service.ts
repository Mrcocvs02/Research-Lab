import { randomUUID } from 'node:crypto';
import { approxTokens, buildSystemPrompt, createLibraryTools, estimateCostFromModels, folderOf, inEnabledFolder, isToolResult, usdFor, type AiProviderEx, type TokenUsageWithCost } from '@rl/ai';
import {
  AppError,
  documentIdSchema,
  type ChatMessage,
  type DocumentId,
  type DocumentRecord,
  type LibraryConfig,
  type ReasoningLevel,
  type ToolSpec,
} from '@rl/core';
import type { z } from 'zod';
import type { aiPreviewSchema, aiStatusSchema, chatCardSchema } from '@rl/core';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { MainServices } from '../ipc/handlers/services.js';
import { ChatStore, titleFrom, type ChatTurn } from './chat-store.js';
import { ensureGuide } from './guide-files.js';
import { createToolsHost } from './tools-host.js';
import { monthOf, summariseUsage, type UsageSummary } from './usage.js';

export type AiPreview = z.infer<typeof aiPreviewSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
type Card = z.infer<typeof chatCardSchema>;

/**
 * Size of what one context document adds to a message, in characters: metadata (about 600) plus the first pages (at most
 * 6000). The preview uses this ceiling; the real message never exceeds it. Tokens are always characters / 4.
 */
export const CONTEXT_META_CHARS = 600;
export const CONTEXT_PAGES_CHARS = 6000;
export const CONTEXT_DOC_CHARS = CONTEXT_META_CHARS + CONTEXT_PAGES_CHARS;
/** Page of the document the user is reading: its text is added to the first context document (at most this many characters). */
const CONTEXT_PAGE_CHARS = 4000;
/** Turns of the conversation sent back as history, at most. */
const HISTORY_TURNS = 20;

export interface AiCtx {
  rt: LibraryRuntime;
  cfg: LibraryConfig;
  provider: AiProviderEx | null;
}

export async function loadCtx(s: MainServices): Promise<AiCtx> {
  const rt = await s.runtime.require();
  const cfg = await rt.store.readConfig();
  const provider = s.aiProvider ? s.aiProvider({ provider: cfg.ai.provider, models: cfg.ai.models }) : null;
  return { rt, cfg, provider };
}

export async function monthUsage(rt: LibraryRuntime, month: string): Promise<UsageSummary> {
  const entries = await rt.store.readLog({ type: 'ai-send', since: `${month}-01T00:00:00.000Z` });
  return summariseUsage(entries, month);
}

/** Can Claude be used now? No token is spent. The reason says what is missing. */
export async function availability(s: MainServices, provider: AiProviderEx | null): Promise<{ available: boolean; auth: AiStatus['auth']; reason?: 'no-access' | 'offline' | 'error' }> {
  if (!provider) return { available: false, auth: 'none', reason: 'error' };
  const [access, usable] = await Promise.all([provider.access().catch(() => ({ auth: 'none' as const })), provider.isAvailable().catch(() => false)]);
  if (access.auth === 'none' || !usable) return { available: false, auth: access.auth, reason: 'no-access' };
  if (provider.id !== 'mock' && s.isOnline && !s.isOnline()) return { available: false, auth: access.auth, reason: 'offline' };
  return { available: true, auth: access.auth };
}

export async function computeStatus(s: MainServices): Promise<AiStatus> {
  const ctx = await loadCtx(s);
  const usage = await monthUsage(ctx.rt, monthOf(new Date()));
  const av = await availability(s, ctx.provider);
  const capUsd = ctx.cfg.ai.usageCap.monthlyUsd;
  const capReached = capUsd !== null && usage.usd >= capUsd;
  return {
    provider: ctx.provider?.id ?? ctx.cfg.ai.provider,
    available: av.available && !capReached,
    auth: av.auth,
    ...(av.reason ? { reason: av.reason } : capReached ? { reason: 'cap-reached' as const } : {}),
    enabledFolders: ctx.cfg.aiEnabledFolders,
    monthUsd: usage.usd,
    capUsd,
  };
}

/* --------------------------------- documents and preview --------------------------------- */

export interface DocClassification {
  allowed: DocumentRecord[];
  refused: Array<{ docId: string; reason: 'folder-not-enabled' | 'missing' | 'unknown' }>;
}

/** Sorts documents into those whose content may go (present, in an enabled folder) and those that may not, with the reason. */
export async function classifyDocs(rt: LibraryRuntime, cfg: LibraryConfig, docIds: readonly string[]): Promise<DocClassification> {
  const out: DocClassification = { allowed: [], refused: [] };
  for (const id of new Set(docIds)) {
    const rec = documentIdSchema.safeParse(id).success ? await rt.store.documents.get(id as DocumentId).catch(() => null) : null;
    if (!rec) out.refused.push({ docId: id, reason: 'unknown' });
    else if (!inEnabledFolder(rec.path, cfg.aiEnabledFolders)) out.refused.push({ docId: id, reason: 'folder-not-enabled' });
    else if (rec.missing) out.refused.push({ docId: id, reason: 'missing' });
    else out.allowed.push(rec);
  }
  return out;
}

export interface PreviewInput {
  purpose: string;
  model: string;
  docIds: readonly string[];
  promptChars: number;
}

/** What a send would include and cost, with the confirmation and cap rules of the library. Spends and sends nothing. */
export async function computePreview(s: MainServices, ctx: AiCtx, input: PreviewInput): Promise<{ preview: AiPreview; monthUsd: number; docs: DocClassification }> {
  const docs = await classifyDocs(ctx.rt, ctx.cfg, input.docIds);
  const chars = input.promptChars + docs.allowed.length * CONTEXT_DOC_CHARS;
  const est = estimateCostFromModels(ctx.cfg.ai.models, { model: input.model, promptChars: chars });
  const monthUsd = (await monthUsage(ctx.rt, monthOf(new Date()))).usd;
  const cap = ctx.cfg.ai.usageCap;
  const bulk = input.purpose !== 'chat';
  const needsConfirmation =
    (ctx.cfg.ai.confirmBeforeSend && docs.allowed.length > 0) || (bulk && est.usd !== null && est.usd > cap.confirmBatchAboveUsd);
  const overCap = cap.monthlyUsd !== null && monthUsd + (est.usd ?? 0) > cap.monthlyUsd;
  void s;
  return {
    monthUsd,
    docs,
    preview: {
      model: input.model,
      allowed: docs.allowed.map((d) => d.id),
      refused: docs.refused.map((r) => ({ docId: r.docId, reason: r.reason })),
      folders: [...new Set(docs.allowed.map((d) => folderOf(d.path)))],
      approxInputTokens: est.inputTokens,
      estimatedUsd: est.usd,
      needsConfirmation,
      overCap,
    },
  };
}

/* ------------------------------------- the chat turn ------------------------------------- */

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const stripMarkers = (t: string) => t.replace(/<<<DATA|DATA>>>/g, '[marker removed]');

/** One delimited DATA block for a context document: metadata plus the first pages, capped. Never the whole text. */
export function buildDataBlock(doc: DocumentRecord, pages: Array<{ page: number; text: string }>, extraPage?: { page: number; text: string }): string {
  const meta = [
    `id: ${doc.id}`,
    `title: ${doc.title ?? doc.path}`,
    doc.authors.length ? `authors: ${doc.authors.slice(0, 6).join('; ')}` : '',
    doc.year ? `year: ${doc.year}` : '',
    doc.doi ? `doi: ${doc.doi}` : '',
    `path: ${doc.path}`,
  ]
    .filter(Boolean)
    .join('\n');
  let budget = CONTEXT_PAGES_CHARS;
  const parts: string[] = [];
  for (const p of pages) {
    if (budget <= 0) break;
    const t = p.text.slice(0, budget);
    budget -= t.length;
    parts.push(`[page ${p.page}]\n${t}`);
  }
  if (extraPage && !pages.some((p) => p.page === extraPage.page)) parts.push(`[page ${extraPage.page}, the page the user is reading]\n${extraPage.text.slice(0, CONTEXT_PAGE_CHARS)}`);
  return `<<<DATA document\n${stripMarkers(clip(meta, CONTEXT_META_CHARS))}\n${stripMarkers(parts.join('\n'))}\nDATA>>>`;
}

const toolCardSummary = (name: string) => `Running ${name}`;

function inputDocIds(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return [];
  const o = input as { docId?: unknown; docIds?: unknown };
  const ids = [...(typeof o.docId === 'string' ? [o.docId] : []), ...(Array.isArray(o.docIds) ? o.docIds.filter((x): x is string => typeof x === 'string') : [])];
  return ids.filter((x) => documentIdSchema.safeParse(x).success).slice(0, 50);
}

interface RunningTurn {
  conversationId: string;
  controller: AbortController;
  /** The conversation was deleted while the turn ran: nothing is written back. */
  discard: boolean;
}
const running = new Map<string, RunningTurn>();

/** Aborts every running turn (app quit): their Claude Code processes end with them. */
export function abortAllChatTurns(): void {
  for (const t of running.values()) t.controller.abort();
}

export function cancelTurn(turnId: string): boolean {
  const t = running.get(turnId);
  if (!t) return false;
  t.controller.abort();
  return true;
}

export function discardConversationTurns(conversationId: string): void {
  for (const t of running.values()) {
    if (t.conversationId === conversationId) {
      t.discard = true;
      t.controller.abort();
    }
  }
}

export interface SendInput {
  conversationId?: string | undefined;
  text: string;
  model: string;
  reasoning: ReasoningLevel;
  contextDocIds: string[];
  contextPage?: number | undefined;
  confirmed: boolean;
}

/** Validates and starts a turn; returns at once, the turn streams `chat:event`s. */
export async function startChatTurn(s: MainServices, input: SendInput): Promise<{ conversationId: string; turnId: string }> {
  const ctx = await loadCtx(s);
  const { rt, cfg, provider } = ctx;
  if (!cfg.ai.models.some((m) => m.id === input.model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  if (running.size > 0) throw new AppError('CONFLICT', 'Another answer is still being written', { reason: 'turn-running' });
  const store = new ChatStore(s.localDataDir, rt.libraryId);
  let conversationId = input.conversationId;
  let existing = null;
  if (conversationId !== undefined) {
    existing = await store.get(conversationId);
    if (!existing) throw new AppError('NOT_FOUND', 'Unknown conversation');
  } else conversationId = randomUUID();

  // 1. Monthly cap, before anything else.
  const monthUsd = (await monthUsage(rt, monthOf(new Date()))).usd;
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && monthUsd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached', { monthUsd, capUsd: cap });
  // 2. Access: nothing else of the app depends on it.
  const av = await availability(s, provider);
  if (!av.available || !provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
  // 3. Context documents: only from enabled folders. A refusal stops the whole send (nothing partial goes).
  const { preview, docs } = await computePreview(s, ctx, { purpose: 'chat', model: input.model, docIds: input.contextDocIds, promptChars: input.text.length });
  const notEnabled = docs.refused.filter((r) => r.reason === 'folder-not-enabled').map((r) => r.docId);
  if (notEnabled.length > 0) throw new AppError('FOLDER_NOT_AI_ENABLED', 'Some documents are in folders not enabled for AI', { docIds: notEnabled });
  if (docs.refused.length > 0) throw new AppError('NOT_FOUND', 'Some context documents are unknown or missing', { docIds: docs.refused.map((r) => r.docId) });
  if (cap !== null && preview.overCap) throw new AppError('AI_BUDGET_EXCEEDED', 'This send would go over the monthly AI spending cap', { monthUsd, capUsd: cap, estimatedUsd: preview.estimatedUsd });
  // 4. Confirmation, when documents go and the library asks for it.
  if (preview.needsConfirmation && !input.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation', preview });

  const turnId = randomUUID();
  const controller = new AbortController();
  running.set(turnId, { conversationId, controller, discard: false });
  const now = new Date().toISOString();
  const userTurn: ChatTurn = {
    id: randomUUID(),
    role: 'user',
    text: input.text,
    at: now,
    model: input.model,
    reasoning: input.reasoning,
    cards: [],
    contextDocIds: docs.allowed.map((d) => d.id),
  };
  const convoId = conversationId;
  try {
    await store.update(convoId, (cur) => ({
      version: 1,
      id: convoId,
      title: cur?.title ?? titleFrom(input.text),
      createdAt: cur?.createdAt ?? now,
      updatedAt: now,
      turns: [...(cur?.turns ?? []), userTurn],
    }));
  } catch (e) {
    running.delete(turnId);
    throw e;
  }
  const history: ChatMessage[] = (existing?.turns ?? [])
    .filter((t) => t.text.trim() !== '')
    .slice(-HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.text }));
  void runTurn({ s, ctx, provider, store, conversationId: convoId, turnId, controller, input, docs: docs.allowed, history, confirmed: input.confirmed }).catch((e: unknown) => {
    s.log.error('chat turn crashed', { error: e });
    running.delete(turnId);
  });
  return { conversationId: convoId, turnId };
}

interface RunArgs {
  s: MainServices;
  ctx: AiCtx;
  provider: AiProviderEx;
  store: ChatStore;
  conversationId: string;
  turnId: string;
  controller: AbortController;
  input: SendInput;
  docs: DocumentRecord[];
  history: ChatMessage[];
  confirmed: boolean;
}

async function runTurn(a: RunArgs): Promise<void> {
  const { s, ctx, provider, store, conversationId, turnId, controller, input } = a;
  const { rt, cfg } = ctx;
  const emit = (event: { type: 'text-delta'; text: string } | { type: 'card'; card: Card } | { type: 'usage'; usage: { inputTokens: number; outputTokens: number; usd: number | null } } | { type: 'done' } | { type: 'error'; code: string; message: string }) =>
    s.emit('chat:event', { conversationId, turnId, event });
  const turn: ChatTurn = { id: turnId, role: 'assistant', text: '', at: new Date().toISOString(), model: input.model, reasoning: input.reasoning, cards: [], contextDocIds: [] };
  let usage: TokenUsageWithCost | null = null;
  let terminal: { type: 'done' } | { type: 'error'; code: string; message: string } | null = null;
  let promptChars = input.text.length;
  try {
    const host = createToolsHost({ s, rt, provider: provider.id, model: input.model, confirmed: a.confirmed });
    const guide = await ensureGuide(await s.libraries.dataDir(rt.libraryId));
    const system = buildSystemPrompt(guide);
    // Context documents go as delimited DATA: metadata, abstract (first pages), never the whole text.
    const blocks: string[] = [];
    for (const [i, d] of a.docs.entries()) {
      const wanted = [1, 2, 3];
      const extra = i === 0 && input.contextPage !== undefined && !wanted.includes(input.contextPage) ? input.contextPage : undefined;
      const texts = await host.pageTexts(d, extra ? [...wanted, extra] : wanted);
      blocks.push(buildDataBlock(d, texts.filter((p) => p.page !== extra), extra ? texts.find((p) => p.page === extra) : undefined));
    }
    const readingNote = input.contextPage !== undefined && a.docs[0] ? `(The user is reading page ${input.contextPage} of document ${a.docs[0].id}.)\n` : '';
    const content = blocks.length ? `${blocks.join('\n')}\n${readingNote}\nUser request:\n${input.text}` : input.text;
    promptChars = system.length + content.length + a.history.reduce((n, m) => n + m.content.length, 0);

    // Tools: the library tools, wrapped to remember which documents each call touched (for the links of the cards).
    const touched = new Map<string, string[][]>();
    const remember = (name: string, ids: string[]) => touched.set(name, [...(touched.get(name) ?? []), ids]);
    const tools: ToolSpec[] = createLibraryTools({ host, model: input.model, provider: provider.id, purpose: 'chat' }).map((t) => ({
      ...t,
      async run(i, c) {
        try {
          const r = await t.run(i, c);
          remember(t.name, isToolResult(r) ? r.docIds.slice(0, 50) : []);
          return r;
        } catch (e) {
          remember(t.name, []);
          throw e;
        }
      },
    }));

    for await (const ev of provider.chat({ model: input.model, reasoning: input.reasoning, system, messages: [...a.history, { role: 'user', content }], tools, signal: controller.signal })) {
      if (ev.type === 'text-delta') {
        turn.text += ev.text;
        emit({ type: 'text-delta', text: ev.text });
      } else if (ev.type === 'tool-call') {
        const card: Card = { id: ev.id.slice(0, 100), name: ev.name.slice(0, 100), status: 'running', summary: toolCardSummary(ev.name), docIds: inputDocIds(ev.input) };
        turn.cards.push(card);
        emit({ type: 'card', card });
      } else if (ev.type === 'tool-result') {
        const card = turn.cards.find((c) => c.id === ev.id.slice(0, 100));
        if (card) {
          card.status = ev.ok ? 'done' : 'failed';
          card.summary = clip(ev.summary, 500);
          const ids = touched.get(ev.name)?.shift();
          if (ids && ids.length > 0) card.docIds = ids;
          emit({ type: 'card', card });
        }
      } else if (ev.type === 'usage') {
        usage = ev.usage;
        emit({ type: 'usage', usage: usageView(cfg, input.model, ev.usage) });
      } else if (ev.type === 'done') {
        terminal = { type: 'done' };
      } else if (ev.type === 'error') {
        terminal = { type: 'error', code: ev.code, message: ev.message };
      }
    }
  } catch (e) {
    const err = AppError.from(e);
    terminal = controller.signal.aborted ? { type: 'error', code: 'CANCELLED', message: 'Cancelled' } : { type: 'error', code: err.code === 'INTERNAL' ? 'AI_PROVIDER_ERROR' : err.code, message: clip(err.message, 300) };
  }
  terminal ??= controller.signal.aborted ? { type: 'error', code: 'CANCELLED', message: 'Cancelled' } : { type: 'done' };
  // A cancelled or failed card must not stay "running".
  for (const c of turn.cards) if (c.status === 'running') c.status = 'failed';

  const view = usageView(cfg, input.model, usage ?? { inputTokens: approxTokens(promptChars), outputTokens: approxTokens(turn.text.length) });
  turn.usage = view;
  if (terminal.type === 'error') turn.error = { code: terminal.code, message: terminal.message };
  const discard = running.get(turnId)?.discard ?? false;
  try {
    if (!discard) {
      await store.update(conversationId, (cur) => {
        const at = new Date().toISOString();
        const base = cur ?? { version: 1 as const, id: conversationId, title: titleFrom(input.text), createdAt: at, updatedAt: at, turns: [] };
        return { ...base, updatedAt: at, turns: [...base.turns, turn] };
      });
    }
    // One record of the send for the turn itself (what went and what it cost); the tool reads logged their own sizes.
    await rt.store.appendLog({
      type: 'ai-send',
      at: new Date().toISOString(),
      deviceId: (await s.settings.get()).deviceId,
      provider: provider.id,
      model: input.model,
      purpose: 'chat',
      docIds: a.docs.map((d) => d.id),
      folders: [...new Set(a.docs.map((d) => folderOf(d.path)))],
      approxInputTokens: view.inputTokens,
      approxOutputTokens: view.outputTokens,
      ...(view.usd !== null ? { estimatedCostUsd: view.usd } : {}),
      confirmed: a.confirmed,
    });
  } catch (e) {
    s.log.error('could not save the chat turn or its log entry', { error: e });
  } finally {
    running.delete(turnId);
  }
  emit(terminal);
}

function usageView(cfg: LibraryConfig, model: string, u: TokenUsageWithCost): { inputTokens: number; outputTokens: number; usd: number | null } {
  const usd = typeof u.costUsd === 'number' && Number.isFinite(u.costUsd) ? u.costUsd : usdFor(cfg.ai.models, model, u.inputTokens, u.outputTokens);
  return { inputTokens: Math.max(0, Math.round(u.inputTokens)), outputTokens: Math.max(0, Math.round(u.outputTokens)), usd: usd === null ? null : Math.max(0, usd) };
}

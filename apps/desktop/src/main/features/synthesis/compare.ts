import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { aiVisible, approxTokens, folderOf } from '@rl/ai';
import { COMPARE_BLOCK, COMPARE_PAPER_CHARS, COMPARE_TOKENS, COMPARE_VERSION, cleanCompare, compareAnswerSchema, comparePrompt, compareSystem } from '@rl/ai/analysis';
import { AppError, COMPARE_LIMITS, documentIdSchema, itemIdSchema, type CompareCell, type CompareColumn, type CompareRow, type CompareTable, type DocumentId, type DocumentRecord, type LiteratureKey } from '@rl/core';
import { atomicWriteJson, atomicWriteFile } from '@rl/core/node';
import { callStructured } from '../../analysis/call.js';
import { availability, loadCtx, monthUsage, type AiCtx } from '../../ai/service.js';
import { createToolsHost } from '../../ai/tools-host.js';
import { aiSends, isToolPurpose, monthOf } from '../../ai/usage.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { cacheHash, chunk, costDecision } from '../ai/batch.js';
import { readLiterature } from '../literature/store.js';
import { noteCells, rowLabel, splitCells } from './cells.js';
import { listTables, readTable, removeTable, tableCsv, writeTable } from './table-store.js';

/**
 * The comparison table (feature 16, §17.4.7). The cells the literature notes already have are reused with NO send; only the
 * missing cells are written by Claude, one request per column and block of up to ten papers, for papers of enabled folders only
 * (a paper of another folder gets "not enabled", nothing about it leaves). Haiku by default; every cell Claude writes carries
 * its ✦. The prompt is versioned in `packages/ai` (D-440). Loaded on demand.
 */
const running = new Map<string, AbortController>();

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** The cheap model by default: the configured one whose id says "haiku", else the default. */
export const cheapModel = (models: ReadonlyArray<{ id: string }>, fallback: string, wanted?: string): string => {
  const m = wanted ?? models.find((x) => /haiku/i.test(x.id))?.id ?? fallback;
  if (!models.some((x) => x.id === m)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  return m;
};

interface Paper {
  rec: DocumentRecord;
  label: string;
  enabled: boolean;
  folder: string;
  note: Map<LiteratureKey, { text: string; pages: number[] }> | null;
  noteAi: boolean;
}

interface Block {
  column: CompareColumn;
  papers: Paper[];
  system: string;
  prompt: string;
  /** Last page of each paper's text, by short key. */
  maxPage: Map<string, number>;
  keyOf: Map<string, string>;
  cacheFile: string;
  cached: Record<string, { text: string; pages: number[] }> | null;
  approx: number;
}

interface Plan {
  papers: Paper[];
  ready: Map<string, Record<string, CompareCell>>;
  fromNotes: number;
  readyCount: number;
  notEnabled: number;
  blocks: Block[];
  total: number;
}

const keyOf = (i: number) => `p${i + 1}`;

async function papersOf(ctx: AiCtx, docIds: readonly string[]): Promise<Paper[]> {
  const out: Paper[] = [];
  for (const id of [...new Set(docIds)].slice(0, COMPARE_LIMITS.docs)) {
    const rec = await ctx.rt.store.documents.get(documentIdSchema.parse(id) as DocumentId);
    if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
    const note = await readLiterature(ctx.rt.store.dataDir, rec.id);
    // The poor note made from the abstract has only the problem: the other sections stay empty and are asked for.
    out.push({ rec, label: rowLabel(rec), enabled: aiVisible(rec.path, ctx.cfg) && !rec.missing, folder: folderOf(rec.path), note: note ? noteCells(note.body) : null, noteAi: note?.ai ?? false });
  }
  return out;
}

async function plan(s: MainServices, ctx: AiCtx, req: { docIds: string[]; columns: CompareColumn[]; existing?: CompareRow[] | undefined }, model: string): Promise<Plan> {
  const papers = await papersOf(ctx, req.docIds);
  const split = splitCells(papers.map((p) => ({ id: p.rec.id, enabled: p.enabled, note: p.note, noteAi: p.noteAi })), req.columns, new Map((req.existing ?? []).map((r) => [r.docId, r.cells])));
  const ready = split.ready;
  const missing = new Map([...split.missing].map(([col, ids]) => [col, ids.map((id) => papers.find((p) => p.rec.id === id)!)]));
  const { fromNotes, ready: readyCount, notEnabled } = split.count;
  const lang = ctx.cfg.language;
  const host = createToolsHost({ s, rt: ctx.rt, provider: ctx.cfg.ai.provider, model, confirmed: false });
  const texts = new Map<string, { text: string; last: number }>();
  const textOf = async (p: Paper) => {
    let t = texts.get(p.rec.id);
    if (!t) {
      const pages = await host.pageTexts(p.rec, Array.from({ length: 60 }, (_, i) => i + 1));
      const each = Math.max(300, Math.floor(COMPARE_PAPER_CHARS / Math.max(1, pages.length)));
      t = { text: pages.map((x) => `[page ${x.page}]\n${x.text.trim().slice(0, each)}`).join('\n\n').slice(0, COMPARE_PAPER_CHARS * 2), last: pages.reduce((m, x) => Math.max(m, x.page), 0) };
      texts.set(p.rec.id, t);
    }
    return t;
  };
  const blocks: Block[] = [];
  for (const col of req.columns) {
    for (const group of chunk(missing.get(col.id) ?? [], COMPARE_BLOCK)) {
      const items: Array<{ key: string; title: string; text: string }> = [];
      const maxPage = new Map<string, number>();
      const keys = new Map<string, string>();
      for (const [i, p] of group.entries()) {
        const t = await textOf(p);
        items.push({ key: keyOf(i), title: p.rec.title ?? path.basename(p.rec.path), text: t.text });
        maxPage.set(keyOf(i), Math.max(t.last, 1));
        keys.set(keyOf(i), p.rec.id);
      }
      const system = compareSystem(lang, col);
      const prompt = comparePrompt(col.name, items);
      const hash = cacheHash([COMPARE_VERSION, model, lang, col.name, col.key, items.map((x) => x.text)]);
      const cacheFile = path.join(s.localDataDir, 'cache', 'compare', itemIdSchema.parse(ctx.rt.libraryId), `${hash}.json`);
      blocks.push({ column: col, papers: group, system, prompt, maxPage, keyOf: keys, cacheFile, cached: await readCache(cacheFile), approx: approxTokens(system.length + prompt.length) });
    }
  }
  return { papers, ready, fromNotes, readyCount, notEnabled, blocks, total: papers.length * req.columns.length };
}

async function readCache(file: string): Promise<Block['cached']> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as Record<string, { text: unknown; pages: unknown }>;
    const out: NonNullable<Block['cached']> = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x?.text !== 'string' || !Array.isArray(x.pages)) return null;
      out[k] = { text: x.text.slice(0, COMPARE_LIMITS.cell), pages: x.pages.filter((p): p is number => Number.isInteger(p) && p > 0).slice(0, 8) };
    }
    return out;
  } catch {
    return null;
  }
}

export async function estimateCompare(s: MainServices, req: { docIds: string[]; columns: CompareColumn[]; existing?: CompareRow[] | undefined; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const model = cheapModel(cfg.ai.models, cfg.ai.defaultModel, req.model);
  const p = await plan(s, ctx, req, model);
  const toSend = p.blocks.filter((b) => b.cached === null);
  const approx = toSend.reduce((n, b) => n + b.approx, 0);
  const cellsToWrite = p.blocks.reduce((n, b) => n + b.papers.length, 0);
  const sends = aiSends(await rt.store.readLog({ type: 'ai-send' })).filter((e) => !isToolPurpose(e.purpose));
  const since = startOfLocalDay();
  const todayTokens = sends.filter((e) => e.at >= since).reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const folders = new Set(toSend.flatMap((b) => b.papers.map((x) => x.folder)));
  const firstFolderSend = [...folders].some((f) => !sends.some((e) => e.folders.includes(f)));
  const outTokens = toSend.reduce((n, b) => n + b.papers.length * COMPARE_TOKENS.outPerCell, 0);
  const d = costDecision({ approxTokens: approx, cached: toSend.length === 0, firstFolderSend, thresholdTokens: cfg.ai.costThresholdTokens, todayTokens, dailyCap: cfg.ai.dailyTokenCap, outTokens });
  const est = ctx.provider?.estimateCost({ model, promptChars: approx * 4, expectedOutputTokens: outTokens });
  return {
    model,
    approxTokens: approx,
    estimatedUsd: est?.usd ?? null,
    cached: toSend.length === 0,
    folderEnabled: p.papers.some((x) => x.enabled),
    firstFolderSend,
    thresholdTokens: cfg.ai.costThresholdTokens,
    needsDialog: d.needsDialog,
    todayTokens,
    dailyCap: cfg.ai.dailyTokenCap,
    overDailyCap: d.overDailyCap,
    todayPct: d.todayPct,
    cells: { total: p.total, ready: p.readyCount, fromNotes: p.fromNotes, toWrite: cellsToWrite, notEnabled: p.notEnabled },
    requests: toSend.length,
  };
}

export async function runCompare(s: MainServices, req: { token: string; docIds: string[]; columns: CompareColumn[]; existing?: CompareRow[] | undefined; model?: string | undefined; confirmed: boolean }) {
  const est = await estimateCompare(s, req);
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const p = await plan(s, ctx, req, est.model);
  const rows: CompareRow[] = p.papers.map((x) => ({ docId: x.rec.id, label: x.label, cells: p.ready.get(x.rec.id) ?? {} }));
  const byId = new Map(rows.map((r) => [r.docId, r]));
  const toSend = p.blocks.filter((b) => b.cached === null);
  if (toSend.length > 0) {
    if (est.needsDialog && !req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
    if (est.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap', todayTokens: est.todayTokens, dailyCap: est.dailyCap });
    const cap = cfg.ai.usageCap.monthlyUsd;
    if (cap !== null && (await monthUsage(rt, monthOf(new Date()))).usd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached');
    const av = await availability(s, ctx.provider);
    if (!av.available || !ctx.provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
  }
  const ctl = new AbortController();
  running.get(req.token)?.abort();
  running.set(req.token, ctl);
  let written = 0;
  try {
    const deviceId = (await s.settings.get()).deviceId;
    for (const b of p.blocks) {
      let answer = b.cached;
      if (!answer) {
        if (ctl.signal.aborted) throw new AppError('CANCELLED', 'Cancelled');
        const { value } = await callStructured(
          { s, ctx, provider: ctx.provider!, signal: ctl.signal, confirmed: true, deviceId, addUsd: () => {} },
          { purpose: 'compare', model: est.model, reasoning: cfg.ai.defaultReasoning, system: b.system, prompt: b.prompt, schema: compareAnswerSchema, docIds: b.papers.map((x) => x.rec.id), folders: [...new Set(b.papers.map((x) => x.folder))] },
        );
        const clean = cleanCompare(value, b.maxPage);
        answer = {};
        for (const [k, v] of clean) answer[b.keyOf.get(k)!] = v;
        await mkdir(path.dirname(b.cacheFile), { recursive: true });
        await atomicWriteJson(b.cacheFile, answer).catch((e: unknown) => s.log.warn('could not cache comparison cells', { error: e }));
      }
      for (const x of b.papers) {
        const a = answer[x.rec.id];
        const cell: CompareCell = a && a.text !== '' ? { text: a.text, pages: a.pages, source: 'claude', ai: true } : { text: '', pages: [], source: 'none', ai: false, why: 'not-found' };
        byId.get(x.rec.id)!.cells[b.column.id] = cell;
        if (cell.source === 'claude') written++;
      }
    }
  } finally {
    if (running.get(req.token) === ctl) running.delete(req.token);
  }
  return { rows, fromNotes: p.fromNotes, written, requests: toSend.length };
}

export const cancelCompare = async (req: { token: string }): Promise<{ ok: true }> => {
  running.get(req.token)?.abort();
  return { ok: true };
};

/* ------------------------------------------------ the table in the project ------------------------------------------------ */

export async function saveCompare(s: MainServices, req: { id?: string | undefined; projectId: string; title: string; columns: CompareColumn[]; rows: CompareRow[] }): Promise<{ table: CompareTable }> {
  const rt = await s.runtime.require();
  if (!(await rt.store.projects.get(itemIdSchema.parse(req.projectId)))) throw new AppError('NOT_FOUND', 'Unknown project');
  const old = req.id ? await readTable(rt.store.dataDir, req.projectId, req.id) : null;
  const now = new Date().toISOString();
  const table: CompareTable = { id: itemIdSchema.parse(req.id ?? randomUUID()), projectId: req.projectId, title: req.title, createdAt: old?.createdAt ?? now, updatedAt: now, columns: req.columns, rows: req.rows };
  await writeTable(rt.store.dataDir, table);
  return { table };
}

export async function getCompare(s: MainServices, req: { projectId: string; id: string }): Promise<{ table: CompareTable }> {
  const t = await readTable((await s.runtime.require()).store.dataDir, req.projectId, req.id);
  if (!t) throw new AppError('NOT_FOUND', 'Unknown table');
  return { table: t };
}

export async function listCompare(s: MainServices, req: { projectId: string }) {
  return { items: await listTables((await s.runtime.require()).store.dataDir, req.projectId) };
}

export async function removeCompare(s: MainServices, req: { projectId: string; id: string }) {
  return { removed: await removeTable((await s.runtime.require()).store.dataDir, req.projectId, req.id) };
}

/** The CSV goes only to the folder the user picks. */
export async function exportCompareCsv(s: MainServices, req: { projectId: string; id: string }): Promise<{ path: string | null }> {
  const t = (await getCompare(s, req)).table;
  const dest = await s.pickFolder('export-destination');
  if (!dest) return { path: null };
  const name = t.title.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'table';
  const file = path.join(dest, `${name}.csv`);
  await atomicWriteFile(file, tableCsv(t));
  return { path: file };
}

import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { aiVisible, approxTokens, folderOf } from '@rl/ai';
import { cleanGroups, GROUPS_TOKENS, GROUPS_VERSION, groupsAnswerSchema, groupsPrompt, groupsSystem } from '@rl/ai/analysis';
import { AppError, documentIdSchema, GROUPS_LIMITS, groupsOverviewSchema, type DocumentId, type DocumentRecord, type GroupsOverview } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import { callStructured } from '../../analysis/call.js';
import { availability, loadCtx, monthUsage, type AiCtx } from '../../ai/service.js';
import { createToolsHost } from '../../ai/tools-host.js';
import { aiSends, isToolPurpose, monthOf } from '../../ai/usage.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { costDecision } from '../ai/batch.js';
import { cheapModel } from './compare.js';

/**
 * The research-group overview on request (feature 12, §17.4.19, D-393): a Markdown note in `notes/groups/<id>.md` with the authors,
 * the recurring co-authors, the tags and the main works with links, from the library data on this machine, and the themes written
 * by Claude (✦, one small request: metadata of papers of enabled folders only). Without Claude the data is saved all the same
 * ("sintesi non scritta"). Institutions are not in the library data: the overview does not state any. Loaded on demand.
 */
const running = new Map<string, AbortController>();

export const groupId = (docIds: readonly string[]): string => createHash('sha256').update([...new Set(docIds)].sort().join(',')).digest('hex').slice(0, 16);
const fileOf = (dataDir: string, id: string) => path.join(dataDir, 'notes', 'groups', `${id}.md`);
const esc = (s: string) => s.replace(/[[\]\n\r]+/g, ' ').trim();

const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

async function recordsOf(ctx: AiCtx, docIds: readonly string[]): Promise<DocumentRecord[]> {
  const out: DocumentRecord[] = [];
  for (const id of [...new Set(docIds)].slice(0, GROUPS_LIMITS.docs)) {
    const rec = await ctx.rt.store.documents.get(documentIdSchema.parse(id) as DocumentId);
    if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
    out.push(rec);
  }
  return out;
}

const norm = (a: string) => a.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** A name that is a single word or ends in a bare initial cannot be told from another author: its data is incomplete. */
const ambiguous = (a: string) => norm(a).split(' ').length < 2 || /\b[a-z]$/.test(norm(a));

export interface GroupData {
  authors: Array<{ name: string; docs: number }>;
  pairs: Array<{ a: string; b: string; docs: number }>;
  tags: Array<{ label: string; docs: number }>;
  incomplete: string[];
}

export function groupData(docs: readonly DocumentRecord[], tagLabel: (id: string) => string): GroupData {
  const count = new Map<string, { name: string; docs: number }>();
  const pairs = new Map<string, { a: string; b: string; docs: number }>();
  const tags = new Map<string, number>();
  for (const d of docs) {
    const names = [...new Map(d.authors.map((a) => [norm(a), a])).entries()].filter(([k]) => k !== '');
    for (const [k, a] of names) count.set(k, { name: count.get(k)?.name ?? a, docs: (count.get(k)?.docs ?? 0) + 1 });
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const [x, y] = ([names[i]!, names[j]!].sort((p, q) => (p[0] < q[0] ? -1 : 1)) as [[string, string], [string, string]]);
        const key = `${x[0]}|${y[0]}`;
        pairs.set(key, { a: x[1], b: y[1], docs: (pairs.get(key)?.docs ?? 0) + 1 });
      }
    for (const t of new Set(d.tags)) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const authors = [...count.values()].sort((a, b) => b.docs - a.docs || a.name.localeCompare(b.name));
  return {
    authors,
    pairs: [...pairs.values()].filter((p) => p.docs >= 2).sort((a, b) => b.docs - a.docs).slice(0, 15),
    tags: [...tags].map(([id, docs]) => ({ label: tagLabel(id), docs })).sort((a, b) => b.docs - a.docs || a.label.localeCompare(b.label)).slice(0, 12),
    incomplete: authors.filter((a) => ambiguous(a.name)).map((a) => a.name).slice(0, 200),
  };
}

export function overviewMarkdown(p: { docs: readonly DocumentRecord[]; data: GroupData; written: { overview: string; themes: Array<{ name: string; summary: string; keys: string[] }> } | null; keyDoc: ReadonlyMap<string, DocumentRecord>; at: string; lang: 'it' | 'en' }): string {
  const it = p.lang === 'it';
  const L = it
    ? { title: 'Panoramica dei gruppi di ricerca', themes: 'Temi', authors: 'Autori', co: 'Coautori ricorrenti', tags: 'Argomenti (tag)', works: 'Lavori principali', none: 'Sintesi non scritta: Claude non è stato usato o non è disponibile.', inc: 'Dati incompleti (solo il nome nella libreria)', papers: 'lavori', updated: 'Aggiornata il' }
    : { title: 'Research group overview', themes: 'Themes', authors: 'Authors', co: 'Recurring co-authors', tags: 'Topics (tags)', works: 'Main works', none: 'Synthesis not written: Claude was not used or is not available.', inc: 'Incomplete data (only the name in the library)', papers: 'papers', updated: 'Updated' };
  const link = (d: DocumentRecord) => `[${esc(d.title ?? d.path.split('/').pop() ?? d.id)}](lab://doc/${d.id})${d.year ? ` (${d.year})` : ''}`;
  const out: string[] = [`# ${L.title}`, `${L.updated} ${p.at.slice(0, 10)} · ${p.docs.length} ${L.papers}`, ''];
  out.push(`## ${L.themes}${p.written ? ' ✦' : ''}`);
  if (p.written) {
    if (p.written.overview) out.push(p.written.overview, '');
    for (const t of p.written.themes) out.push(`- **${esc(t.name)}**: ${esc(t.summary)} ${t.keys.map((k) => p.keyDoc.get(k)).filter((d): d is DocumentRecord => !!d).map(link).join('; ')}`);
  } else out.push(L.none);
  out.push('', `## ${L.authors}`, ...p.data.authors.slice(0, 40).map((a) => `- ${esc(a.name)} (${a.docs})`));
  if (p.data.pairs.length) out.push('', `## ${L.co}`, ...p.data.pairs.map((x) => `- ${esc(x.a)} + ${esc(x.b)} (${x.docs})`));
  if (p.data.tags.length) out.push('', `## ${L.tags}`, ...p.data.tags.map((x) => `- ${esc(x.label)} (${x.docs})`));
  out.push('', `## ${L.works}`, ...[...p.docs].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 30).map((d) => `- ${link(d)}${d.authors.length ? ` — ${esc(d.authors.slice(0, 3).join(', '))}${d.authors.length > 3 ? ' et al.' : ''}` : ''}`));
  if (p.data.incomplete.length) out.push('', `## ${L.inc}`, p.data.incomplete.map(esc).join('; '));
  return `${out.join('\n')}\n`;
}

function parseOverview(id: string, raw: string): GroupsOverview | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const head = new Map<string, string>();
  for (const l of (m?.[1] ?? '').split(/\r?\n/)) {
    const i = l.indexOf(':');
    if (i > 0) head.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  const r = groupsOverviewSchema.safeParse({
    id,
    markdown: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim(),
    updatedAt: head.get('updatedAt'),
    synthesis: head.get('synthesis'),
    incomplete: (head.get('incomplete') ?? '').split(';').map((x) => x.trim()).filter(Boolean),
    docs: Number(head.get('docs') ?? 0),
  });
  return r.success ? r.data : null;
}

export async function getGroups(s: MainServices, req: { docIds: string[] }): Promise<{ overview: GroupsOverview | null }> {
  const rt = await s.runtime.require();
  const id = groupId(req.docIds);
  const raw = await readFile(fileOf(rt.store.dataDir, id), 'utf8').catch(() => null);
  return { overview: raw === null ? null : parseOverview(id, raw) };
}

interface Plan {
  docs: DocumentRecord[];
  enabled: DocumentRecord[];
  system: string;
  prompt: string;
  keyDoc: Map<string, DocumentRecord>;
  tagLabel: (id: string) => string;
}

async function plan(s: MainServices, ctx: AiCtx, docIds: string[], model: string): Promise<Plan> {
  const docs = await recordsOf(ctx, docIds);
  const enabled = docs.filter((d) => aiVisible(d.path, ctx.cfg) && !d.missing);
  const host = createToolsHost({ s, rt: ctx.rt, provider: ctx.cfg.ai.provider, model, confirmed: false });
  const labels = await host.tagLabels!([...new Set(enabled.flatMap((d) => d.tags))]);
  const keyDoc = new Map(enabled.map((d, i) => [`p${i + 1}`, d]));
  const prompt = groupsPrompt([...keyDoc].map(([key, d]) => ({ key, title: d.title ?? d.path.split('/').pop() ?? '', authors: d.authors, year: d.year, tags: d.tags.map((t) => labels[t] ?? t), description: d.userDescription ?? d.ai.description?.value ?? '' })));
  return { docs, enabled, system: groupsSystem(ctx.cfg.language), prompt, keyDoc, tagLabel: (id) => labels[id] ?? id };
}

export async function estimateGroups(s: MainServices, req: { docIds: string[]; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const model = cheapModel(cfg.ai.models, cfg.ai.defaultModel, req.model);
  const p = await plan(s, ctx, req.docIds, model);
  const send = p.enabled.length > 0;
  const approx = send ? approxTokens(p.system.length + p.prompt.length) + GROUPS_TOKENS.perRequest : 0;
  const sends = aiSends(await rt.store.readLog({ type: 'ai-send' })).filter((e) => !isToolPurpose(e.purpose));
  const since = startOfLocalDay();
  const todayTokens = sends.filter((e) => e.at >= since).reduce((n, e) => n + e.approxInputTokens + (e.approxOutputTokens ?? 0), 0);
  const firstFolderSend = send && p.enabled.some((d) => !sends.some((e) => e.folders.includes(folderOf(d.path))));
  const d = costDecision({ approxTokens: approx, cached: !send, firstFolderSend, thresholdTokens: cfg.ai.costThresholdTokens, todayTokens, dailyCap: cfg.ai.dailyTokenCap, outTokens: GROUPS_TOKENS.out });
  const est = ctx.provider?.estimateCost({ model, promptChars: approx * 4, expectedOutputTokens: GROUPS_TOKENS.out });
  return { model, approxTokens: approx, estimatedUsd: est?.usd ?? null, cached: !send, folderEnabled: send, firstFolderSend, thresholdTokens: cfg.ai.costThresholdTokens, needsDialog: d.needsDialog, todayTokens, dailyCap: cfg.ai.dailyTokenCap, overDailyCap: d.overDailyCap, todayPct: d.todayPct, docs: p.docs.length, notEnabled: p.docs.length - p.enabled.length };
}

export async function runGroups(s: MainServices, req: { token: string; docIds: string[]; model?: string | undefined; withClaude: boolean; confirmed: boolean }): Promise<{ overview: GroupsOverview }> {
  const est = await estimateGroups(s, req);
  const ctx = await loadCtx(s);
  const { rt, cfg } = ctx;
  const p = await plan(s, ctx, req.docIds, est.model);
  let written: ReturnType<typeof cleanGroups> | null = null;
  if (req.withClaude && p.enabled.length > 0) {
    if (est.needsDialog && !req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
    if (est.overDailyCap) throw new AppError('AI_BUDGET_EXCEEDED', 'The daily token cap is reached', { reason: 'daily-cap', todayTokens: est.todayTokens, dailyCap: est.dailyCap });
    const cap = cfg.ai.usageCap.monthlyUsd;
    if (cap !== null && (await monthUsage(rt, monthOf(new Date()))).usd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached');
    const av = await availability(s, ctx.provider);
    // Claude not reachable: the data is saved all the same, without the themes.
    if (av.available && ctx.provider) {
      const ctl = new AbortController();
      running.set(req.token, ctl);
      try {
        const deviceId = (await s.settings.get()).deviceId;
        const { value } = await callStructured(
          { s, ctx, provider: ctx.provider, signal: ctl.signal, confirmed: true, deviceId, addUsd: () => {} },
          { purpose: 'groups', model: est.model, reasoning: cfg.ai.defaultReasoning, system: p.system, prompt: p.prompt, schema: groupsAnswerSchema, docIds: p.enabled.map((d) => d.id), folders: [...new Set(p.enabled.map((d) => folderOf(d.path)))] },
        );
        written = cleanGroups(value, new Set(p.keyDoc.keys()));
      } finally {
        if (running.get(req.token) === ctl) running.delete(req.token);
      }
    }
  }
  const at = new Date().toISOString();
  const data = groupData(p.docs, p.tagLabel);
  const synthesis = written && (written.overview !== '' || written.themes.length > 0) ? 'written' : 'not-written';
  const body = overviewMarkdown({ docs: p.docs, data, written: synthesis === 'written' ? written : null, keyDoc: p.keyDoc, at, lang: cfg.language });
  const id = groupId(req.docIds);
  const file = fileOf(rt.store.dataDir, id);
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `---\nid: ${id}\nupdatedAt: ${at}\nsynthesis: ${synthesis}\ndocs: ${p.docs.length}\nincomplete: ${data.incomplete.join('; ').replace(/[\r\n]+/g, ' ')}\nversion: ${GROUPS_VERSION}\n---\n${body}`);
  return { overview: { id, markdown: body.trim(), updatedAt: at, synthesis, incomplete: data.incomplete, docs: p.docs.length } };
}

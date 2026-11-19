import { aiVisible } from '@rl/ai';
import { structuredSystem, type Lang } from '@rl/ai/analysis';
import { AppError, contentHashOf, MANUSCRIPT_LIMITS, type DocumentId, type Manuscript } from '@rl/core';
import { readCachedText } from '@rl/data';
import { z } from 'zod';
import { loadCtx, type AiCtx } from '../../ai/service.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { ctxOf } from '../project/index.js';
import { clip, costs, modelOf, oneLine, send } from '../project/ai.js';
import { readManuscript } from './store.js';

/**
 * "✦ Propose the assignments" (§18.1, Z1c, D-416): Claude sorts the papers of the project into the sections of the manuscript.
 * Only the section titles and the title and abstract of papers in enabled folders leave (never the manuscript text, never a
 * document outside the folders); the exact text is shown first and nothing is written: each proposal is accepted by the user.
 */
export const ASSIGN_VERSION = 'manuscript-assign-v1';
export const ASSIGN_OUT_TOKENS = 700;
export const MAX_PROMPT_SECTIONS = 120;
export const MAX_PROMPT_PAPERS = 60;
const PER_SECTION = 3;

export const assignSchema = z.object({ proposals: z.array(z.object({ section: z.string(), papers: z.array(z.string()) })) });

export function assignSystem(language: Lang): string {
  return structuredSystem({
    version: ASSIGN_VERSION,
    role: 'You help a researcher decide which papers of their library to cite in which section of their manuscript, from the section titles and the title and abstract of each paper.',
    output: `JSON {"proposals": [{"section": "<section id, like S1>", "papers": ["<paper id, like P1>"]}]}. At most ${PER_SECTION} papers per section, best first; leave out sections with no clear match.`,
    rules: ['Use only the ids given; judge only from the titles and abstracts shown, never from what you remember of the papers.', 'Do not propose a paper when the match is vague.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');
export interface PromptSection {
  id: string;
  title: string;
  level: number;
}
export interface PromptPaper {
  id: string;
  meta: string;
}
export const assignPrompt = (sections: readonly PromptSection[], papers: readonly PromptPaper[]): string =>
  `<<<DATA sections\n${sections.map((x) => `${x.id} ${'#'.repeat(x.level)} ${strip(oneLine(x.title))}`).join('\n')}\nDATA>>>\n${papers.map((p) => `<<<DATA paper ${p.id}\n${strip(p.meta)}\nDATA>>>`).join('\n')}\nPropose the papers for the sections.`;

/** Turns the answer into (section, paper) pairs: unknown ids, repeats, what is already assigned and more than three per section are dropped. */
export function parseProposals(raw: z.infer<typeof assignSchema>, sections: ReadonlyArray<{ id: string; key: string }>, papers: ReadonlyArray<{ id: string; docId: string }>, assigned: ReadonlySet<string>): Array<{ sectionId: string; docId: string }> {
  const sec = new Map(sections.map((x) => [x.key, x.id]));
  const doc = new Map(papers.map((p) => [p.id, p.docId]));
  const seen = new Set<string>();
  const out: Array<{ sectionId: string; docId: string }> = [];
  for (const pr of raw.proposals) {
    const sectionId = sec.get(pr.section);
    if (!sectionId) continue;
    let n = 0;
    for (const pid of pr.papers) {
      const docId = doc.get(pid);
      const k = `${sectionId}|${docId}`;
      if (!docId || seen.has(k) || assigned.has(k) || n >= PER_SECTION) continue;
      seen.add(k);
      n++;
      out.push({ sectionId, docId });
    }
  }
  return out;
}

async function gather(s: MainServices, ctx: AiCtx, projectId: string) {
  const { project, dataDir } = await ctxOf(s, projectId);
  const m: Manuscript | null = await readManuscript(dataDir, projectId);
  if (!m) throw new AppError('NOT_FOUND', 'No manuscript in this project');
  const live = m.sections.filter((x) => !x.gone).sort((a, b) => a.order - b.order).slice(0, MAX_PROMPT_SECTIONS);
  const sections = live.map((x, i) => ({ id: x.id, key: `S${i + 1}`, title: x.title, level: x.level }));
  const papers: Array<PromptPaper & { docId: string }> = [];
  for (const mem of project.members) {
    if (papers.length >= MAX_PROMPT_PAPERS) break;
    const rec = await ctx.rt.store.documents.get(mem.docId as DocumentId);
    if (!rec || rec.missing || !aiVisible(rec.path, ctx.cfg)) continue;
    const cached = await readCachedText(ctx.rt.textCacheDir, contentHashOf(rec), 1).catch(() => undefined);
    const abstract = (rec.ai.summary && rec.ai.summary.review.status !== 'rejected' ? String(rec.ai.summary.value) : '') || cached?.meta.abstract || '';
    papers.push({ id: `P${papers.length + 1}`, docId: rec.id, meta: `title: ${oneLine(rec.title ?? 'untitled')}${abstract ? `\nabstract: ${clip(oneLine(abstract), 500)}` : ''}` });
  }
  const assigned = new Set(m.assignments.filter((a) => a.ref.kind === 'doc').map((a) => `${a.sectionId}|${(a.ref as { docId: string }).docId}`));
  return { sections, papers, assigned };
}

export async function previewAssignSuggest(s: MainServices, req: { projectId: string; model?: string | undefined }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  const g = await gather(s, ctx, req.projectId);
  const ready = g.sections.length > 0 && g.papers.length > 0;
  const text = ready ? assignPrompt(g.sections, g.papers) : '';
  const k = await costs(ctx, model, text.length + assignSystem(ctx.cfg.language).length, ASSIGN_OUT_TOKENS);
  return { text, candidates: ready ? g.papers.length : 0, ...k };
}

/** Never writes: the dialog assigns what the user accepts (`project:assign`, origin `ai`). */
export async function assignSuggest(s: MainServices, req: { projectId: string; model?: string | undefined; confirmed: boolean }) {
  const ctx = await loadCtx(s);
  const model = modelOf(ctx, req.model);
  if (!req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  const g = await gather(s, ctx, req.projectId);
  if (g.sections.length === 0 || g.papers.length === 0) return { items: [] };
  const system = assignSystem(ctx.cfg.language);
  const prompt = assignPrompt(g.sections, g.papers);
  const k = await costs(ctx, model, system.length + prompt.length, ASSIGN_OUT_TOKENS);
  const raw = await send(s, ctx, { purpose: 'manuscript-assign', model, system, prompt, schema: assignSchema, docIds: g.papers.map((p) => p.docId) }, k, req.confirmed);
  return { items: parseProposals(raw, g.sections, g.papers, g.assigned).slice(0, MANUSCRIPT_LIMITS.sections * PER_SECTION) };
}

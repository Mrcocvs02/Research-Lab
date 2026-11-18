import type { DocumentRecord, AiMeta, AiTagScore, ReasoningLevel } from '@rl/core';
import { AppError } from '@rl/core';
import { folderOf, type SuggestField } from '@rl/ai';
import {
  NOTE_LIMITS,
  PROMPT_VERSIONS,
  analysisPrompt,
  analysisSchema,
  analysisSystem,
  candidateBlock,
  chapterPrompt,
  chapterSchema,
  chapterSystem,
  chaptersToNoteBody,
  cleanAnalysis,
  completeNote,
  contentSections,
  docMeta,
  finalSection,
  fitSections,
  litNotePrompt,
  litNoteSystem,
  noteSchema,
  planNote,
  retrieveCandidates,
  splitSections,
  type AnalysisClean,
  type AnalysisRaw,
  type CandidateNode,
  type Lang,
} from '@rl/ai/analysis';
import { callStructured, strongModel, type Runner } from './call.js';
import { readNote, writeNote } from './note-store.js';

/** Pages read from a document for the note (a thesis can run to several hundred). */
export const ANALYSIS_MAX_PAGES = 600;

export interface AnalyseArgs {
  r: Runner;
  rec: DocumentRecord;
  /** Fields to propose (tags, description, summary, keywords, synonyms). */
  fields: SuggestField[];
  model: string;
  reasoning: ReasoningLevel;
  regenerate: boolean;
  pageTexts(rec: DocumentRecord, pages: number[]): Promise<Array<{ page: number; text: string }>>;
  /** Writes the cleaned fields as PROPOSED (never over a reviewed value) with the tag scores riding along. */
  write(clean: AnalysisClean & { scores?: AiTagScore[] }, meta: AiMeta): Promise<void>;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** Generates the literature note v0.2 (stronger model, no section lost, always the final chapter) and stores it. */
export async function generateNote(a: AnalyseArgs): Promise<string> {
  const { r, rec } = a;
  const { rt, cfg } = r.ctx;
  const lang: Lang = cfg.language;
  const pages = await a.pageTexts(rec, range(ANALYSIS_MAX_PAGES));
  const sections = splitSections(pages);
  if (contentSections(sections).length === 0) throw new AppError('INVALID_REQUEST', 'This document has no text to summarise');
  const model = strongModel(cfg.ai.models, a.model);
  const base = { model, docIds: [rec.id], folders: [folderOf(rec.path)] };
  const meta = docMeta(rec);
  const plan = planNote(sections);
  let body: string;
  if (plan.mode === 'single') body = fitSections(plan.groups[0] ?? [], NOTE_LIMITS.singleCallChars);
  else {
    const groups: Array<{ titles: string[]; summary: string; keyPoints: string[]; concepts: string[] }> = [];
    for (const g of plan.groups) {
      const titles = g.map((x) => x.title);
      const { value } = await callStructured(r, {
        ...base,
        purpose: 'job:note-chapter',
        reasoning: 'low',
        system: chapterSystem(lang),
        prompt: chapterPrompt(meta, titles, fitSections(g, NOTE_LIMITS.chapterChars)),
        schema: chapterSchema,
      });
      groups.push({ titles, summary: value.summary, keyPoints: value.keyPoints.slice(0, 8), concepts: value.concepts.slice(0, 10) });
    }
    body = chaptersToNoteBody(undefined, groups, finalSection(sections)?.text ?? '');
  }
  const { value } = await callStructured(r, { ...base, purpose: 'job:note', reasoning: 'medium', system: litNoteSystem(lang, plan.mode), prompt: litNotePrompt(meta, body), schema: noteSchema });
  const { note } = completeNote(value.note, sections);
  await writeNote(rt.store.dataDir, rec.id, note, { version: PROMPT_VERSIONS.litNote, model, generatedAt: new Date().toISOString(), mode: plan.mode });
  return note;
}

/**
 * The analysis pipeline of one document (D-446): the literature note (read when there is one and no regeneration is asked, else
 * written from the extracted text), then tags (with candidates, closure and weights), description, summary and keywords derived FROM
 * the note in one call. Everything is written as a proposal.
 */
export async function analyseOne(a: AnalyseArgs): Promise<void> {
  const { r, rec } = a;
  const { rt, cfg } = r.ctx;
  let note = a.regenerate ? null : await readNote(rt.store.dataDir, rec.id);
  note ??= await generateNote(a);
  const tax = a.fields.includes('tags') ? await rt.store.readTaxonomy().catch(() => null) : null;
  const nodes: CandidateNode[] = (tax?.nodes ?? []).filter((n) => n.status === 'active').map((n) => ({ id: n.id, label: n.label, aliases: n.aliases, definition: n.definition, parents: n.parents, implies: n.implies }));
  // Tags need a taxonomy to choose from (D-446: taxonomy first); without one the other fields are still derived.
  const fields = a.fields.filter((f) => f !== 'tags' || nodes.length > 0);
  if (fields.length === 0) return;
  const cands = fields.includes('tags') ? retrieveCandidates(note, nodes) : [];
  const lang: Lang = cfg.language;
  const { value, meta } = await callStructured(r, {
    purpose: 'job:analysis',
    model: a.model,
    reasoning: a.reasoning,
    docIds: [rec.id],
    folders: [folderOf(rec.path)],
    system: analysisSystem(fields, lang),
    prompt: analysisPrompt(fields, docMeta(rec), note, fields.includes('tags') ? candidateBlock(cands, nodes) : null),
    schema: analysisSchema(fields),
  });
  const clean = cleanAnalysis(value as AnalysisRaw, fields, tax);
  await a.write({ ...clean, ...(clean.scores ? { scores: clean.scores } : {}) }, meta);
  // Local, no model: the references of the work in order of relevance, now that its note exists.
  await import('./cite-rank.js').then((m) => m.rankCitationsFor(r.s, rt, rec.id)).catch((e: unknown) => r.s.log.warn('citation ranking failed', { error: e }));
}

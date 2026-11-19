import { z } from 'zod';
import { structuredSystem, type Lang } from './prompts.js';

/**
 * The pre-structured, versioned prompts of the synthesis functions (D-440): the cells of the comparison table (16) and the themes
 * of the research-group overview (12). Each gets only the context it needs: a column asks for ONE value per paper from the text
 * of those papers; the themes are written from the metadata of the papers. The model never writes a link or an identifier: it
 * answers with the short keys it was given and with page numbers, and main builds the links.
 */
export const COMPARE_VERSION = 'compare-cell-v1';
export const GROUPS_VERSION = 'groups-themes-v1';

/** Papers of one request (D-404) and characters of the text of one paper that go to the model. */
export const COMPARE_BLOCK = 10;
export const COMPARE_PAPER_CHARS = 4000;
/** Output tokens assumed per cell and per request, and the instructions of a request, for the estimate. */
export const COMPARE_TOKENS = { perRequest: 450, outPerCell: 90 } as const;
/** About 3 000 tokens in all for the themes of a group (D-440, §17.4.19). */
export const GROUPS_TOKENS = { perPaper: 90, perRequest: 500, out: 700 } as const;

export const compareAnswerSchema = z.object({ cells: z.array(z.object({ key: z.string(), text: z.string(), pages: z.array(z.number().int().positive()) })) });
export type CompareAnswer = z.infer<typeof compareAnswerSchema>;

/** What each default column means, in the words the model is given (the key is the literature-note section). */
const MEANING: Record<string, string> = {
  problem: 'the problem or question the paper takes on',
  contribution: 'what the paper contributes',
  method: 'the method or approach the paper uses',
  results: 'the main results, with the numbers the paper gives',
  data: 'the datasets, benchmarks, code or tools the paper uses, named as in the text',
  limits: 'the limits the authors admit and the open problems',
};

export function compareSystem(language: Lang, column: { name: string; key: string | null }): string {
  const meaning = (column.key && MEANING[column.key]) || `the value of "${column.name.replace(/["\n]/g, ' ').slice(0, 60)}" for the paper, as the paper states it`;
  return structuredSystem({
    version: COMPARE_VERSION,
    role: `You fill one column of a comparison table of research papers for a researcher. The column is: ${meaning}.`,
    output: '{"cells": [{"key": "<the key given>", "text": "<one short sentence, at most 25 words>", "pages": [<page numbers of the paper the text comes from>]}]}. One entry per paper. Use an empty "text" and no pages when the paper does not state it: never guess.',
    rules: ['Use only the TEXT of each paper; give the pages it comes from (the text marks each page). Never invent a page.', 'Copy the key exactly; do not add papers. Write in your own words; do not copy long passages; no links.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');

/** The prompt of one request: each paper with its short key and its text (pages marked), as delimited data. */
export const comparePrompt = (column: string, papers: ReadonlyArray<{ key: string; title: string; text: string }>): string =>
  `<<<DATA\n${papers.map((p) => `key: ${p.key}\ntitle: ${strip(p.title)}\nTEXT:\n${strip(p.text)}`).join('\n---\n')}\nDATA>>>\nFill the column "${strip(column).slice(0, 60)}" for each paper.`;

const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** Only the keys asked for, one entry each, one-line texts, pages positive, unique, sorted and inside the paper (`maxPage` per key). */
export function cleanCompare(raw: CompareAnswer, asked: ReadonlyMap<string, number>): Map<string, { text: string; pages: number[] }> {
  const out = new Map<string, { text: string; pages: number[] }>();
  for (const c of raw.cells) {
    const max = asked.get(c.key);
    if (max === undefined || out.has(c.key)) continue;
    const text = oneLine(c.text, 600);
    out.set(c.key, { text, pages: text === '' ? [] : [...new Set(c.pages.filter((p) => p >= 1 && p <= max))].sort((a, b) => a - b).slice(0, 8) });
  }
  return out;
}

export const groupsAnswerSchema = z.object({ overview: z.string(), themes: z.array(z.object({ name: z.string(), summary: z.string(), keys: z.array(z.string()) })) });
export type GroupsAnswer = z.infer<typeof groupsAnswerSchema>;

export function groupsSystem(language: Lang): string {
  return structuredSystem({
    version: GROUPS_VERSION,
    role: 'You describe, for a researcher, the research themes that a set of papers and their authors work on, so that the groups behind them can be told apart.',
    output: '{"overview": "<2-4 sentences on what the set of papers is about and how the authors relate>", "themes": [{"name": "<3-6 words>", "summary": "<1-2 sentences>", "keys": ["<keys of the papers of the theme>"]}]}. At most 6 themes; a paper may be in several.',
    rules: ['Use only the metadata given (title, authors, year, tags, description). Copy the keys exactly; do not add papers or authors.', 'Do not state institutions, affiliations or facts about the authors that the data does not give. No links.'],
    language,
  });
}

/** The prompt: one block per paper (key, title, authors, year, tags, description), as delimited data. */
export const groupsPrompt = (papers: ReadonlyArray<{ key: string; title: string; authors: readonly string[]; year: number | null; tags: readonly string[]; description: string }>): string =>
  `<<<DATA\n${papers
    .map((p) => [`key: ${p.key}`, `title: ${strip(p.title)}`, p.authors.length ? `authors: ${strip(p.authors.slice(0, 6).join('; '))}` : '', p.year ? `year: ${p.year}` : '', p.tags.length ? `tags: ${strip(p.tags.slice(0, 8).join(', '))}` : '', p.description ? `description: ${strip(oneLine(p.description, 300))}` : ''].filter(Boolean).join('\n'))
    .join('\n---\n')}\nDATA>>>\nDescribe the themes of this set of papers.`;

/** The overview and the themes, with only the keys that were asked for (a theme without a valid key is dropped), capped. */
export function cleanGroups(raw: GroupsAnswer, asked: ReadonlySet<string>): { overview: string; themes: Array<{ name: string; summary: string; keys: string[] }> } {
  const themes = raw.themes
    .map((t) => ({ name: oneLine(t.name, 80), summary: oneLine(t.summary, 300), keys: [...new Set(t.keys.filter((k) => asked.has(k)))] }))
    .filter((t) => t.name !== '' && t.keys.length > 0)
    .slice(0, 6);
  return { overview: oneLine(raw.overview, 800), themes };
}

import { z } from 'zod';
import { structuredSystem, type Lang } from '@rl/ai/analysis';
import { LITERATURE_KEYS, type LiteratureKey } from '@rl/core';

/**
 * The versioned prompt of the literature note in seven sections (feature 2, D-390, D-440): the model answers one entry per
 * section with the pages the claims come from; main turns the pages into `lab://doc/<id>?page=N` links, so the model never
 * writes a link or an identifier. The text of the paper sits between DATA markers and is never instructions.
 */
export const LITERATURE_VERSION = 'literature-v1';

export const literatureSchema = z.object({ sections: z.array(z.object({ key: z.enum(LITERATURE_KEYS), text: z.string(), pages: z.array(z.number().int().positive()) })) });
export type LiteratureRaw = z.infer<typeof literatureSchema>;

/** Characters of the paper that go to the model (about 12 000 tokens). */
export const LITERATURE_TEXT_CHARS = 48_000;
/** Pages read from the file. */
export const LITERATURE_PAGES = 80;
/** Output tokens assumed for the estimate. */
export const LITERATURE_OUT_TOKENS = 1800;

export function literatureSystem(language: Lang): string {
  return structuredSystem({
    version: LITERATURE_VERSION,
    role: 'You write the literature note of one research paper for the researcher who owns it: what problem it takes on, what it contributes, how, with what result, on which data, and where it stops.',
    output: `JSON {"sections": [{"key": "<${LITERATURE_KEYS.join('|')}>", "text": "<2-5 sentences>", "pages": [<page numbers of the paper the claims come from>]}]}. One entry per key, in that order. "data": the datasets, benchmarks, code or tools the paper uses, named as in the text; say that the paper does not state them when it does not. "limits": the limits the authors admit and the open problems.`,
    rules: ['Every claim must be supported by the TEXT of the data; give the pages it comes from in "pages" (the data marks each page). Never invent a page.', 'Write the claims in your own words; do not copy long passages. Do not give links or identifiers.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');

/** The prompt: the metadata and the text of the paper (pages marked), as delimited data. */
export const literaturePrompt = (meta: string, text: string): string => `<<<DATA\n${strip(meta)}\nTEXT:\n${strip(text)}\nDATA>>>\nWrite the literature note of this paper.`;

export interface CleanSection {
  key: LiteratureKey;
  text: string;
  pages: number[];
}

/** One entry per key at most (the first), one-line-ish texts capped, pages positive, sorted, unique and no more than `maxPage`. */
export function cleanLiterature(raw: LiteratureRaw, maxPage: number): CleanSection[] {
  const out = new Map<LiteratureKey, CleanSection>();
  for (const s of raw.sections) {
    if (out.has(s.key)) continue;
    const text = s.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
    if (text === '') continue;
    out.set(s.key, { key: s.key, text, pages: [...new Set(s.pages.filter((p) => p >= 1 && p <= maxPage))].sort((a, b) => a - b).slice(0, 8) });
  }
  return LITERATURE_KEYS.flatMap((k) => out.get(k) ?? []);
}

/** `text (p. 2, p. 4)` with each page a link to the reader at that page. */
export function sectionMarkdown(s: CleanSection, docId: string): string {
  const pages = s.pages.map((p) => `[p. ${p}](lab://doc/${docId}?page=${p})`).join(', ');
  return pages === '' ? s.text : `${s.text} (${pages})`;
}

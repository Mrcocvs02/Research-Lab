import { z } from 'zod';
import { discoverSummarySchema, type DiscoverSummary } from '@rl/core';
import { structuredSystem, type Lang } from './prompts.js';

/**
 * The pre-structured, versioned prompt of "✦ Sintesi" in Discover (feature 41, D-397, D-419, D-440): five short lines per work
 * (problem, method, results, data, limits) written from the PUBLIC abstract alone, in blocks of ten abstracts. An empty line
 * means "not stated in the abstract": the model never fills the gap.
 */
export const DISCOVER_SUMMARY_VERSION = 'discover-summary-v1';
export const DISCOVER_SUMMARY_BLOCK = 10;

export const discoverSummaryAnswerSchema = z.object({ items: z.array(discoverSummarySchema.extend({ key: z.string() })) });

export function discoverSummarySystem(language: Lang): string {
  return structuredSystem({
    version: DISCOVER_SUMMARY_VERSION,
    role: 'You summarise research papers for a researcher who is deciding what to read, from the public abstract of each one.',
    output: '{"items": [{"key": "<the key given>", "problem": "...", "method": "...", "results": "...", "data": "...", "limits": "..."}]}. One entry per work, each field one short sentence. Leave a field as an empty string when the abstract does not say it ("limits" most often); never guess.',
    rules: ['Use only the ABSTRACT of each work. Copy the key exactly; do not add works.', 'Write the sentences in your own words; do not give links or identifiers.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');
export const discoverSummaryPrompt = (items: ReadonlyArray<{ key: string; title: string; abstract: string }>): string =>
  `<<<DATA\n${items.map((i) => `key: ${i.key}\ntitle: ${strip(i.title)}\nABSTRACT: ${strip(i.abstract)}`).join('\n---\n')}\nDATA>>>\nSummarise each work.`;

const line = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

/** Only the keys that were asked for, one entry each, one-line fields. */
export function cleanDiscoverSummaries(raw: z.infer<typeof discoverSummaryAnswerSchema>, asked: ReadonlySet<string>): Map<string, DiscoverSummary> {
  const out = new Map<string, DiscoverSummary>();
  for (const i of raw.items) if (asked.has(i.key) && !out.has(i.key)) out.set(i.key, { problem: line(i.problem), method: line(i.method), results: line(i.results), data: line(i.data), limits: line(i.limits) });
  return out;
}

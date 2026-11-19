import { readFile } from 'node:fs/promises';
import { cleanDiscoverSummaries, DISCOVER_SUMMARY_BLOCK, DISCOVER_SUMMARY_VERSION, discoverSummaryAnswerSchema, discoverSummaryPrompt, discoverSummarySystem } from '@rl/ai/analysis';
import { discoverSummarySchema, type DiscoverSummary } from '@rl/core';

/**
 * "✦ Sintesi" of the best candidates (feature 41, D-397, D-419): the prompt itself is versioned in `packages/ai` (D-440);
 * here only the cache by abstract (the same work in another search costs nothing) and the estimate figures.
 */
export const SUMMARY_VERSION = DISCOVER_SUMMARY_VERSION;
export const SUMMARY_BLOCK = DISCOVER_SUMMARY_BLOCK;
/** Tokens per abstract in and out, and per request for the instructions: the estimate before the abstracts are read (about 7 000 in for 20). */
export const SUMMARY_TOKENS = { perAbstract: 300, perRequest: 450, outPerAbstract: 150 } as const;

export const summaryAnswerSchema = discoverSummaryAnswerSchema;
export const summarySystem = discoverSummarySystem;
export const summaryPrompt = discoverSummaryPrompt;
export const cleanSummaries = cleanDiscoverSummaries;

export async function readCachedSummary(file: string): Promise<DiscoverSummary | null> {
  try {
    const r = discoverSummarySchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

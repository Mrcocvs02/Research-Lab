import { z } from 'zod';
import { structuredSystem, type Lang } from './prompts.js';
import { clip, oneLine } from './text.js';

/**
 * "✦ Spiega" (feature 31, D-440): a pre-structured, versioned prompt that explains a passage, a formula, a table or a
 * figure from the text selected, its paragraph and, for a crop, its caption. Nothing else is sent (D-416: at most ~1500 tokens).
 */
export const EXPLAIN_VERSION = 'explain-v1';

/** Characters of the selection and of the paragraph around it that go to the model (about 1500 tokens in all). */
export const EXPLAIN_LIMITS = { text: 2400, around: 3600, symbols: 12 } as const;

export const explainSchema = z.object({ means: z.string(), symbols: z.array(z.object({ symbol: z.string(), meaning: z.string() })), role: z.string() });
export type ExplainRaw = z.infer<typeof explainSchema>;

export function explainSystem(language: Lang, detail: boolean): string {
  return structuredSystem({
    version: EXPLAIN_VERSION,
    role: 'You explain one passage, formula, table or figure of a research paper to the researcher who is reading it.',
    output: `JSON {"means": "<what it says>", "symbols": [{"symbol": "<symbol or term>", "meaning": "<meaning>"}], "role": "<what it is for in the paper>"}. "means": ${detail ? 'a detailed explanation, step by step, at most 1200 characters' : 'two or three sentences'}. "symbols": every symbol or technical term the passage uses and the data explains (at most ${EXPLAIN_LIMITS.symbols}); an empty list when there is none. "role": one or two sentences on why the passage is in the paper, with the page when the data gives it.`,
    rules: ['Use only the SELECTION, the CONTEXT and the CAPTION of the data. When they do not say what a symbol means, leave it out; do not guess.', 'Do not give links or identifiers.'],
    language,
  });
}

/** The prompt: the selection (or the caption of a crop) and the paragraph around it, delimited as data. */
export function explainPrompt(p: { page: number; text: string; around: string }): string {
  const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');
  const around = clip(strip(p.around).trim(), EXPLAIN_LIMITS.around);
  return `<<<DATA\npage: ${p.page}\nSELECTION:\n${clip(strip(p.text).trim(), EXPLAIN_LIMITS.text)}\n${around ? `CONTEXT:\n${around}\n` : ''}DATA>>>\nExplain the SELECTION.`;
}

/** The answer cleaned: one-line symbols, capped lists and lengths. */
export function cleanExplain(raw: ExplainRaw) {
  return {
    means: clip(raw.means.trim(), 2000),
    symbols: raw.symbols
      .map((s) => ({ symbol: clip(oneLine(s.symbol), 60), meaning: clip(oneLine(s.meaning), 300) }))
      .filter((s) => s.symbol !== '' && s.meaning !== '')
      .slice(0, EXPLAIN_LIMITS.symbols),
    role: clip(raw.role.trim(), 1000),
  };
}

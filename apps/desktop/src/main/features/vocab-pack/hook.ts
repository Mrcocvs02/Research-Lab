import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { LatentConcept, LatentLookup } from '@rl/ai';
import type { TaxonomyFile } from '@rl/core';

/**
 * The thin door of the AI code to the field vocabulary (D-519): a library without the state file costs one `stat` and loads nothing,
 * and the tagging prompt is then exactly the one it always was.
 */
/** `<dataDir>/vocab-pack.json` (kept here, not imported from `state.ts`, so that this door pulls no schema into the code the start loads). */
const STATE_FILE = 'vocab-pack.json';

export interface Latent {
  /** Concepts the prompt offers for this text (at most 15, best first). */
  offered: LatentConcept[];
  lookup: LatentLookup;
  /** Characters the latent lines add to a prompt, at most (for the cost preview). */
  estimate: number;
}

/** The latent concepts that fit `text`, or null when the library uses no pack, there is no taxonomy, or nothing fits. */
export async function latentOf(dataDir: string, tax: TaxonomyFile | null, language: 'it' | 'en', text: string | null): Promise<Latent | null> {
  if (!tax || !(await stat(path.join(dataDir, STATE_FILE)).then(() => true, () => false))) return null;
  const m = await import('./latent.js');
  const ctx = await m.latentContext(dataDir, tax, language);
  if (!ctx) return null;
  // The preview has no text yet: it counts the most a prompt can carry.
  const offered = text === null ? [] : await m.latentFor(ctx, text);
  if (text !== null && offered.length === 0) return null;
  return { offered, lookup: ctx.lookup(offered), estimate: m.LATENT_ESTIMATE_CHARS };
}

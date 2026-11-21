import type { LatentConcept, LatentLookup } from '@rl/ai';
import type { TaxonomyFile } from '@rl/core';
import { formKey } from '@rl/data/pack-match';
import { conceptLabel, linkedConcepts, nearestParent } from './materialize.js';
import { loadPack } from './packs.js';
import { readState } from './state.js';

/**
 * The field vocabulary inside the tagging prompt (D-519, section 20.1.4): names and paths of concepts, never anything else, and only for
 * the pack the library uses. Without a pack nothing here runs and the prompt is the one it always was.
 */

/** What a prompt with latent concepts adds per work, at most (`LATENT_CHARS` of `@rl/ai`: the rule and the lines that fit): the cost preview counts it. */
export const LATENT_ESTIMATE_CHARS = 1100;

export interface LatentContext {
  /** The concepts a work may be offered: those no tag stands for yet. */
  pool: LatentConcept[];
  /** The proposal "from the field" for a short id, only among the ones a prompt offered (`offered`), and for a name of any concept of the pool. */
  lookup(offered: readonly LatentConcept[]): LatentLookup;
}

/** The pool of latent concepts of the pack in use, or null (no pack, no concept left). */
export async function latentContext(dataDir: string, tax: TaxonomyFile | null, lang: 'it' | 'en'): Promise<LatentContext | null> {
  if (!tax) return null;
  const st = await readState(dataDir);
  if (st.packId === '') return null;
  const loaded = await loadPack(st.packId).catch(() => null);
  if (!loaded) return null;
  const linked = linkedConcepts(tax, st.packId);
  // What the field tells apart from a tag already in the library is not offered next to it (a concept is never a `distinctFrom` term of a present one).
  const apart = new Set<string>();
  for (const id of linked.keys()) for (const t of loaded.byId.get(id)?.distinctFrom ?? []) apart.add(formKey(t));
  const fams = new Map(loaded.families.map((f) => [f.id, f.label]));
  const pool: LatentConcept[] = [];
  const byShort = new Map<string, (typeof loaded.concepts)[number]>();
  for (const c of loaded.concepts) {
    if (linked.has(c.id) || apart.has(formKey(c.label))) continue;
    const labels: string[] = [];
    for (let p = c.parent ? loaded.byId.get(c.parent) : undefined, i = 0; p && i < 8; p = p.parent ? loaded.byId.get(p.parent) : undefined, i++) labels.unshift(conceptLabel(p, lang));
    const short = loaded.shortOf.get(c.id) as string;
    byShort.set(short, c);
    pool.push({ short, label: conceptLabel(c, lang), aliases: [...(lang === 'it' ? [c.label] : c.labelIt ? [c.labelIt] : []), ...c.aliases], path: [fams.get(c.family) ?? '', ...labels].filter(Boolean).join(' › ') });
  }
  if (pool.length === 0) return null;
  const tag = (c: (typeof loaded.concepts)[number]) => ({ label: conceptLabel(c, lang), parentId: nearestParent(tax, st, loaded, c), pack: `${st.packId}/${c.id}` });
  // A free new tag that names a concept by one of its names (the sure rules: same letters once case, accents and separators go).
  const byName = new Map<string, (typeof loaded.concepts)[number]>();
  for (const c of byShort.values()) for (const n of [c.label, ...(c.labelIt ? [c.labelIt] : []), ...c.aliases]) if (!byName.has(formKey(n))) byName.set(formKey(n), c);
  return {
    pool,
    lookup: (offered) => {
      const shown = new Set(offered.map((o) => o.short));
      return {
        byShort: (id) => {
          const c = shown.has(id) ? byShort.get(id) : undefined;
          return c ? tag(c) : null;
        },
        byLabel: (label) => {
          const c = byName.get(formKey(label));
          return c ? tag(c) : null;
        },
      };
    },
  };
}

/** The latent concepts that fit a text: at most 15, best first (tf-idf of the retrieval the analysis already uses). */
export async function latentFor(ctx: LatentContext | null, text: string): Promise<LatentConcept[]> {
  if (!ctx) return [];
  const { pickLatent } = await import('@rl/ai/analysis');
  return pickLatent(text, ctx.pool);
}

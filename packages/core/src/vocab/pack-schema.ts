import { z } from 'zod';

/** Maximum depth of a concept hierarchy (macro-area, sub-area, detail). */
export const PACK_MAX_DEPTH = 3;

export const packConceptSchema = z.object({
  /** Stable id, `<family>.<slug>`; never reused for another meaning. */
  id: z.string().regex(/^[a-zA-Z]+\.[a-z0-9]+(-[a-z0-9]+)*$/),
  /** Canonical English label. */
  label: z.string().min(1).max(120),
  labelIt: z.string().min(1).max(120).optional(),
  /** Acronyms, spelling/plural/hyphen variants and synonyms. */
  aliases: z.array(z.string().min(1).max(120)).max(40),
  parent: z.string().optional(),
  /** Free-text names of easily confused terms that must not be merged with this concept. */
  distinctFrom: z.array(z.string().min(1).max(120)).max(8).optional(),
  /** arXiv category hints, e.g. `cond-mat.str-el`. */
  arxiv: z.array(z.string().regex(/^[a-z-]+(\.[A-Za-z-]+)?$/)).max(8).optional(),
});
export type PackConcept = z.infer<typeof packConceptSchema>;

export const packFamilySchema = z.object({
  id: z.string().regex(/^[a-zA-Z]+$/),
  label: z.string().min(1).max(80),
  /** A document may carry at most one concept of a single-value family. */
  singleValue: z.boolean(),
  concepts: z.array(packConceptSchema).min(1),
});
export type PackFamily = z.infer<typeof packFamilySchema>;

export const vocabPackSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label: z.string().min(1).max(160),
  labelIt: z.string().min(1).max(160).optional(),
  language: z.string().min(2).max(8),
  families: z.array(packFamilySchema).min(1),
});
export type VocabPack = z.infer<typeof vocabPackSchema>;

/** Case, hyphen and whitespace insensitive key used to compare labels and aliases. */
export function normalizePackTerm(s: string): string {
  return s.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/** Structural checks the schema cannot express; returns human-readable problems (empty when valid). */
export function validatePackIntegrity(pack: VocabPack): string[] {
  const problems: string[] = [];
  const ids = new Map<string, PackConcept>();
  const terms = new Map<string, string>();
  for (const family of pack.families) {
    for (const c of family.concepts) {
      if (!c.id.startsWith(`${family.id}.`)) problems.push(`${c.id}: id does not start with family "${family.id}"`);
      if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
      ids.set(c.id, c);
    }
  }
  for (const family of pack.families) {
    for (const c of family.concepts) {
      let depth = 1;
      let cur: PackConcept | undefined = c;
      const guard = new Set<string>();
      while (cur?.parent) {
        const p: PackConcept | undefined = ids.get(cur.parent);
        if (!p) {
          problems.push(`${c.id}: parent "${cur.parent}" does not exist`);
          break;
        }
        if (!p.id.startsWith(`${family.id}.`)) problems.push(`${c.id}: parent in another family`);
        if (guard.has(p.id)) {
          problems.push(`${c.id}: parent cycle`);
          break;
        }
        guard.add(p.id);
        depth++;
        cur = p;
      }
      if (depth > PACK_MAX_DEPTH) problems.push(`${c.id}: depth ${depth} > ${PACK_MAX_DEPTH}`);
      for (const term of new Set([c.label, ...c.aliases].map(normalizePackTerm))) {
        const owner = terms.get(term);
        if (owner && owner !== c.id) problems.push(`"${term}" shared by ${owner} and ${c.id}`);
        else terms.set(term, c.id);
      }
    }
  }
  return problems;
}

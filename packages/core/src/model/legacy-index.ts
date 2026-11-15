import { z } from 'zod';

/**
 * Shapes of the old index (read-only input of the one-shot importer).
 * Everything is tolerant (nullable/optional, unknown keys kept) because the old
 * files were written by a script over time. The importer maps these to the native
 * model and stores whatever has no native field under `legacy`.
 */
const strList = z.array(z.string()).default([]);
const nullableStr = z.string().nullable().optional();

export const legacyTagsSchema = z.looseObject({
  title: nullableStr,
  authors: strList.optional(),
  type: nullableStr,
  macro: strList.optional(),
  implied_macro: strList.optional(),
  micro: strList.optional(),
  implied: strList.optional(),
  keywords: strList.optional(),
  extra: strList.optional(),
  year: z.union([z.number(), z.string()]).nullable().optional(),
  lang: nullableStr,
  summary: nullableStr,
  confidence: z.union([z.number(), z.string()]).nullable().optional(),
  source: nullableStr,
  origin: nullableStr,
  venue: nullableStr,
  venue_ref: nullableStr,
  doi: nullableStr,
  arxiv: nullableStr,
  pub_status: nullableStr,
  pub_source: nullableStr,
  pub_checked: z.union([z.string(), z.number()]).nullable().optional(),
});
export type LegacyTags = z.infer<typeof legacyTagsSchema>;

/** One line of `files.jsonl`. */
export const legacyFileRecordSchema = z.looseObject({
  /** Relative path with `/`. */
  p: z.string(),
  mt: z.union([z.number(), z.string()]).nullable().optional(),
  sz: z.number().nullable().optional(),
  /** Content hash, often empty. */
  h: z.string().nullable().optional(),
  first: z.union([z.string(), z.number()]).nullable().optional(),
  tagged: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
  st: z.unknown().optional(),
  tags: legacyTagsSchema.optional(),
});
export type LegacyFileRecord = z.infer<typeof legacyFileRecordSchema>;

const aliasesSchema = z.object({ aliases: strList.optional() }).loose();

/** `taxonomy.json` of the old index. */
export const legacyTaxonomySchema = z.looseObject({
  version: z.union([z.number(), z.string()]).optional(),
  settings: z
    .looseObject({
      self_names: strList.optional(),
      extensions: strList.optional(),
      name_only_extensions: strList.optional(),
      prune_deleted_days: z.number().optional(),
    })
    .optional(),
  venues: z.record(z.string(), aliasesSchema).optional(),
  types: strList.optional(),
  macro: z.record(z.string(), aliasesSchema).optional(),
  micro: z
    .record(
      z.string(),
      z
        .object({
          macro: strList.optional(),
          aliases: strList.optional(),
          status: z.string().optional(),
          implies: strList.optional(),
        })
        .loose(),
    )
    .optional(),
  extra: z
    .record(
      z.string(),
      z.object({ group: z.string().optional(), source: z.string().optional(), added: z.union([z.string(), z.number()]).optional() }).loose(),
    )
    .optional(),
  imports_done: z.unknown().optional(),
});
export type LegacyTaxonomy = z.infer<typeof legacyTaxonomySchema>;

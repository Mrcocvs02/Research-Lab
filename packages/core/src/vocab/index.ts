import { z } from 'zod';

export { PACK_MAX_DEPTH, normalizePackTerm, packConceptSchema, packFamilySchema, validatePackIntegrity, vocabPackSchema, type PackConcept, type PackFamily, type VocabPack } from './pack-schema.js';

/** `<dataDir>/vocab-pack.json` (D-516): the pack in use and what the user decided about it. */
export const vocabPackStateSchema = z.object({
  schemaVersion: z.literal(1),
  packId: z.string().min(1).max(80),
  packVersion: z.number().int().nonnegative(),
  enabledAt: z.string().max(40),
  /** Pack family id -> id of the root of the library, or `later` (created when its first concept becomes a tag). */
  families: z.record(z.string().max(80), z.string().max(120)),
  /** Pairs the user said are not the same (node id, concept id); never proposed again. */
  // `[nodeId, conceptId]` (an array of two, not a zod tuple: that class would be pulled into the code the start loads)
  rejected: z.array(z.array(z.string().max(120)).length(2)).max(5000),
  /** The change groups `enable` made, oldest first: what "Turn off and undo the links" reverts. */
  changeIds: z.array(z.string().max(80)).max(200),
  /** The suggestion was shown and dismissed or taken. */
  suggested: z.boolean().optional(),
});
export type VocabPackState = z.infer<typeof vocabPackStateSchema>;

/** `packs/index.json` emitted by the build: what the list needs without reading a pack. */
export const packIndexSchema = z.object({
  packs: z.array(
    z.object({
      id: z.string(),
      version: z.number().int(),
      label: z.string(),
      labelIt: z.string().optional(),
      families: z.array(z.object({ id: z.string(), label: z.string(), singleValue: z.boolean(), concepts: z.number().int() })),
    }),
  ),
});
export type PackIndex = z.infer<typeof packIndexSchema>;

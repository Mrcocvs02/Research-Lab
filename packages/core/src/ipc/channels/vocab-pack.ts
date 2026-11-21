import { z } from 'zod';
import { itemIdSchema } from '../../common.js';
import { defineChannels, defineEvents } from '../registry.js';

/**
 * The field vocabulary (pack, D-516 .. D-519). The packs are JSON resources read by main on demand (never bundled as JS) and the
 * answers are built in main, so they are typed with plain interfaces (`z.custom`) and the registry stays small (D-501).
 */
export const VOCAB_PACK_LIMITS = { rows: 2000, rejected: 5000, docIds: 500, search: 6, q: 200 } as const;

export type PackConfidence = 'sure' | 'likely' | 'maybe';

export interface PackFamilyInfo {
  id: string;
  label: string;
  singleValue: boolean;
  concepts: number;
}
export interface PackInfo {
  id: string;
  version: number;
  label: string;
  labelIt?: string;
  families: PackFamilyInfo[];
}

/** How a pack family was paired with a root of the user's vocabulary (`root`: its id, or `later` = created at first use). */
export interface PackFamilyMatch {
  packFamily: string;
  root: string;
  /** `largest` (Topic: the biggest many-value family), `name`, `overlap` (>= 50 % of the recognised values), `later`; `kind` = paired but the kinds differ (a warning, the type is never changed). */
  reason: 'largest' | 'name' | 'overlap' | 'later' | 'kind';
}
export interface PackMatch {
  nodeId: string;
  conceptId: string;
  /** The detector rule that fired (`form`, `plural`, `acronym-in-name`, `alias`, `acronym-expansion`, `spelling`, ...) or `several` when the choice is the user's. */
  rule: string;
  confidence: PackConfidence;
  /** Path of the concept in the pack, `Topic › Area › Concept`. */
  path: string;
}
export interface PackPreview {
  /** Tags the pack recognises, tags in the library, papers with a field topic, papers. */
  recognized: number;
  tags: number;
  papersWithTopic: number;
  papers: number;
  /** Tags that two concepts or concepts that two tags claim (the user chooses). */
  conflicts: number;
  families: PackFamilyMatch[];
  matches: PackMatch[];
  /** A tag the field tells apart from a concept: shown, never merged. */
  distinct: Array<{ nodeId: string; conceptId: string }>;
  place: Array<{ nodeId: string; parentId: string | null }>;
}

export interface PackState {
  packId: string;
  packVersion: number;
}
export interface PackListResult {
  packs: PackInfo[];
  active: PackState | null;
  /** A pack that recognises at least 20 % of the tags, offered once per library (null: none, or already asked). */
  suggest: string | null;
}
export interface PackSearchItem {
  conceptId: string;
  label: string;
  /** `Topic › Area › **Concept**` without the concept itself: `Topic › Area`. */
  path: string;
  family: string;
}

const matchAccept = z.object({ nodeId: itemIdSchema, conceptId: z.string().min(1).max(120), useFieldName: z.boolean().optional() });
const placeAccept = z.object({ nodeId: itemIdSchema, parentId: itemIdSchema.nullable() });

/** The field vocabulary was applied by itself (D-565): the Activity panel and a toast say so, with Undo and Review. */
export const vocabPackEvents = defineEvents('vocabPack', { autoApplied: z.object({ n: z.number().int().nonnegative(), changeId: z.string().max(80), at: z.string().max(40) }) });

export const vocabPackChannels = defineChannels('vocabPack', {
  /** The packs the app ships, the active one of the library and whether to suggest one (once; `dismiss` marks the suggestion as seen). Local. */
  list: { request: z.object({ dismiss: z.boolean().optional() }), response: z.custom<PackListResult>() },
  /** What a pack would do to this library, computed in main (nothing is sent anywhere). `NOT_FOUND` for an unknown pack. */
  preview: { request: z.object({ packId: z.string().min(1).max(80) }), response: z.custom<PackPreview>() },
  /**
   * Turns the pack on: links the accepted tags to their concepts and places them, as ONE undoable change; `reject` remembers pairs
   * that are not the same. `families` maps each pack family to a root of the library or `later`.
   */
  enable: {
    request: z.object({
      packId: z.string().min(1).max(80),
      /** Pack family id -> root id, or `later`: a catch-all object, not a `record` (zod's record class would join the code the start loads). */
      families: z.object({}).catchall(z.string().max(120)),
      accept: z.object({ matches: z.array(matchAccept).max(VOCAB_PACK_LIMITS.rows), place: z.array(placeAccept).max(VOCAB_PACK_LIMITS.rows) }),
      /** `[nodeId, conceptId]`: an array of two, not a `tuple` (zod's tuple class would join the code the start loads). */
      reject: z.array(z.array(z.string().max(120)).length(2)).max(VOCAB_PACK_LIMITS.rejected),
    }),
    response: z.custom<{ changeId: string | null; linked: number; placed: number }>(),
  },
  /** Stops using the pack; with `undo` the links are undone, last change first (it stops, with a message, when a later change touches the same tags). */
  disable: { request: z.object({ undo: z.boolean() }), response: z.custom<{ undone: number; stopped?: string }>() },
  /** Concepts of the active pack that no tag of the library uses yet, for the tag picker. `INVALID_REQUEST` without an active pack. */
  search: { request: z.object({ q: z.string().max(VOCAB_PACK_LIMITS.q), limit: z.number().int().min(1).max(VOCAB_PACK_LIMITS.search).optional() }), response: z.custom<{ items: PackSearchItem[] }>() },
  /**
   * Makes a concept a tag (and its missing ancestors, down from level 1 of its family; depth <= 3) and, with `docIds`, puts it on those
   * papers: ONE change. `INVALID_REQUEST` without an active pack, or with `details.reason = 'depth'` past the depth limit.
   */
  materialize: {
    request: z.object({ conceptId: z.string().min(1).max(120), docIds: z.array(z.string()).max(VOCAB_PACK_LIMITS.docIds).optional() }),
    response: z.custom<{ nodeId: string; created: string[]; changeId: string }>(),
  },
});

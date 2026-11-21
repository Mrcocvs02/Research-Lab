import { z } from 'zod';
import { documentIdSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { defineChannels } from '../registry.js';
import type { TaxonomyOp } from './taxonomy.js';

/** Upper bounds of the editable Map (D-534): papers moved in one gesture, saved views, papers kept in a saved view, blocks kept in a frame. */
export const MAP_EDIT_LIMITS = { move: 5000, views: 100, selection: 500, frameBlocks: 20, name: 80, moves: 100 } as const;

// Replies are built by the main process: they are typed here and not validated again (the main entry stays small, D-408).
const reply = <T>() => z.custom<T>();
const scope = z.object({ folder: relativePathSchema.optional(), projectId: z.string().max(100).optional(), tagId: itemIdSchema.optional() }).optional();
const family = z.string().min(1).max(200);

/** What a proposal says about a cut of the tree: blocks, then percentages 0-100 (clear papers over the covered ones, covered papers over the scope, biggest block over the scope) and the smallest block (papers). */
export interface MacroStats {
  blocks: number;
  clearPct: number;
  coverage: number;
  largestPct: number;
  smallest: number;
}
export interface MacroChild {
  id: string;
  label: string;
  papers: number;
}
/**
 * One move of a proposal, the unit the user ticks (all but the `cooc` ones start ticked). `split`: the value `id` is too generic, its `children` rise to level 1 and it becomes a family
 * of its own. `gather`: the `children` (siblings that go together or are small) go under `parent`, which becomes the level 1 value.
 * A `gather` over children that a `split` raised has `requires` = those moves (unticking a move unticks the ones that require it).
 */
export interface MacroMove {
  id: string;
  kind: 'split' | 'gather';
  /** The value divided, or the name of the parent that gathers. */
  label: string;
  /** Papers the move touches. */
  papers: number;
  /** `split`: the share of papers that carry the value (0-1). */
  share: number;
  children: MacroChild[];
  /** `gather`: where the parent comes from. `pack`: a concept of the field vocabulary; `existing`: a node already there; `provisional`: a name to be written by the user (the dialog asks for it, `names[move id]`). */
  parent?: { kind: 'pack' | 'existing' | 'provisional'; id?: string; label: string };
  requires: string[];
  /** Papers whose hand-fixed main value returns automatic if the move is applied. */
  pinsLost: number;
  /** A group made because the papers meet, not because of the structure of the field (offered without a field vocabulary): it starts unticked and the dialog says so (D-568). */
  cooc?: boolean;
}
export interface MacroCutItem {
  id: string;
  label: string;
  papers: number;
  kind: 'keep' | 'split-child' | 'gather';
  children?: MacroChild[];
}
export interface MacroProposal {
  family: string;
  before: MacroStats;
  after: MacroStats;
  /** The proposed level 1 values (`cut`), the moves that lead to them, and what applying them does to the taxonomy (`ops`, `materialize`: concepts of the field vocabulary to create first). */
  cut: MacroCutItem[];
  moves: MacroMove[];
  ops: TaxonomyOp[];
  materialize: string[];
  /** Without moves: `fine` = the blocks are already clear, `no-cut` = no cut of the tree improves them. */
  reason?: 'fine' | 'no-cut';
  /** The moves left out (`skip`, or without it the groups by co-occurrence, D-568, and the ones that need them): `after`, `cut` and `ops` are for the others. */
  skipped: string[];
  /** Papers whose main value is not clear today (at most 5000), for "Select the unclear ones". */
  unclear: string[];
}

/** Where a saved view frames the Map; `sig` is the fingerprint of the layout a camera was taken on: a camera is only used while it still matches (D-527). */
export type MapViewFrame = { kind: 'fit' } | { kind: 'blocks'; ids: string[] } | { kind: 'docs' } | { kind: 'camera'; cx: number; cy: number; k: number; sig: string };
export interface MapViewState {
  family: string;
  scope?: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;
  years?: number[] | undefined;
  filters: { onlyUnread?: boolean | undefined; gaps?: boolean | undefined; kinds: Array<'cites' | 'linked' | 'similar'>; strictness: 'strict' | 'normal' | 'wide'; edgeMode: 'selected' | 'strong' | 'none' };
  /** Papers selected (at most 500). */
  selection: string[];
  focus?: string | undefined;
  frame: MapViewFrame;
}
/** A saved view of the Map, kept in `<dataDir>/map-views.json` (D-527). */
export interface MapView {
  id: string;
  name: string;
  projectId?: string | null | undefined;
  state: MapViewState;
  createdAt: string;
  updatedAt: string;
}
/** What `mapViews:save` takes: the main process checks it against its schema (`features/map-edit/views.ts`), so the schema is not part of the first load. */
export type MapViewInput = Pick<MapView, 'name' | 'projectId' | 'state'> & { id?: string | undefined; createdAt?: string | undefined };

/**
 * Edits of the Map made by hand (D-521..D-523, D-533) and its saved views (D-527), in lazy chunks of the main process.
 * `move` = drag papers into a block; `macroPropose` / `macroApply` = a cut of the tree that makes the blocks clearer.
 */
export const mapEditChannels = defineChannels('mapEdit', {
  /**
   * Moves papers to the block `to` (a level 1 value of the family; `null` = "No value") of an editable family (Topic or a `root:<id>` one).
   * A family of one value: the papers lose the family's other tags and get `to`. A family of several values: `to` becomes the paper's
   * hand-fixed main value (added if missing), the other values stay, unless `removeFrom`: then the tags under the old main value go too.
   * ONE change however many papers (5000 at most), all or nothing, undone as one. Errors: INVALID_REQUEST `details.reason` = `family` | `target`.
   */
  move: {
    request: z.object({ family, docIds: z.array(documentIdSchema).min(1).max(MAP_EDIT_LIMITS.move), to: itemIdSchema.nullable(), removeFrom: z.boolean().optional(), scope }),
    /** `removed`: labels of the tags taken off (at most 20); `already`: papers that already carried `to`. */
    response: reply<{ changeId: string | null; changed: number; removed: string[]; already: number }>(),
  },
  /** The cut of the tree proposed for a family (D-520, D-568); `skip` = ids of moves the user unticked: the answer is the proposal without them (no `skip`: without the groups by co-occurrence). Nothing is written. */
  macroPropose: { request: z.object({ family, scope, skip: z.array(z.string().max(300)).max(MAP_EDIT_LIMITS.moves).optional() }), response: reply<MacroProposal>() },
  /** Applies the ticked moves (their ids) as ONE change of the taxonomy; `names` holds the names written for provisional parents. CONFLICT `details.reason` = `stale` if the library changed since the proposal. */
  macroApply: {
    request: z.object({ family, scope, moves: z.array(z.string().max(300)).min(1).max(MAP_EDIT_LIMITS.moves), names: z.record(z.string().max(300), z.string().trim().min(1).max(200)) }),
    response: reply<{ changeId: string; applied: number }>(),
  },
});

/** Saved views of the Map (D-527): at most 100, a repeated name gets " (2)". Not part of the history (working preferences). */
export const mapViewsChannels = defineChannels('mapViews', {
  list: { request: z.object({}), response: reply<{ views: MapView[] }>() },
  /** Without `id`: a new view. With the `id` of a view: it is replaced; with an unknown `id` (an undone deletion): it is created again with that `createdAt`. */
  save: { request: z.object({ view: z.custom<MapViewInput>() }), response: reply<{ view: MapView }>() },
  delete: { request: z.object({ id: z.string().min(1).max(100) }), response: reply<{ ok: true }>() },
});

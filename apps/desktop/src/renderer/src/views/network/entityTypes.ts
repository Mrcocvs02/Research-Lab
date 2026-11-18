/**
 * The shape of `graph:entityNetwork` (D-387, §4.21.3). The channel is written by N4 in the main process; until it exists the
 * view derives the same shape from the channels that are there (`entityData.ts`), so these types are the contract between the
 * two and nothing here imports `@rl/core`.
 */
export type EntityMode = 'tag' | 'topic' | 'author';
export const MODES = ['doc', 'tag', 'topic', 'author'] as const;
export type NetMode = (typeof MODES)[number];

export interface EntityNode {
  /** Same ids as Explore (`author:<key>`, a taxonomy node id, a cluster id): `explore:related` works from them. */
  id: string;
  label: string;
  /** Documents of the entity in the library. */
  count: number;
  /** Ten bins of publication years over `EntityNetwork.yearRange`. */
  years: number[];
  /** What the tint comes from: a topic id, a tag branch id, or `#rrggbb` (a colour the user gave to a tag). */
  colorKey: string;
  /** Hull group: the tag branch, the parent topic, the author community. */
  group: string;
  /** Other forms of the name (authors): more than one means a possible namesake. */
  variants?: string[];
  /** Label of the group (the hull): "Group of <most central author>", the branch, the parent topic. */
  groupLabel?: string;
}

export interface EntityEdge {
  a: string;
  b: string;
  /** Strength 0..1 (cosine of co-occurrence, normalised affinity, log of the co-authored documents). */
  w: number;
  /** Raw count behind the strength (documents in common). */
  n: number;
  /** Tag "implies" edges of the taxonomy: dashed and light. */
  implies?: boolean;
}

export interface EntityNetwork {
  nodes: EntityNode[];
  edges: EntityEdge[];
  /** Entities before the cap (800). */
  total: number;
  truncated: boolean;
  /** First and last year of the ten bins. */
  yearRange?: [number, number] | undefined;
  /** Documents in the entity network (all the documents in the scope). */
  documents?: number | undefined;
}

export interface EntityRequest {
  mode: EntityMode;
  level?: number | undefined;
  scope?: { folder?: string; projectId?: string; tagId?: string } | undefined;
  years?: [number, number] | undefined;
  minDocs: number;
  minWeight: number;
  limit: number;
}

export const ENTITY_LIMIT = 800;
export const TOP_EDGES_PER_NODE = 8;
/** Works with more authors than this count for each author but create no co-authorship edges (consortia). */
export const CONSORTIUM = 25;

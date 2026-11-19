/**
 * The shape of `graph:entityNetwork` (D-387, D-454, §4.21.3), computed by the main process (`packages/graph/src/entity-network.ts`).
 * The contract itself is in `@rl/core`; these are the view's own types, so nothing here imports it.
 */
/** The view shows the authors only (section 19.2.1): tags and topics are the vocabulary tree of Explore (section 19.2.7). */
export type EntityMode = 'author';

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
  /** Group: the tag branch, the parent topic, the author community. */
  group: string;
  /** Other forms of the name (authors): more than one means a possible namesake. */
  variants?: string[];
  /** Macro-area shares and centrality (D-483). */
  ar?: ReadonlyArray<ReadonlyArray<number>> | undefined;
  az?: number | undefined;
  /** Label of the group: "Group of <most central author>", the branch, the parent topic. */
  groupLabel?: string;
}

export interface EntityEdge {
  a: string;
  b: string;
  /** Strength 0..1 (cosine of co-occurrence, normalised affinity, log of the co-authored documents). */
  w: number;
  /** Raw count behind the strength (documents in common). */
  n: number;
}

export interface EntityNetwork {
  nodes: EntityNode[];
  edges: EntityEdge[];
  /** Entities before the cap (800). */
  total: number;
  truncated: boolean;
  /** First and last year of the ten bins. */
  yearRange?: [number, number] | undefined;
  /** Macro-areas of the library (D-483), when the taxonomy has any. */
  areas?: Array<{ id: string; label: string; count: number; branches: Array<{ id: string; count: number }> }> | undefined;
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

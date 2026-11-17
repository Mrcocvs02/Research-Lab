import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { aiMetaSchema } from '../../model/ai-field.js';
import { reasoningLevelSchema } from '../../settings.js';
import { defineChannels, defineEvents } from '../registry.js';
import { aiPreviewSchema } from './ai.js';

/** Upper bounds of the phase 6 channels. */
export const GRAPH_LIMITS = { mapPoints: 50_000, similar: 50, surprising: 200, neighbors: 300, exploreNodes: 500, labelClusters: 100, topTerms: 12 } as const;

/** Why two documents are close (plan §4 phase 6): text (TF-IDF), shared citations, shared tags. */
export const similarityReasonSchema = z.enum(['text', 'citations', 'tags']);

export const graphStatusSchema = z.object({
  /** `none`: never built; `building`; `ready`; `stale`: documents changed since the build (still usable). */
  state: z.enum(['none', 'building', 'ready', 'stale']),
  documents: z.number().int().nonnegative(),
  builtAt: isoDateSchema.nullable(),
  seed: z.number().int().nullable(),
  /** Documents added or changed since the build, placed incrementally without a full rebuild. */
  pending: z.number().int().nonnegative(),
});

export const clusterViewSchema = z.object({
  id: z.string().max(100),
  parent: z.string().max(100).nullable(),
  /** 0 = the coarsest level. */
  level: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  /** Most characteristic terms of the cluster (local, TF-IDF), always available. */
  topTerms: z.array(z.string().max(100)).max(GRAPH_LIMITS.topTerms),
  /** Label written by Claude, marked as AI output (null until asked). */
  aiLabel: z.object({ text: z.string().max(200), meta: aiMetaSchema }).nullable(),
  centroid: z.object({ x: z.number(), y: z.number() }),
});

/**
 * Network, clusters and map (plan §4 phase 6), computed locally from text (TF-IDF over title, abstract, AI keywords and the
 * first pages), shared citations and shared tags; no network and no AI except the optional cluster labels. The model is
 * regenerable and lives in the local app data (never synced). Clusters and layout are deterministic for a given seed;
 * a new or changed document is placed from its neighbours without rebuilding everything.
 */
export const graphChannels = defineChannels('graph', {
  status: { request: z.object({}), response: graphStatusSchema },
  /** Builds (or rebuilds) the model in a worker started on demand; progress through `graph:progress`. */
  build: { request: z.object({ seed: z.number().int().min(0).max(2_147_483_647).optional() }), response: z.object({ jobId: z.string() }) },
  cancel: { request: z.object({ jobId: z.string().max(100) }), response: z.object({ cancelled: z.boolean() }) },
  /**
   * The 2D map: one point per document (in the scope when given) with its cluster at each level, and the clusters.
   * NOT_FOUND ('no-model') when the model was never built.
   */
  map: {
    request: z.object({
      scope: z.object({ folder: relativePathSchema.optional(), projectId: z.string().max(100).optional(), tagId: itemIdSchema.optional() }).optional(),
    }),
    response: z.object({
      points: z.array(z.object({ docId: documentIdSchema, x: z.number(), y: z.number(), clusters: z.array(z.string().max(100)).max(8) })).max(GRAPH_LIMITS.mapPoints),
      clusters: z.array(clusterViewSchema),
      seed: z.number().int(),
      builtAt: isoDateSchema,
    }),
  },
  /** Closest documents with the reasons and what they share. Works without a built model (computed on the fly, slower). */
  similar: {
    request: z.object({ docId: documentIdSchema, limit: z.number().int().min(1).max(GRAPH_LIMITS.similar).default(10) }),
    response: z.object({
      items: z.array(
        z.object({
          docId: documentIdSchema,
          score: z.number().min(0).max(1),
          reasons: z.array(similarityReasonSchema),
          shared: z.object({ tags: z.array(itemIdSchema), citations: z.number().int().nonnegative(), terms: z.array(z.string().max(100)).max(GRAPH_LIMITS.topTerms) }),
        }),
      ),
    }),
  },
  /**
   * "Papers that are close but do not look it" (plan §4 phase 6): pairs with a high text similarity and no shared tag,
   * no citation link and no shared folder. For one document, or the strongest pairs of the library.
   */
  surprising: {
    request: z.object({ docId: documentIdSchema.optional(), limit: z.number().int().min(1).max(GRAPH_LIMITS.surprising).default(20) }),
    response: z.object({ pairs: z.array(z.object({ a: documentIdSchema, b: documentIdSchema, score: z.number().min(0).max(1), terms: z.array(z.string().max(100)).max(GRAPH_LIMITS.topTerms) })) }),
  },
  /**
   * Neighbours of a node for the expandable network: a document's similar documents, tags, folder and citation links in
   * the library; a folder's sub-folders and documents; a tag's documents and related tags.
   */
  neighbors: {
    request: z.object({
      node: z.object({ kind: z.enum(['doc', 'folder', 'tag']), id: z.string().max(1024) }),
      kinds: z.array(z.enum(['similar', 'citations', 'tags', 'folder', 'children', 'documents'])).min(1).max(6),
      limit: z.number().int().min(1).max(GRAPH_LIMITS.neighbors).default(50),
    }),
    response: z.object({
      nodes: z.array(z.object({ kind: z.enum(['doc', 'folder', 'tag']), id: z.string().max(1024), label: z.string(), count: z.number().int().nonnegative().optional() })),
      /** `from` / `to` are node KEYS `<kind>:<id>` (a folder and a tag may share the same id). */
      edges: z.array(z.object({ from: z.string().max(1100), to: z.string().max(1100), kind: z.enum(['similar', 'cites', 'tagged', 'contains']), weight: z.number().min(0).max(1) })),
    }),
  },
  /**
   * Cluster labels written by Claude (plan §5 use 6): sends the clusters' top terms and the titles of their documents
   * that are in AI-enabled folders (never the text). Same rules as the other AI sends: preview, confirmation when the
   * library asks for it (CONFLICT 'needs-confirmation'), monthly cap, log. Labels are stored locally, marked as AI output.
   */
  previewLabels: {
    request: z.object({ clusterIds: z.array(z.string().max(100)).min(1).max(GRAPH_LIMITS.labelClusters), model: z.string().min(1).max(100) }),
    response: aiPreviewSchema,
  },
  labelClusters: {
    request: z.object({ clusterIds: z.array(z.string().max(100)).min(1).max(GRAPH_LIMITS.labelClusters), model: z.string().min(1).max(100), reasoning: reasoningLevelSchema, confirmed: z.boolean().default(false) }),
    response: z.object({ labelled: z.number().int().nonnegative() }),
  },
});

export const graphEvents = defineEvents('graph', {
  progress: z.object({ jobId: z.string(), phase: z.enum(['vectors', 'similarity', 'clusters', 'layout', 'done', 'failed', 'cancelled']), done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
});

/** A dimension of the zoomable exploration (plan §4 phase 6). */
export const exploreDimensionSchema = z.enum(['topic', 'author', 'venue']);

export const exploreNodeSchema = z.object({
  /** Stable within a dimension: a taxonomy node id, `group:<id>` / `author:<normalized name>`, `area:<id>` / `venue:<id or name>`. */
  id: z.string().max(500),
  label: z.string().max(300),
  kind: z.enum(['topic', 'author-group', 'author', 'venue-area', 'venue']),
  /** Documents under this node (descendants included). */
  count: z.number().int().nonnegative(),
  hasChildren: z.boolean(),
});

/**
 * Zoomable exploration: topics follow the taxonomy levels (macro → micro → sub-topics, free depth); authors go from
 * co-author groups to single authors; venues from areas (groups of venues sharing topics) to single venues. Any node
 * leads to its documents, and to the related nodes of another dimension (author → topics, venue → papers…) so the view
 * can switch without losing the starting point. Local, offline, no AI.
 */
export const exploreChannels = defineChannels('explore', {
  /** Children of a node (null: the top level), with the path from the top. NOT_FOUND for an unknown node. */
  level: {
    request: z.object({ dimension: exploreDimensionSchema, parentId: z.string().max(500).nullable().default(null) }),
    response: z.object({ nodes: z.array(exploreNodeSchema).max(GRAPH_LIMITS.exploreNodes), path: z.array(z.object({ id: z.string(), label: z.string() })) }),
  },
  /** Documents under a node (descendants included), most relevant first. */
  documents: {
    request: z.object({ dimension: exploreDimensionSchema, id: z.string().max(500), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().nonnegative().default(0) }),
    response: z.object({ docIds: z.array(documentIdSchema), total: z.number().int().nonnegative() }),
  },
  /** Nodes of another dimension related to a node (e.g. the topics of an author), strongest first, with their path. */
  related: {
    request: z.object({ from: z.object({ dimension: exploreDimensionSchema, id: z.string().max(500) }), to: exploreDimensionSchema, limit: z.number().int().min(1).max(100).default(20) }),
    response: z.object({ nodes: z.array(exploreNodeSchema.extend({ score: z.number().min(0).max(1), path: z.array(z.object({ id: z.string(), label: z.string() })) })) }),
  },
});

import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { aiMetaSchema } from '../../model/ai-field.js';
import { reasoningLevelSchema } from '../../settings.js';
import { defineChannels, defineEvents } from '../registry.js';
import { aiPreviewSchema } from './ai.js';

/** Upper bounds of the phase 6 channels. */
export const GRAPH_LIMITS = { mapPoints: 50_000, buildDocuments: 60_000, citationKeys: 200, similar: 50, surprising: 200, neighbors: 300, exploreNodes: 500, labelClusters: 100, topTerms: 12, entityNodes: 800, entityEdges: 6400 } as const;

const authorKeySchema = z.string().min(1).max(600);
/** `merge`: key -> key it was merged into; `split`: keys shown as one node per written form. */
export const authorAliasesSchema = z.object({ merge: z.record(authorKeySchema, authorKeySchema), split: z.array(authorKeySchema).max(5000) });

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
  /** Of `pending`, the documents that were already in the model and have changed since (the rest are new). */
  changed: z.number().int().nonnegative().optional(),
  /** Documents of the model that are gone from the library since the build. */
  removed: z.number().int().nonnegative(),
});

/** Macro-areas (D-483): `ar` up to 3 triples [area, branch, share x 100], `az` the centrality x 100; `areas` is `{ id, label, count, branches }[]`. Built by the lazy `areas` chunk of the main process. */
const A = { ar: z.array(z.array(z.number())).optional(), az: z.number().optional() };
const areas = z.array(z.any()).optional();
/** Reading state of a paper for the Map (D-525): 1 = in studio, 2 = read; absent = to read (the default of nearly every paper). */
const ST = { st: z.union([z.literal(1), z.literal(2)]).optional() };
const familyReason = z.object({ coverage: z.number(), clarity: z.number(), values: z.number() });
const strictnessSchema = z.enum(['strict', 'normal', 'wide']).default('normal');
const evidenceEdgeSchema = z.object({ a: documentIdSchema, b: documentIdSchema, e: z.number(), kinds: z.array(z.enum(['cites', 'linked', 'similar'])).min(1).max(3), w: z.number().optional() });
const familyScope = z.object({ folder: relativePathSchema.optional(), projectId: z.string().max(100).optional(), tagId: itemIdSchema.optional() }).optional();

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
      points: z.array(z.object({ docId: documentIdSchema, x: z.number(), y: z.number(), clusters: z.array(z.string().max(100)).max(8), ...A, ...ST })).max(GRAPH_LIMITS.mapPoints),
      areas,
      clusters: z.array(clusterViewSchema),
      seed: z.number().int(),
      builtAt: isoDateSchema,
      /** Documents left off the map because there are more than `GRAPH_LIMITS.mapPoints` (0 almost always). */
      omitted: z.number().int().nonnegative(),
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
      kinds: z.array(z.enum(['similar', 'citations', 'tags', 'folder', 'children', 'documents', 'links'])).min(1).max(7),
      limit: z.number().int().min(1).max(GRAPH_LIMITS.neighbors).default(50),
    }),
    response: z.object({
      nodes: z.array(z.object({ kind: z.enum(['doc', 'folder', 'tag']), id: z.string().max(1024), label: z.string(), count: z.number().int().nonnegative().optional(), ...A })),
      areas,
      /** Tags of a document left out of the answer (only the top few by weight are drawn, D-491). */
      hiddenTags: z.number().int().positive().optional(),
      /** `from` / `to` are node KEYS `<kind>:<id>` (a folder and a tag may share the same id). */
      edges: z.array(z.object({ from: z.string().max(1100), to: z.string().max(1100), kind: z.enum(['similar', 'cites', 'tagged', 'contains', 'linked']), weight: z.number().min(0).max(1), id: z.string().max(40).optional(), reasons: z.record(z.string(), z.unknown()).optional() })),
    }),
  },
  /**
   * Grouping families of the Map (D-489): `families` lists what the library offers ("topic", "level:method", "prefix:grp:", "auto", ...);
   * with a `family` it also returns that family's clusters (`areas`, the biggest eight and "other") and, for each document of the scope (or
   * only `docIds`), its shares `ar` / `az` like the macro-areas. Computed locally in a lazy chunk; nothing is written.
   */
  family: {
    request: z.object({
      family: z.string().max(200).optional(),
      scope: z.object({ folder: relativePathSchema.optional(), projectId: z.string().max(100).optional(), tagId: itemIdSchema.optional() }).optional(),
      docIds: z.array(documentIdSchema).max(GRAPH_LIMITS.mapPoints).optional(),
      /** Width over height of the canvas, for the blocks (D-498). */
      aspect: z.number().min(0.2).max(10).optional(),
    }),
    response: z.object({
      families: z.array(z.object({ id: z.string().max(200), label: z.string().max(200), count: z.number().int().nonnegative(), eligible: z.boolean().optional(), reason: familyReason.optional() })),
      areas,
      items: z.array(z.object({ id: documentIdSchema, cell: z.array(z.number()).length(2).optional(), block: z.string().max(200).optional(), others: z.array(z.string().max(200)).max(2).optional(), ...A, ...ST })).max(GRAPH_LIMITS.mapPoints),
      /** With a family: whether it passes the test of the blocks, and the numbers behind it. */
      eligible: z.boolean().optional(),
      reason: familyReason.optional(),
      /** Blocks (world units) of an eligible family or of the automatic one; each paper's `cell` is its top-left corner. */
      blocks: z.array(z.object({ id: z.string().max(200), label: z.string().max(300), count: z.number().int().nonnegative(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), sub: z.array(z.object({ id: z.string().max(200), label: z.string().max(300), y: z.number() })) })).optional(),
    }),
  },
  /** Evidence edges between papers (citations, links of the user, similarity from the library threshold tau), at most 5 per paper (D-499). Without a model only citations and links. */
  evidence: {
    request: z.object({ scope: familyScope, strictness: strictnessSchema }),
    response: z.object({ tau: z.number(), edges: z.array(evidenceEdgeSchema).max(5 * GRAPH_LIMITS.mapPoints) }),
  },
  /** Shortest chain of evidence between two papers (Dijkstra, similarity from 0.75 tau, at most 6 steps); `steps` empty when there is none. */
  path: {
    request: z.object({ a: documentIdSchema, b: documentIdSchema, strictness: strictnessSchema }),
    response: z.object({ tau: z.number(), steps: z.array(evidenceEdgeSchema).max(6) }),
  },
  /** Cross links of the vocabulary tree of a family: pairs of nodes that go together (lift >= 2, at least 2 papers), at most 2 per node. */
  vocabLinks: {
    request: z.object({ family: z.string().max(200) }),
    response: z.object({ links: z.array(z.object({ a: z.string().max(500), b: z.string().max(500), lift: z.number(), shared: z.number().int().nonnegative() })).max(2000) }),
  },
  /** The exact text "Dai un nome con Claude" would send for the clusters of the automatic family (top tags and titles of papers in enabled folders); nothing leaves. */
  previewFamilyNames: {
    request: z.object({ model: z.string().min(1).max(100).optional(), scope: familyScope }),
    response: z.object({ text: z.string(), candidates: z.number().int().nonnegative(), model: z.string(), approxTokens: z.number().int().nonnegative(), estimatedUsd: z.number().nonnegative().nullable(), needsDialog: z.boolean(), overDailyCap: z.boolean() }),
  },
  /** Claude proposes a short name per cluster; nothing is written, each name is accepted by the user (`graph:acceptFamilyName`). */
  nameFamily: {
    request: z.object({ model: z.string().min(1).max(100).optional(), scope: familyScope, confirmed: z.boolean().default(false) }),
    response: z.object({ items: z.array(z.object({ cluster: z.string().max(100), name: z.string().max(100), current: z.string().max(300) })).max(16) }),
  },
  /** Stores (or with null clears) the accepted name of one cluster of the automatic family, locally. */
  acceptFamilyName: {
    request: z.object({ cluster: z.string().min(1).max(100), name: z.string().trim().min(1).max(100).nullable(), scope: familyScope }),
    response: z.object({ ok: z.literal(true) }),
  },
  /**
   * Entity networks of the Map (D-387, D-454): tags (co-occurrence), topics (affinity of the model's clusters at a level)
   * and authors (co-authorship, consortia excluded), computed locally from the records and the model. At most `limit`
   * (800) nodes, the biggest, and the 8 heaviest edges of each. Ids are the ones of Explore (`author:<key>`, a taxonomy node,
   * a cluster id). Topics without a built model are an empty network, not an error.
   */
  entityNetwork: {
    request: z.object({
      mode: z.enum(['tag', 'topic', 'author']),
      /** Topic level (0 = the coarsest). */
      level: z.number().int().min(0).max(8).optional(),
      scope: z.object({ folder: relativePathSchema.optional(), projectId: z.string().max(100).optional(), tagId: itemIdSchema.optional() }).optional(),
      /** First and last year (a pair: `z.tuple` would add its machinery to the main bundle). */
      years: z.array(z.number().int().min(1000).max(3000)).length(2).optional(),
      minDocs: z.number().int().min(1).max(1000).default(2),
      minWeight: z.number().min(0).max(1).default(0),
      limit: z.number().int().min(1).max(GRAPH_LIMITS.entityNodes).default(GRAPH_LIMITS.entityNodes),
      /** An entity id: the network is that node with its heaviest neighbours, within `limit` ("Go to" for an entity beyond the cap). */
      focus: z.string().max(1100).optional(),
    }),
    response: z.object({
      nodes: z.array(
        z.object({
          id: z.string().max(1100),
          label: z.string().max(300),
          count: z.number().int().nonnegative(),
          /** Ten bins of publication years over `yearRange`. */
          years: z.array(z.number().int().nonnegative()).length(10),
          colorKey: z.string().max(200),
          group: z.string().max(1100),
          groupLabel: z.string().max(300).optional(),
          variants: z.array(z.string().max(300)).max(50).optional(),
          ...A,
        }),
      ).max(GRAPH_LIMITS.entityNodes),
      edges: z.array(z.object({ a: z.string().max(1100), b: z.string().max(1100), w: z.number().min(0).max(1), n: z.number().int().nonnegative(), implies: z.boolean().optional() })).max(GRAPH_LIMITS.entityEdges),
      /** Entities before the cap. */
      total: z.number().int().nonnegative(),
      truncated: z.boolean(),
      /** First and last year of the ten bins (absent when no document in the scope has a year). */
      yearRange: z.array(z.number().int()).length(2).optional(),
      /** Documents of the scope that the network was computed from. */
      documents: z.number().int().nonnegative(),
      areas,
    }),
  },
  /**
   * The user's corrections to the authors, kept in `<dataDir>/graph/author-aliases.json` (keys are the part of an id after `author:`):
   * merges an author key into another, or splits one into a node per written form; answers the new corrections.
   */
  editAuthorAliases: {
    request: z.discriminatedUnion('action', [
      z.object({ action: z.literal('merge'), from: authorKeySchema, to: authorKeySchema }),
      z.object({ action: z.literal('split'), key: authorKeySchema }),
      /** One-time import of what an older version kept in the browser; existing corrections win. */
      z.object({ action: z.literal('import'), aliases: authorAliasesSchema }),
    ]),
    response: authorAliasesSchema,
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
  progress: z.object({
    jobId: z.string(),
    phase: z.enum(['vectors', 'similarity', 'clusters', 'layout', 'done', 'failed', 'cancelled']),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** With `failed`: `too-large` (more documents than the graph handles), `timeout` (time limit or no answer), `memory` (the worker ran out of memory). */
    reason: z.enum(['too-large', 'timeout', 'memory']).optional(),
    /** With `done`: documents whose list of cited works was cut to the per-document cap. */
    trimmedCitations: z.number().int().positive().optional(),
  }),
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

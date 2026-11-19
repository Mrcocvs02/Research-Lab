/**
 * Phase 6: network, clusters, map and exploration, computed locally (no network, no AI). Pure: no Electron, no files.
 * TF-IDF vectors, nearest neighbours combined with shared citations and tags, seeded Louvain clustering in levels, a
 * seeded force layout, incremental placement of new documents, and zoomable exploration of topics, authors and venues.
 */
export { computeAreas } from './areas.js';
export { FAMILY_TOP, OTHER_CLUSTER, autoMemberships, familyModel, parseFamily, tagMemberships } from './families.js';
export type { FamilyKind, FamilyNode, FamilyRef, Memberships } from './families.js';
export type { AreaDoc, AreaModel, AreaNode, AreaShare, AreaSummary, AreaTriple } from './areas.js';
export { MAX_EXPLORE_NODES, NO_ALIASES, authorKey, createExploreIndex, fold, resolveAuthor } from './explore.js';
export { ENTITY_LIMIT, TOP_EDGES_PER_NODE, CONSORTIUM, buildEntityNetwork, communities, topEdges } from './entity-network.js';
export type { EntityDoc, EntityEdge, EntityInput, EntityNetwork, EntityNode, EntityRequest } from './entity-network.js';
export type { AuthorAliases, ExploreDimension, ExploreDoc, ExploreIndex, ExploreKind, ExploreNode, ExploreTaxonomy, PathStep } from './explore.js';
export { MAX_CITATION_KEYS, citationKey, citationSignals } from './citation-keys.js';
export { GRAPH_K, STORE_K, TEXT_REASON_MIN, WEIGHTS, analyze, combine, makeAnalysis, pairSignals, reasonsOf, similarTo } from './analysis.js';
export type { Analysis, Neighbor, Reason } from './analysis.js';
export { buildModel, decodeModel, encodeNeighbors, modelVector, modelVocabulary, neighborsOf, MODEL_FORMAT, MODEL_VERSION } from './model.js';
export type { BuildOptions, GraphModel, ModelCluster } from './model.js';
export { SURPRISING_MIN_TEXT, createPlacer, isSurprising, surprisingPairs } from './place.js';
export type { Placement, SurprisingPair } from './place.js';
export { clusterHierarchy, globalMeans, louvain, symmetrize, topTermsOf } from './cluster.js';
export type { ClusterNode } from './cluster.js';
export { forceLayout } from './layout.js';
export { MAX_COUNTS_PER_DOC, TermDictionary, buildVectors, buildVectorsPacked, countTerms, cosine, packCounts, sharedTerms, vectorize } from './tfidf.js';
export type { PackedCounts, TermCounts, Vocabulary } from './tfidf.js';
export { abortError } from './types.js';
export type { Edge, GraphDoc, RunContext, SparseVec } from './types.js';
export { makeRandom } from './random.js';
export { tokenize } from './text.js';

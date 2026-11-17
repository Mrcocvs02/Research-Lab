/**
 * Phase 6: network, clusters, map and exploration, computed locally (no network, no AI). Pure: no Electron, no files.
 * TF-IDF vectors, nearest neighbours combined with shared citations and tags, seeded Louvain clustering in levels, a
 * seeded force layout, incremental placement of new documents, and zoomable exploration of topics, authors and venues.
 */
export { MAX_EXPLORE_NODES, authorKey, createExploreIndex, fold } from './explore.js';
export type { ExploreDimension, ExploreDoc, ExploreIndex, ExploreKind, ExploreNode, ExploreTaxonomy, PathStep } from './explore.js';
export { citationKey, citationSignals } from './citation-keys.js';
export { GRAPH_K, STORE_K, TEXT_REASON_MIN, WEIGHTS, analyze, combine, makeAnalysis, reasonsOf, similarTo } from './analysis.js';
export type { Analysis, Neighbor, Reason } from './analysis.js';
export { buildModel, decodeModel, encodeNeighbors, modelVector, modelVocabulary, neighborsOf, MODEL_FORMAT, MODEL_VERSION } from './model.js';
export type { BuildOptions, GraphModel, ModelCluster } from './model.js';
export { SURPRISING_MIN_TEXT, createPlacer, isSurprising, surprisingPairs } from './place.js';
export type { Placement, SurprisingPair } from './place.js';
export { clusterHierarchy, globalMeans, louvain, symmetrize, topTermsOf } from './cluster.js';
export type { ClusterNode } from './cluster.js';
export { forceLayout } from './layout.js';
export { buildVectors, countTerms, cosine, sharedTerms, vectorize } from './tfidf.js';
export type { TermCounts, Vocabulary } from './tfidf.js';
export { abortError } from './types.js';
export type { Edge, GraphDoc, RunContext, SparseVec } from './types.js';
export { makeRandom } from './random.js';
export { tokenize } from './text.js';

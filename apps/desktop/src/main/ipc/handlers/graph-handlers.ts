/** Phase 6: network, clusters and map (D-238). Contract in `packages/core/src/ipc/channels/graph.ts`; the logic lives in `main/graph/`. */
import { cancelBuild, map, neighbors, similar, startBuild, status, surprising } from '../../graph/service.js';
import { labelClusters, previewLabels } from '../../graph/labels.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const graphHandlers = (s: MainServices): DomainHandlers<'graph'> => ({
  'graph:status': () => status(s),
  'graph:build': ({ seed }) => startBuild(s, seed),
  'graph:cancel': ({ jobId }) => cancelBuild(s, jobId),
  'graph:map': ({ scope }) => map(s, scope),
  'graph:similar': async ({ docId, limit }) => ({ items: await similar(s, docId, limit) }),
  'graph:surprising': ({ docId, limit }) => surprising(s, docId, limit),
  'graph:neighbors': (req) => neighbors(s, req),
  // Computed in a chunk of its own, loaded on first use: the start of the app does not carry it (D-449).
  'graph:family': async (req) => (await import('../../graph/family-run.js')).runFamily(s, req),
  'graph:entityNetwork': async (req) => (await import('../../graph/entity-run.js')).runEntityNetwork(s, req),
  'graph:editAuthorAliases': async (edit) => (await import('../../graph/author-aliases.js')).editAuthorAliases(await s.runtime.require(), edit),
  'graph:previewLabels': ({ clusterIds, model }) => previewLabels(s, { clusterIds, model }),
  'graph:labelClusters': ({ clusterIds, model, reasoning, confirmed }) => labelClusters(s, { clusterIds, model, reasoning, confirmed }),
});

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
  'graph:previewLabels': ({ clusterIds, model }) => previewLabels(s, { clusterIds, model }),
  'graph:labelClusters': ({ clusterIds, model, reasoning, confirmed }) => labelClusters(s, { clusterIds, model, reasoning, confirmed }),
});

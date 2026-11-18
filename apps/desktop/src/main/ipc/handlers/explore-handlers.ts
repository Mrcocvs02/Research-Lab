/** Phase 6: zoomable exploration of topics, authors and venues (D-238). Contract in `packages/core/src/ipc/channels/graph.ts`. */
import { AppError } from '@rl/core';
import { loadView } from '../../graph/view.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const unknown = () => new AppError('NOT_FOUND', 'Unknown node');

export const exploreHandlers = (s: MainServices): DomainHandlers<'explore'> => {
  const index = async () => {
    const rt = await s.runtime.require();
    const { aliases, key } = await (await import('../../graph/author-aliases.js')).readAuthorAliases(rt);
    return (await loadView(rt)).explore(aliases, key);
  };
  return {
    'explore:level': async ({ dimension, parentId }) => (await index()).level(dimension, parentId) ?? Promise.reject(unknown()),
    'explore:documents': async ({ dimension, id, limit, offset }) => (await index()).documents(dimension, id, limit, offset) ?? Promise.reject(unknown()),
    'explore:related': async ({ from, to, limit }) => {
      const nodes = (await index()).related(from, to, limit);
      if (!nodes) throw unknown();
      return { nodes };
    },
  };
};

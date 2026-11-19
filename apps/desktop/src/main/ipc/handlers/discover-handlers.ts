/** Discovery runs (wave 9, X6). Contracts: `packages/core/src/ipc/channels/discover.ts`. The logic is in `main/features/discover`, loaded on first use. */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const feature = () => import('../../features/discover/index.js');

export const discoverHandlers = (s: MainServices): DomainHandlers<'discover'> => ({
  'discover:list': async () => (await feature()).listDiscover(s),
  'discover:get': async (req) => (await feature()).getDiscover(s, req),
  'discover:start': async (req) => (await feature()).startDiscover(s, req),
  'discover:rerun': async (req) => (await feature()).rerunDiscover(s, req),
  'discover:cancel': async (req) => (await feature()).cancelDiscover(req),
  'discover:mark': async (req) => (await feature()).markDiscover(s, req),
  'discover:remove': async (req) => (await feature()).removeDiscover(s, req),
  'discover:prune': async (req) => (await feature()).pruneDiscover(s, req),
  'discover:estimate': async (req) => (await feature()).estimateDiscover(s, req),
  'discover:summarize': async (req) => (await feature()).summarizeDiscover(s, req),
});

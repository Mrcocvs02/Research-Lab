/** Links between documents (§18.2, L1). Contracts: `packages/core/src/ipc/channels/doclinks.ts`. The logic is in `main/features/doclinks`, loaded on first use. */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const feature = () => import('../../features/doclinks/index.js');

export const doclinksHandlers = (s: MainServices): DomainHandlers<'doclinks'> => ({
  'doclinks:find': async (req) => (await feature()).findLinks(s, req),
  'doclinks:progress': async ({ token }) => (await feature()).linkProgress(token),
  'doclinks:cancel': async ({ token }) => (await feature()).cancelLinks(token),
  'doclinks:list': async (req) => (await feature()).listLinks(s, req),
  'doclinks:remove': async (req) => (await feature()).removeLinks(s, req),
  'doclinks:add': async (req) => (await feature()).addLink(s, req),
});

/**
 * Synthesis (wave 10, X8): comparison table, research-group overview, citation context. Contracts:
 * `packages/core/src/ipc/channels/synthesis.ts`. The logic is in `main/features/{synthesis,citectx}`, loaded on first use.
 */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const compare = () => import('../../features/synthesis/compare.js');
const groups = () => import('../../features/synthesis/groups.js');

export const compareHandlers = (s: MainServices): DomainHandlers<'compare'> => ({
  'compare:estimate': async (req) => (await compare()).estimateCompare(s, req),
  'compare:run': async (req) => (await compare()).runCompare(s, req),
  'compare:cancel': async (req) => (await compare()).cancelCompare(req),
  'compare:save': async (req) => (await compare()).saveCompare(s, req),
  'compare:get': async (req) => (await compare()).getCompare(s, req),
  'compare:list': async (req) => (await compare()).listCompare(s, req),
  'compare:remove': async (req) => (await compare()).removeCompare(s, req),
  'compare:exportCsv': async (req) => (await compare()).exportCompareCsv(s, req),
});

export const groupsHandlers = (s: MainServices): DomainHandlers<'groups'> => ({
  'groups:estimate': async (req) => (await groups()).estimateGroups(s, req),
  'groups:get': async (req) => (await groups()).getGroups(s, req),
  'groups:run': async (req) => (await groups()).runGroups(s, req),
});

export const citectxHandlers = (s: MainServices): DomainHandlers<'citectx'> => ({
  'citectx:get': async (req) => (await import('../../features/citectx/index.js')).getCiteContext(s, req),
});

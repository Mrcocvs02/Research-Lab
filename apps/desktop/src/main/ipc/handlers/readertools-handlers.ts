/**
 * Reader tools (wave 7, X2): crops of figures, tables and equations, and "✦ Spiega". Contracts:
 * `packages/core/src/ipc/channels/readertools.ts`. The logic is in `main/features/*`, loaded on first use.
 */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const cropsHandlers = (s: MainServices): DomainHandlers<'crops'> => ({
  'crops:save': async (req) => (await import('../../features/crops/index.js')).saveCrop(s, req),
  'crops:get': async (req) => (await import('../../features/crops/index.js')).getCrop(s, req),
  'crops:remove': async (req) => (await import('../../features/crops/index.js')).removeCrop(s, req),
});

export const explainHandlers = (s: MainServices): DomainHandlers<'explain'> => ({
  'explain:estimate': async (req) => (await import('../../features/explain/index.js')).estimateExplain(s, req),
  'explain:run': async (req) => (await import('../../features/explain/index.js')).runExplain(s, req),
});

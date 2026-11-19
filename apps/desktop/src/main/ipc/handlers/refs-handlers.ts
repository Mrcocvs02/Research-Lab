/**
 * Citation cards and the guide (wave 9, X5). Contracts: `packages/core/src/ipc/channels/refs.ts`. The logic is in
 * `main/features/{refs,guides}`, loaded on first use.
 */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const refsHandlers = (s: MainServices): DomainHandlers<'refs'> => ({
  'refs:get': async (req) => (await import('../../features/refs/index.js')).getRefs(s, req),
});

export const guidesHandlers = (s: MainServices): DomainHandlers<'guides'> => ({
  'guides:get': async (req) => (await import('../../features/guides/index.js')).getGuide(s, req),
  'guides:prepare': async (req) => (await import('../../features/guides/index.js')).prepareGuide(s, req),
});

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

/** Literature notes, note templates and links between notes (wave 8, X3). Contracts: `packages/core/src/ipc/channels/literature.ts`. */
export const literatureHandlers = (s: MainServices): DomainHandlers<'literature'> => ({
  'literature:get': async (req) => (await import('../../features/literature/index.js')).getLiterature(s, req),
  'literature:estimate': async (req) => (await import('../../features/literature/index.js')).estimateLiterature(s, req),
  'literature:run': async (req) => (await import('../../features/literature/index.js')).runLiterature(s, req),
  'literature:approve': async (req) => (await import('../../features/literature/index.js')).approveLiterature(s, req),
  'literature:discard': async (req) => (await import('../../features/literature/index.js')).discardLiterature(s, req),
});

export const templatesHandlers = (s: MainServices): DomainHandlers<'templates'> => ({
  'templates:list': async () => (await import('../../features/templates/index.js')).listTemplates(s),
  'templates:save': async (req) => (await import('../../features/templates/index.js')).saveTemplate(s, req),
  'templates:remove': async (req) => (await import('../../features/templates/index.js')).removeTemplate(s, req),
  'templates:apply': async (req) => (await import('../../features/templates/index.js')).applyTemplate(s, req),
});

export const linksHandlers = (s: MainServices): DomainHandlers<'links'> => ({
  'links:incoming': async (req) => (await import('../../features/links/index.js')).incomingLinks(s, req),
  'links:titles': async (req) => (await import('../../features/links/index.js')).linkTitles(s, req),
  'links:suggest': async (req) => (await import('../../features/links/index.js')).suggestLinks(s, req),
});

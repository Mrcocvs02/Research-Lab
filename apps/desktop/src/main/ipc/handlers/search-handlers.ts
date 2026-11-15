import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

/** Offline full-text search over the local index; the renderer only sees ids, relative paths and snippets. */
export const searchHandlers = (s: MainServices): DomainHandlers<'search'> => ({
  'search:query': async ({ text, filters, sort, limit, offset }) => {
    const rt = await s.runtime.require();
    const started = performance.now();
    const page = await rt.search({ text, filters, sort, limit, offset });
    return { total: page.total, hits: page.hits, tookMs: Math.round((performance.now() - started) * 10) / 10 };
  },
  'search:facets': async ({ text, filters }) => {
    const rt = await s.runtime.require();
    const { labels, ...facets } = await rt.facets({ text, filters });
    return {
      ...facets,
      tags: facets.tags.map((b) => ({ ...b, label: labels.tags[b.value] })),
      types: facets.types.map((b) => ({ ...b, label: labels.types[b.value] })),
    };
  },
});

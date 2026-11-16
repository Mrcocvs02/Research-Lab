import type { Channels, ResponseOf, SearchFilters } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

type Facets = ResponseOf<Channels, 'search:facets'>;
type Runtime = Awaited<ReturnType<MainServices['runtime']['require']>>;

const round = (ms: number) => Math.round(ms * 10) / 10;

async function facetsOf(rt: Runtime, text: string, filters: SearchFilters | undefined): Promise<Facets> {
  const { labels, ...facets } = await rt.facets({ text, filters });
  return {
    ...facets,
    tags: facets.tags.map((b) => ({ ...b, label: labels.tags[b.value] })),
    types: facets.types.map((b) => ({ ...b, label: labels.types[b.value] })),
  };
}

/** Offline full-text search over the local index; the renderer only sees ids, relative paths and snippets. */
export const searchHandlers = (s: MainServices): DomainHandlers<'search'> => ({
  'search:query': async ({ text, filters, sort, limit, offset }) => {
    // The timer covers everything the request costs, from the runtime lookup to the shaped answer.
    const started = performance.now();
    const rt = await s.runtime.require();
    const page = await rt.search({ text, filters, sort, limit, offset });
    return { total: page.total, hits: page.hits, tookMs: round(performance.now() - started) };
  },
  'search:facets': async ({ text, filters }) => facetsOf(await s.runtime.require(), text, filters),
  // Hits and facets in one request: the text is matched once (the index reuses the evaluation for the facets).
  'search:run': async ({ text, filters, sort, limit, offset }) => {
    const started = performance.now();
    const rt = await s.runtime.require();
    const page = await rt.search({ text, filters, sort, limit, offset });
    const facets = await facetsOf(rt, text, filters);
    return { total: page.total, hits: page.hits, facets, tookMs: round(performance.now() - started) };
  },
});

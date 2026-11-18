import type { Channels, ResponseOf, SearchFilters } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

type Facets = ResponseOf<Channels, 'search:facets'>;
type Runtime = Awaited<ReturnType<MainServices['runtime']['require']>>;

/** A `topic` filter becomes the documents of that topic (the graph model's cluster), intersected with any `docIds`. */
export async function withTopic(s: MainServices, filters: SearchFilters | undefined): Promise<SearchFilters | undefined> {
  if (filters?.topic === undefined) return filters;
  const { topic, ...rest } = filters;
  const ids = (await (await import('../../graph/entity-run.js')).topicDocIds(s, topic));
  const only = rest.docIds ? new Set(rest.docIds) : null;
  return { ...rest, docIds: only ? ids.filter((i) => only.has(i)) : ids };
}

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
    const page = await rt.search({ text, filters: await withTopic(s, filters), sort, limit, offset });
    return { total: page.total, hits: page.hits, tookMs: round(performance.now() - started) };
  },
  'search:facets': async ({ text, filters }) => facetsOf(await s.runtime.require(), text, await withTopic(s, filters)),
  // Hits and facets in one request: the text is matched once (the index reuses the evaluation for the facets).
  'search:run': async ({ text, filters, sort, limit, offset }) => {
    const started = performance.now();
    const rt = await s.runtime.require();
    const scoped = await withTopic(s, filters);
    const page = await rt.search({ text, filters: scoped, sort, limit, offset });
    const facets = await facetsOf(rt, text, scoped);
    return { total: page.total, hits: page.hits, facets, tookMs: round(performance.now() - started) };
  },
});

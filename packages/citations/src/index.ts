export * from './metadata.js';
export * from './match.js';
export { createNet, type Net, type NetOptions } from './net.js';
export { createArxiv, createOpenAlex, createSemanticScholar, openAlexLink, type CitationSourceX, type LookupResult, type PublishedInfo, type SourceRef } from './sources.js';
export { createCitationService, createCitationSources, hasLookupKey, refOf, type CitationServiceX, type RefreshOptions } from './service.js';
export { createWatchFetcher, WATCH_HITS_MAX, type WatchHit, type WatchQuery, type WatchResult } from './watch.js';
export * from './ordering.js';

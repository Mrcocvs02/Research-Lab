import type { CitationService, CitationSource } from '@rl/core';

/** Owner: citations. OpenAlex (primary), arXiv and Semantic Scholar (fallbacks). */
export function createCitationSources(): CitationSource[] {
  throw new Error('not implemented');
}

export function createCitationService(_sources: CitationSource[]): CitationService {
  throw new Error('not implemented');
}

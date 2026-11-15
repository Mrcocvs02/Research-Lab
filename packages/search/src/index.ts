import type { SearchIndex } from '@rl/core';
import { SqliteSearchIndex } from './sqlite-index.js';

export { INDEX_SCHEMA_VERSION } from './schema.js';
export { parseQuery, normalizeText, type ParsedQuery, type TextFilters } from './query.js';

/** SQLite FTS5 index on `node:sqlite` (see D-007, D-050). One file per library, in the machine-local folder. */
export function createSearchIndex(): SearchIndex {
  return new SqliteSearchIndex();
}

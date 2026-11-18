import type { Scanner, TextExtractor } from '@rl/core';
import { createScannerImpl, type ScannerOptions } from './scanner.js';
import { createTextExtractorImpl, type TextExtractorOptions } from './extract/text-extractor.js';

export { readCachedText } from './extract/text-extractor.js';
export { overlapRatio, quoteOccurrences, locateQuote, repairQuotes, type GeometryOptions, type NormRect, type PageGeometry, type QuoteOutcome, type QuoteQuery } from './extract/pdf-geometry.js';
import { createLegacyImporterImpl, type LegacyImporterOptions, type LegacyImporterWithExtras } from './legacy-importer.js';

export { backupDataDir, copyDataDir } from './backup.js';
export { createLibraryStore, canonical, type ChangeContext, type FileLibraryStore, type LibraryStoreOptions, type LoadIssue } from './store.js';
export { createOrganizer, type Organizer, type OrganizerDeps, type OrganizerStore, type DocInfo } from './organize/organizer.js';
export { applyTaxonomyOps, expandTags, type OpsResult } from './organize/taxonomy-ops.js';
export { NameIndex, normalizeName, slugify } from './normalize.js';
export { withRetry, isTransientIoError, type RetryOptions } from './retry.js';
export { createWatcher, type LibraryWatcher, type WatchBatch, type WatcherOptions } from './watcher.js';
export { arxivYear, cleanDoi, findArxivIds, findDois } from './extract/identifiers.js';
export {
  PERMANENT_EXTRACT_REASONS,
  TRANSIENT_EXTRACT_REASONS,
  classifyExtractError,
  extractErrorReason,
  type ExtractFailureKind,
  type PermanentExtractReason,
  type TransientExtractReason,
} from './extract/errors.js';
export { toFsPath } from './fs-util.js';
export { diffTaxonomy } from './taxonomy-diff.js';
export { DEFAULT_IMPORT_LIMITS, type ImportLimits, type LegacyImporterOptions, type LegacyImporterWithExtras } from './legacy-importer.js';

/** Incremental, read-only walker of the library root; writes only through the store (D-040). */
export function createScanner(options?: ScannerOptions): Scanner {
  return createScannerImpl(options);
}

/** One-shot importer of the old index (read-only on the source). */
export function createLegacyImporter(options?: LegacyImporterOptions): LegacyImporterWithExtras {
  return createLegacyImporterImpl(options);
}

/** Offline text and metadata extraction (pdf.js, Office zips, text formats) with an optional cache outside the library. */
export function createTextExtractor(options?: TextExtractorOptions): TextExtractor {
  return createTextExtractorImpl(options);
}

export type { ScannerOptions, TextExtractorOptions };

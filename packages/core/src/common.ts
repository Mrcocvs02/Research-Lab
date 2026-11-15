import { z } from 'zod';
import { endsWithSpaceOrDot, isReservedWindowsName } from './fs-names.js';

/** Current on-disk schema version of every data file. Bump together with a migration. */
export const SCHEMA_VERSION = 1 as const;

export const schemaVersionSchema = z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION);

/** ISO-8601 timestamp (UTC or with offset). */
export const isoDateSchema = z.iso.datetime({ offset: true });
export type IsoDate = z.infer<typeof isoDateSchema>;

export const languageSchema = z.enum(['it', 'en']);
export type Language = z.infer<typeof languageSchema>;

/**
 * Document id: first 16 hex chars of the SHA-256 of the content at first
 * indexing. Stable afterwards, even if the file content changes (see D-006).
 */
export const documentIdSchema = z.string().regex(/^[0-9a-f]{16}$/, 'document id must be 16 lowercase hex chars');
export type DocumentId = z.infer<typeof documentIdSchema>;

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex chars');

/**
 * Generic item id (projects, taxonomy nodes, annotations, profiles): url-safe slug or uuid.
 * Ids become file names (`projects/<id>.json`), so they are normalised to lower case (on a
 * case-insensitive file system `Foo.json` and `foo.json` would overwrite each other) and
 * reserved Windows device names and a trailing dot are refused.
 */
export const itemIdSchema = z
  .string()
  .min(1)
  .max(128)
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'id must be url-safe')
  .refine((id) => !endsWithSpaceOrDot(id) && !isReservedWindowsName(id), 'id is not a valid file name');
export type ItemId = z.infer<typeof itemIdSchema>;

/**
 * Path relative to the library root, always with `/` separators, never absolute,
 * never containing `..`. The renderer only ever deals with this kind of path.
 * Real confinement (symlinks, case, UNC) is done in `@rl/core/node` (`resolveInRoot`).
 */
export const relativePathSchema = z
  .string()
  .max(1024)
  .refine((p) => !p.includes('\0'), 'NUL not allowed')
  .refine((p) => !p.includes('\\'), 'use / as separator')
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p), 'path must be relative')
  .refine((p) => !p.split('/').includes('..'), '.. not allowed');
export type RelativePath = z.infer<typeof relativePathSchema>;

/** Derive the stable document id from a content hash. */
export function documentIdFromHash(sha256: string): DocumentId {
  return documentIdSchema.parse(sha256.slice(0, 16).toLowerCase());
}

/** Fields that have no natural home when importing foreign data are kept here, verbatim. */
export const legacySchema = z.record(z.string(), z.unknown());
export type Legacy = z.infer<typeof legacySchema>;

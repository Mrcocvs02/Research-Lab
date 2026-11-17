import { z } from 'zod';
import { isoDateSchema, itemIdSchema, languageSchema, sha256Schema } from '../../common.js';
import { backupAutoSchema } from '../../settings.js';
import { defineChannels, defineEvents } from '../registry.js';

export const BACKUP_LIMITS = {
  /** File extension of a backup (a zip archive; the name is `<library>-<YYYYMMDD-HHMMSS>.rlbackup`). */
  extension: '.rlbackup',
  /** Files in one backup; a library with more is refused (CONFLICT `too-large`). */
  entries: 200_000,
  /** Largest `manifest.json` read (bytes). */
  manifestBytes: 48 * 1024 * 1024,
  /** Problems listed in a result (the count is exact, the list is cut). */
  problems: 200,
  /** Backups listed from the destination folder. */
  listed: 200,
} as const;

/** The format version this app reads and writes; a backup of a newer version is refused with CONFLICT `newer-format`. */
export const BACKUP_FORMAT_VERSION = 1 as const;

/**
 * Archive layout (zip, entries in this order; `manifest.json` is the LAST entry so a backup is written in one streaming
 * pass, and it is found through the zip central directory):
 * - `library/<path>`: every file of the library data folder (documents, notes, annotations, citations, projects,
 *   taxonomy, `library.json`, `CLAUDE.md`, `commands/`, `log/`). Never the original documents of the library root.
 * - `local/<path>`: only when `includeLocal`: the NON-rebuildable local data of that library (chat history, usage
 *   counters, reading state). Rebuildable data (search index, caches, vectors, thumbnails, the graph model) is never
 *   saved: it is rebuilt after a restore.
 * - `settings.json`: only the portable app settings (UI language, user profile, appearance, shortcuts, guide state).
 *   Never the library list (absolute paths), `deviceId`, the Claude Code executable path, backup settings or secrets.
 * - `manifest.json`: this schema.
 * Secrets (API keys, the MCP token) are NEVER in a backup, in clear or encrypted: after a restore the user enters them
 * again (the restore result says which are missing).
 */
export const backupEntrySchema = z.object({
  /** Path inside the archive, `/` separators, no `..`. */
  path: z.string().min(1).max(1024),
  size: z.number().int().nonnegative(),
  sha256: sha256Schema,
});

export const backupManifestSchema = z.object({
  format: z.literal('rl-backup'),
  formatVersion: z.number().int().positive(),
  createdAt: isoDateSchema,
  appVersion: z.string().max(40),
  /** Library the backup comes from (the restore creates a NEW profile with a new id). */
  sourceLibraryId: itemIdSchema,
  libraryName: z.string().max(120),
  language: languageSchema,
  dataDirName: z.string().max(64),
  documents: z.number().int().nonnegative(),
  includesLocal: z.boolean(),
  includesSettings: z.boolean(),
  /** `auto` when made by the schedule at start-up. */
  origin: z.enum(['manual', 'auto']),
  entries: z.array(backupEntrySchema).max(BACKUP_LIMITS.entries),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

/** What the lists and the inspection show about a backup file (read from the manifest only; fast). */
export const backupInfoSchema = z.object({
  /** Absolute path of the file (made by main; the file is remembered as approved for `backup:verify`/`restore`). */
  file: z.string(),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  appVersion: z.string(),
  libraryName: z.string(),
  language: languageSchema,
  documents: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  includesLocal: z.boolean(),
  includesSettings: z.boolean(),
  origin: z.enum(['manual', 'auto']),
  /** The version is newer than this app reads: shown, but verify/restore are refused. */
  newerFormat: z.boolean(),
});
export type BackupInfo = z.infer<typeof backupInfoSchema>;

export const backupSettingsSchema = z.object({
  destination: z.string().nullable(),
  auto: backupAutoSchema,
  keep: z.number().int().min(1).max(50),
  /** Last backup of the ACTIVE library found in the destination (manual or automatic). */
  lastBackupAt: isoDateSchema.nullable(),
  /** Why the last automatic backup did not run or failed (code only, e.g. `no-destination`, `IO_ERROR`). */
  lastAutoError: z.string().max(60).nullable(),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const backupPreviewSchema = z.object({
  /** Files and bytes (uncompressed) of the library data folder. */
  dataFiles: z.number().int().nonnegative(),
  dataBytes: z.number().int().nonnegative(),
  /** Non-rebuildable local data, counted only when `includeLocal`. */
  localFiles: z.number().int().nonnegative(),
  localBytes: z.number().int().nonnegative(),
  /** Free space of the destination (null when unknown or no destination). */
  freeBytes: z.number().int().nonnegative().nullable(),
});

export const backupProblemSchema = z.object({
  path: z.string().max(1024),
  reason: z.enum(['missing', 'size', 'hash', 'unreadable', 'unexpected']),
});

export const backupResultSchema = z.object({
  /** Backup file written (create) or checked / restored from (verify, restore). */
  file: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  /** Verify: files with a problem (exact count; the list is cut at `BACKUP_LIMITS.problems`). */
  problemCount: z.number().int().nonnegative(),
  problems: z.array(backupProblemSchema).max(BACKUP_LIMITS.problems),
  /** Restore only: the new library profile, and whether the portable settings were applied. */
  restoredLibraryId: itemIdSchema.nullable(),
  settingsRestored: z.boolean(),
  /** Restore only: secrets the AI or the MCP server will need again (the user enters them in the settings). */
  secretsToEnter: z.array(z.enum(['anthropic-api-key', 'openalex-api-key', 'mcp-token'])).max(10),
  /** Restore only (optional, additive): settings of the restored library that were switched to the safe value (D-295). */
  resetOnRestore: z.array(z.enum(['mcp', 'mcp-write', 'confirm-before-send'])).max(3).optional(),
  /** Create only (optional, additive): files that vanished while the backup ran (ENOENT) and are not in it. */
  skipped: z.number().int().nonnegative().optional(),
});

export const backupJobStatusSchema = z.object({
  jobId: z.string().max(100),
  kind: z.enum(['create', 'verify', 'restore']),
  state: z.enum(['running', 'done', 'cancelled', 'failed']),
  phase: z.enum(['collect', 'write', 'verify', 'extract', 'finish', 'done']),
  /** Bytes processed out of the bytes expected (0 while still collecting). */
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  result: backupResultSchema.nullable(),
  /** `reason` (optional, additive): the machine-readable cause (`integrity`, `not-empty`, `already-registered`, `newer-format`, `inside-library`, `too-large`, ...); the same token also opens `message` as `<reason>: ...`. */
  error: z.object({ code: z.string(), message: z.string(), reason: z.string().max(60).optional() }).nullable(),
});
export type BackupJobStatus = z.infer<typeof backupJobStatusSchema>;

const jobId = z.object({ jobId: z.string().max(100) });
const file = z.object({ file: z.string().min(1).max(1024) });

/**
 * Backup and restore (plan §8). One archive per library (`BACKUP_LIMITS.extension`, layout above), written to a folder
 * the user chose; the original documents are never read for it and never touched by a restore (rule 1). Writing: to a
 * temporary file next to the final one, then renamed (rule 2). Every entry has a SHA-256 in the manifest; `verify`
 * re-reads the whole archive and compares, `restore` verifies before it writes anything into the library.
 * Jobs follow the export pattern: start returns `jobId`, progress through `backup:progress`, `status` for a late
 * subscriber, `cancel` leaves no partial file (temporary files are removed).
 *
 * Paths: the destination comes from a main-process dialog (`backup:chooseDestination`, stored in the app settings, kept
 * across sessions); backup files come from `backup:list` (main approves them, D-017) or from `dialog:chooseFile`
 * (`backup-file`). A destination inside any library root, or inside a library data folder, is refused (CONFLICT
 * `inside-library`): a backup is never written where the scan or the sync would pick it up.
 */
export const backupChannels = defineChannels('backup', {
  settings: { request: z.object({}), response: backupSettingsSchema },
  /**
   * Folder dialog in main; saves the choice as `backup.destination` and returns the new settings (null: cancelled).
   * CONFLICT `inside-library` as above.
   */
  chooseDestination: { request: z.object({}), response: backupSettingsSchema.nullable() },
  /** Changes the schedule only (`auto`, `keep`) or forgets the destination; a destination cannot be set from here. */
  configure: {
    request: z.object({ auto: backupAutoSchema.optional(), keep: z.number().int().min(1).max(50).optional(), clearDestination: z.boolean().optional() }),
    response: backupSettingsSchema,
  },
  /** Counts and sizes of what a backup of the library would hold (default: the active library). */
  preview: { request: z.object({ libraryId: itemIdSchema.optional(), includeLocal: z.boolean().default(true) }), response: backupPreviewSchema },
  /**
   * Starts a backup into `backup.destination`. CONFLICT `no-destination`, `inside-library`, `too-large` (over
   * `BACKUP_LIMITS.entries`), `not-enough-space` (details: `needed`, `free`); NOT_FOUND when the library is gone.
   * With `auto` enabled the same job runs at app start when the last backup is older than the cadence (never in the
   * background afterwards), and old automatic backups beyond `keep` are removed (manual ones never).
   */
  create: { request: z.object({ libraryId: itemIdSchema.optional(), includeLocal: z.boolean().default(true) }), response: z.object({ jobId: z.string() }) },
  /** Backups of this app found in the destination (newest first), manifests only. */
  list: { request: z.object({}), response: z.object({ items: z.array(backupInfoSchema).max(BACKUP_LIMITS.listed) }) },
  /**
   * Reads the manifest of a file the user picked with `dialog:chooseFile` (`backup-file`). INVALID_REQUEST with reason
   * `not-a-backup` or `file-not-approved`; the file is remembered as approved.
   */
  inspect: { request: file, response: backupInfoSchema },
  /** Full integrity check (every entry re-read and hashed). CONFLICT `newer-format`. */
  verify: { request: file, response: z.object({ jobId: z.string() }) },
  /**
   * Restores a backup as a NEW library: `rootPath` is the folder of the documents on this computer (approved with
   * `dialog:chooseFolder`, purpose `library-root`); the data folder is created in it (`dataDirName` from the manifest)
   * and `local/` goes to the local app data of the new profile. Steps: verify the archive, extract to a temporary
   * folder, rename into place, register the profile (new id; the manifest's name unless `name` is given); the search
   * index is rebuilt as usual. Documents are never copied, moved or modified; an existing data folder is never
   * overwritten. CONFLICT: `integrity` (details: counts), `newer-format`, `not-empty` (the data folder exists and is
   * not empty), `already-registered` (a profile already uses this root and data folder). With `restoreSettings` the
   * portable settings of the backup replace the current ones (language, profile, appearance, shortcuts, guide).
   * Failure or cancel leaves no data folder and no profile.
   */
  restore: {
    request: z.object({
      file: z.string().min(1).max(1024),
      rootPath: z.string().min(1).max(1024),
      name: z.string().trim().min(1).max(120).optional(),
      restoreLocal: z.boolean().default(true),
      restoreSettings: z.boolean().default(false),
    }),
    response: z.object({ jobId: z.string() }),
  },
  status: { request: jobId, response: backupJobStatusSchema },
  cancel: { request: jobId, response: z.object({ cancelled: z.boolean() }) },
  /** Shows the backup file (of a finished job, or listed by `backup:list`) in the file manager. */
  reveal: { request: z.object({ jobId: z.string().max(100).optional(), file: z.string().max(1024).optional() }), response: z.object({ ok: z.literal(true) }) },
  /** Deletes ONE backup file listed by `backup:list` (never any other file). The renderer asks for confirmation first. */
  remove: { request: file, response: z.object({ ok: z.literal(true) }) },
});

export const backupEvents = defineEvents('backup', {
  progress: backupJobStatusSchema,
});

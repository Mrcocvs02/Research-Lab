import { z } from 'zod';
import { isoDateSchema, itemIdSchema, languageSchema, relativePathSchema, schemaVersionSchema } from './common.js';

/* ------------------------------------------------------------------ */
/* Shared AI configuration vocabulary                                  */
/* ------------------------------------------------------------------ */

export const aiProviderIdSchema = z.enum(['claude-agent-sdk', 'anthropic-api', 'gemini', 'mock']);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const reasoningLevelSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;

export const modelConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Optional price hints (USD per million tokens) used only for cost estimates. */
  inputPerMTok: z.number().nonnegative().optional(),
  outputPerMTok: z.number().nonnegative().optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
];

/* ------------------------------------------------------------------ */
/* Per-machine app settings (never synced, may contain absolute paths) */
/* ------------------------------------------------------------------ */

export const userProfileSchema = z.object({
  /** Display name of the user. */
  name: z.string().trim().default(''),
  /** Variants under which the user appears among authors (to recognise own papers). */
  authorVariants: z.array(z.string().trim().min(1)).default([]),
  email: z.union([z.literal(''), z.email()]).default(''),
  orcid: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, 'invalid ORCID')]).default(''),
  /** OpenAlex author id, e.g. "A1234567890". */
  openAlexId: z.union([z.literal(''), z.string().regex(/^A\d+$/, 'invalid OpenAlex author id')]).default(''),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const DEFAULT_DATA_DIR_NAME = '.lab';

/** Folder name only: no separators, no traversal, no reserved chars. */
export const dataDirNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\\/:*?"<>|\0]+$/, 'invalid folder name')
  .refine((n) => n !== '.' && n !== '..', 'invalid folder name');

export const libraryProfileSchema = z.object({
  id: itemIdSchema,
  name: z.string().trim().min(1).max(120),
  /** Absolute root of the library on THIS machine. Lives only in app settings, never in library.json. */
  rootPath: z.string().min(1),
  dataDirName: dataDirNameSchema.default(DEFAULT_DATA_DIR_NAME),
  createdAt: isoDateSchema,
});
export type LibraryProfile = z.infer<typeof libraryProfileSchema>;

export const appSettingsSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** Random id of this installation; used to name per-device log files. */
  deviceId: z.string().min(8).default(() => crypto.randomUUID()),
  uiLanguage: languageSchema.default('it'),
  user: userProfileSchema.prefault({}),
  libraries: z.array(libraryProfileSchema).default([]),
  activeLibraryId: itemIdSchema.nullable().default(null),
  /** True once the guided first run has been completed or skipped. */
  firstRunDone: z.boolean().default(false),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** Patchable subset exposed through IPC (`settings:set`). Libraries are managed via `library:*` channels. */
export const appSettingsPatchSchema = z.object({
  uiLanguage: languageSchema.optional(),
  user: userProfileSchema.partial().optional(),
  firstRunDone: z.boolean().optional(),
});
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

export function defaultAppSettings(): AppSettings {
  return appSettingsSchema.parse({});
}

/* ------------------------------------------------------------------ */
/* Per-library config: <dataDir>/library.json (synced; no secrets, no  */
/* absolute paths)                                                     */
/* ------------------------------------------------------------------ */

export const usageCapSchema = z.object({
  /** Monthly spending cap in USD; null means "no cap" (the confirmation flow still applies). */
  monthlyUsd: z.number().positive().nullable().default(null),
  /** Ask before every batch job, showing an estimate. */
  confirmBatchAboveUsd: z.number().nonnegative().default(0.5),
});

export const libraryAiConfigSchema = z.object({
  provider: aiProviderIdSchema.default('claude-agent-sdk'),
  models: z.array(modelConfigSchema).min(1).default(() => structuredClone(DEFAULT_MODELS)),
  defaultModel: z.string().min(1).default('claude-haiku-5-5'),
  defaultReasoning: reasoningLevelSchema.default('low'),
  usageCap: usageCapSchema.prefault({}),
  /** When true (default), every send to the AI needs an explicit confirmation with preview. */
  confirmBeforeSend: z.boolean().default(true),
});

export const exportPresetSchema = z.object({
  id: itemIdSchema,
  name: z.string().min(1),
  includeCited: z.boolean().default(false),
  citedDepth: z.number().int().min(0).max(3).default(1),
  sources: z.enum(['none', 'paths', 'copies']).default('paths'),
  includeNotes: z.boolean().default(true),
  includeAnnotations: z.boolean().default(true),
});
export type ExportPreset = z.infer<typeof exportPresetSchema>;

export const scanConfigSchema = z.object({
  extensions: z.array(z.string()).default(['pdf']),
  /** Extensions indexed by file name only (no text extraction). */
  nameOnlyExtensions: z.array(z.string()).default([]),
  /** Days after which records of deleted files are pruned. */
  pruneDeletedDays: z.number().int().nonnegative().default(30),
});

export const libraryConfigSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    name: z.string().trim().min(1).max(120).default('Library'),
    language: languageSchema.default('it'),
    /** Folders (relative to root) that are neither scanned nor indexed. */
    excludedFolders: z.array(relativePathSchema).default([]),
    /** Folders whose documents may be sent to the AI. Default: none. */
    aiEnabledFolders: z.array(relativePathSchema).default([]),
    ai: libraryAiConfigSchema.prefault({}),
    scan: scanConfigSchema.prefault({}),
    exportPresets: z.array(exportPresetSchema).default([]),
    mcp: z
      .object({
        enabled: z.boolean().default(false),
        writeEnabled: z.boolean().default(false),
      })
      .prefault({}),
  })
  .refine((c) => c.ai.models.some((m) => m.id === c.ai.defaultModel), {
    message: 'defaultModel must be one of ai.models',
    path: ['ai', 'defaultModel'],
  });
export type LibraryConfig = z.infer<typeof libraryConfigSchema>;

export function defaultLibraryConfig(overrides: { name?: string; language?: 'it' | 'en' } = {}): LibraryConfig {
  return libraryConfigSchema.parse(overrides);
}

/** Editable subset of library.json exposed through IPC. */
export const libraryConfigPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: languageSchema.optional(),
  excludedFolders: z.array(relativePathSchema).optional(),
  aiEnabledFolders: z.array(relativePathSchema).optional(),
  ai: libraryAiConfigSchema.partial().optional(),
  scan: scanConfigSchema.partial().optional(),
  exportPresets: z.array(exportPresetSchema).optional(),
  mcp: z.object({ enabled: z.boolean(), writeEnabled: z.boolean() }).partial().optional(),
});
export type LibraryConfigPatch = z.infer<typeof libraryConfigPatchSchema>;

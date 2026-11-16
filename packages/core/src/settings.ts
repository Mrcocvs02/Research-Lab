import { z } from 'zod';
import { isoDateSchema, itemIdSchema, languageSchema, relativePathSchema, schemaVersionSchema } from './common.js';
import { endsWithSpaceOrDot, isReservedWindowsName } from './fs-names.js';

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

/**
 * Haiku for tags, descriptions and bulk commands, Sonnet for complex questions, Opus as the strongest option (plan §5).
 * Prices are hints for the estimates only (USD per million tokens, first-party API, 2026-11).
 */
export const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', inputPerMTok: 0.1, outputPerMTok: 0.5 },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', inputPerMTok: 2, outputPerMTok: 10 },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', inputPerMTok: 4, outputPerMTok: 20 },
];

/* ------------------------------------------------------------------ */
/* Per-machine app settings (never synced, may contain absolute paths) */
/* ------------------------------------------------------------------ */

// Field validators are shared by the full schemas (with defaults) and the patch schemas (without
// any default): a patch must never re-apply a default to a field it does not mention. In zod 4
// `.partial()` keeps inner `.default()`s, which is why patches are declared explicitly.
const userFields = {
  /** Display name of the user. */
  name: z.string().trim(),
  /** Variants under which the user appears among authors (to recognise own papers). */
  authorVariants: z.array(z.string().trim().min(1)),
  email: z.union([z.literal(''), z.email()]),
  orcid: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, 'invalid ORCID')]),
  /** OpenAlex author id, e.g. "A1234567890". */
  openAlexId: z.union([z.literal(''), z.string().regex(/^A\d+$/, 'invalid OpenAlex author id')]),
};

export const userProfileSchema = z.object({
  name: userFields.name.default(''),
  authorVariants: userFields.authorVariants.default([]),
  email: userFields.email.default(''),
  orcid: userFields.orcid.default(''),
  openAlexId: userFields.openAlexId.default(''),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const userProfilePatchSchema = z.object({
  name: userFields.name.optional(),
  authorVariants: userFields.authorVariants.optional(),
  email: userFields.email.optional(),
  orcid: userFields.orcid.optional(),
  openAlexId: userFields.openAlexId.optional(),
});

export const DEFAULT_DATA_DIR_NAME = '.lab';

/**
 * Folder name only: no separators, no traversal, no reserved chars, no Windows device names
 * and no trailing space or dot (Windows strips them, so the folder would not be where we think).
 */
export const dataDirNameSchema = z
  .string()
  .min(1)
  .max(64)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/, 'invalid folder name')
  .refine((n) => n !== '.' && n !== '..', 'invalid folder name')
  .refine((n) => !isReservedWindowsName(n) && !endsWithSpaceOrDot(n), 'invalid folder name');

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

/**
 * Patchable subset exposed through IPC (`settings:set`). Libraries are managed via `library:*`
 * channels. Only the fields present are applied (see `applyPatch`).
 */
export const appSettingsPatchSchema = z.object({
  uiLanguage: languageSchema.optional(),
  user: userProfilePatchSchema.optional(),
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

const usageCapFields = {
  /** Monthly spending cap in USD; null means "no cap" (the confirmation flow still applies). */
  monthlyUsd: z.number().positive().nullable(),
  /** Ask before every batch job, showing an estimate. */
  confirmBatchAboveUsd: z.number().nonnegative(),
};
export const usageCapSchema = z.object({
  monthlyUsd: usageCapFields.monthlyUsd.default(null),
  confirmBatchAboveUsd: usageCapFields.confirmBatchAboveUsd.default(0.5),
});
export const usageCapPatchSchema = z.object({
  monthlyUsd: usageCapFields.monthlyUsd.optional(),
  confirmBatchAboveUsd: usageCapFields.confirmBatchAboveUsd.optional(),
});

const aiFields = {
  provider: aiProviderIdSchema,
  models: z.array(modelConfigSchema).min(1),
  defaultModel: z.string().min(1),
  defaultReasoning: reasoningLevelSchema,
  /** When true (default), every send to the AI needs an explicit confirmation with preview. */
  confirmBeforeSend: z.boolean(),
};
export const libraryAiConfigSchema = z.object({
  provider: aiFields.provider.default('claude-agent-sdk'),
  models: aiFields.models.default(() => structuredClone(DEFAULT_MODELS)),
  defaultModel: aiFields.defaultModel.default('claude-haiku-5-5'),
  defaultReasoning: aiFields.defaultReasoning.default('low'),
  usageCap: usageCapSchema.prefault({}),
  confirmBeforeSend: aiFields.confirmBeforeSend.default(true),
});
export const libraryAiPatchSchema = z.object({
  provider: aiFields.provider.optional(),
  models: aiFields.models.optional(),
  defaultModel: aiFields.defaultModel.optional(),
  defaultReasoning: aiFields.defaultReasoning.optional(),
  usageCap: usageCapPatchSchema.optional(),
  confirmBeforeSend: aiFields.confirmBeforeSend.optional(),
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

const scanFields = {
  extensions: z.array(z.string()),
  /** Extensions indexed by file name only (no text extraction). */
  nameOnlyExtensions: z.array(z.string()),
  /** Days after which records of deleted files are pruned. */
  pruneDeletedDays: z.number().int().nonnegative(),
};
export const scanConfigSchema = z.object({
  // Text-bearing research formats the extractor understands; code and data files are opt-in (D-055).
  extensions: scanFields.extensions.default(['pdf', 'md', 'txt', 'tex', 'rst', 'docx', 'pptx', 'ipynb']),
  nameOnlyExtensions: scanFields.nameOnlyExtensions.default([]),
  pruneDeletedDays: scanFields.pruneDeletedDays.default(30),
});
export const scanConfigPatchSchema = z.object({
  extensions: scanFields.extensions.optional(),
  nameOnlyExtensions: scanFields.nameOnlyExtensions.optional(),
  pruneDeletedDays: scanFields.pruneDeletedDays.optional(),
});

const mcpFields = { enabled: z.boolean(), writeEnabled: z.boolean() };

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
        enabled: mcpFields.enabled.default(false),
        writeEnabled: mcpFields.writeEnabled.default(false),
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

/**
 * Editable subset of library.json exposed through IPC. Every field is optional and NONE has a
 * default: only what is present is applied (see `applyPatch`); arrays replace the old value.
 */
export const libraryConfigPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: languageSchema.optional(),
  excludedFolders: z.array(relativePathSchema).optional(),
  aiEnabledFolders: z.array(relativePathSchema).optional(),
  ai: libraryAiPatchSchema.optional(),
  scan: scanConfigPatchSchema.optional(),
  exportPresets: z.array(exportPresetSchema).optional(),
  mcp: z.object({ enabled: mcpFields.enabled.optional(), writeEnabled: mcpFields.writeEnabled.optional() }).optional(),
});
export type LibraryConfigPatch = z.infer<typeof libraryConfigPatchSchema>;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Deep merge of a patch into a value: plain objects are merged key by key, only for the keys the
 * patch actually has (`undefined` means "not sent"); arrays and primitives (including `null`)
 * replace the old value as a whole. Returns a new value; the inputs are not modified.
 */
export function applyPatch<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? applyPatch(out[k], v) : v;
  }
  return out as T;
}

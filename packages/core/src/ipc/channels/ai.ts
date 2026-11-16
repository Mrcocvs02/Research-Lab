import { z } from 'zod';
import { documentIdSchema, isoDateSchema, relativePathSchema } from '../../common.js';
import { AI_LIMITS } from '../../limits.js';
import { aiProviderIdSchema } from '../../settings.js';
import { defineChannels } from '../registry.js';

/** How the provider reaches Claude: the user's Claude Code login, an API key in the OS secure store, or nothing. */
export const aiAuthSchema = z.enum(['claude-code', 'api-key', 'none']);

export const aiStatusSchema = z.object({
  provider: aiProviderIdSchema,
  /** The provider can be used now (access configured and reachable). */
  available: z.boolean(),
  auth: aiAuthSchema,
  /** Why it is not available, for a clear message; absent when available. */
  reason: z.enum(['no-access', 'offline', 'cap-reached', 'error']).optional(),
  /**
   * Folders whose documents may be sent (library config); empty means nothing can be sent. A folder enables its
   * sub-folders; '' enables the whole library; '.' enables only the files directly in the root of the library.
   */
  enabledFolders: z.array(relativePathSchema),
  /** Spent this calendar month (from the local AI-send log) and the monthly cap of the library (null: none). */
  monthUsd: z.number().nonnegative(),
  capUsd: z.number().positive().nullable(),
  /**
   * The Claude Code executable the Agent SDK provider runs (absent for other providers): where it was found
   * ('settings': chosen by the user; 'path': on PATH; 'local-bin': the user's local bin folder; 'sdk': the copy bundled
   * with the SDK; 'none': not found) and its absolute path. A path of this machine: shown, never synced.
   */
  claudeCode: z
    .object({ path: z.string().nullable(), source: z.enum(['settings', 'path', 'local-bin', 'sdk', 'none']) })
    .optional(),
});

/** What a send would include, before it happens (plan §5, privacy): shown to the user, who confirms. */
export const aiPreviewSchema = z.object({
  model: z.string(),
  /** Documents whose content may go (in enabled folders, present). */
  allowed: z.array(documentIdSchema),
  /** Documents that will NOT go, and why. */
  refused: z.array(z.object({ docId: documentIdSchema, reason: z.enum(['folder-not-enabled', 'missing', 'unknown']) })),
  /** Folders the allowed documents are in. */
  folders: z.array(relativePathSchema),
  approxInputTokens: z.number().int().nonnegative(),
  /** Null when the model has no price hint. */
  estimatedUsd: z.number().nonnegative().nullable(),
  /** The library asks for a confirmation before this send (`ai.confirmBeforeSend`, or a bulk job above `usageCap.confirmBatchAboveUsd`). */
  needsConfirmation: z.boolean(),
  /** The send would go over the monthly cap: it will be refused. */
  overCap: z.boolean(),
});

export const aiSendViewSchema = z.object({
  at: isoDateSchema,
  provider: aiProviderIdSchema,
  model: z.string(),
  purpose: z.string(),
  docIds: z.array(documentIdSchema),
  folders: z.array(relativePathSchema),
  approxInputTokens: z.number().int().nonnegative(),
  approxOutputTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  confirmed: z.boolean(),
});

export const aiChannels = defineChannels('ai', {
  /** State of the AI for the active library. Never returns a credential. */
  status: { request: z.object({}), response: aiStatusSchema },
  /**
   * What a send would include: `purpose` names the use ('chat', or a command id), `docIds` the documents whose content
   * would go, `promptChars` the size of the rest. Only documents in `aiEnabledFolders` are allowed (D-202).
   */
  preview: {
    request: z.object({
      purpose: z.string().min(1).max(100),
      model: z.string().min(1).max(100),
      docIds: z.array(documentIdSchema).max(AI_LIMITS.jobDocs).default([]),
      promptChars: z.number().int().nonnegative().max(10_000_000).default(0),
    }),
    response: aiPreviewSchema,
  },
  /** Spending of the active library in a month (`YYYY-MM`, default: this month), from the local AI-send log. */
  usage: {
    request: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
    response: z.object({
      month: z.string(),
      usd: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      sends: z.number().int().nonnegative(),
      byModel: z.array(z.object({ model: z.string(), usd: z.number().nonnegative(), sends: z.number().int().nonnegative() })),
    }),
  },
  /** The AI-send log of the active library, newest first (what went, to which model, when): consultable by the user. */
  log: {
    request: z.object({ limit: z.number().int().min(1).max(500).default(100), before: isoDateSchema.optional() }),
    response: z.object({ items: z.array(aiSendViewSchema) }),
  },
  /**
   * Lets the user choose the Claude Code executable with a file dialog shown by main (the renderer never passes a
   * path: it cannot make main run a program of its choice). Saved in the app settings of this machine
   * (`ai.claudeCodePath`). Null when the dialog was cancelled; INVALID_REQUEST when the file is not a regular file.
   */
  chooseExecutable: { request: z.object({}), response: z.object({ path: z.string().nullable() }) },
  /** Forgets the chosen executable: back to automatic discovery. */
  clearExecutable: { request: z.object({}), response: z.object({ ok: z.literal(true) }) },
});

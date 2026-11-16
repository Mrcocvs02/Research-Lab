import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { AI_LIMITS, STUDY_LIMITS } from '../../limits.js';
import { reasoningLevelSchema } from '../../settings.js';
import { defineChannels, defineEvents } from '../registry.js';

/**
 * An action of the agent, shown as a card (plan §5): a library search, a document opened, a field written...
 * `name` is the tool name; `summary` a short readable line written by main (never raw tool output).
 */
export const chatCardSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(100),
  status: z.enum(['running', 'done', 'failed']),
  summary: z.string().max(500),
  /** Documents the action touched, for links. */
  docIds: z.array(documentIdSchema).max(50).default([]),
});

export const chatUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Null when no price is known. */
  usd: z.number().nonnegative().nullable(),
});

export const chatTurnSchema = z.object({
  id: z.string().max(100),
  role: z.enum(['user', 'assistant']),
  /**
   * Markdown. Links to the library are `lab://doc/<id>?page=N`, `lab://note/<id>`, `lab://project/<id>`; the UI shows
   * them as chips and never follows any other scheme.
   */
  text: z.string(),
  at: isoDateSchema,
  model: z.string().optional(),
  reasoning: reasoningLevelSchema.optional(),
  cards: z.array(chatCardSchema).default([]),
  /** Documents given as context with a user turn (the selection). */
  contextDocIds: z.array(documentIdSchema).default([]),
  usage: chatUsageSchema.optional(),
  /** The turn ended with an error or was cancelled. */
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const chatConversationSummarySchema = z.object({
  id: itemIdSchema,
  title: z.string().max(AI_LIMITS.title),
  updatedAt: isoDateSchema,
  turns: z.number().int().nonnegative(),
});

/**
 * Chat with Claude in the side panel (plan §5): one history per library, kept in the local app data (not synced, never
 * in the data folder). The agent has only the library tools (no shell, no free network, no file tools); it reads only
 * documents in `aiEnabledFolders` and writes only AI fields marked as generated. Each send is logged (`ai:log`).
 */
export const chatChannels = defineChannels('chat', {
  /**
   * Starts a turn: answers at once with the ids, then streams `chat:event`s. `confirmed` is required (CONFLICT with
   * `details.reason` 'needs-confirmation' otherwise) when the library asks for confirmation and document content goes
   * with the turn (`contextDocIds`). Refused with AI_BUDGET_EXCEEDED over the monthly cap, and with AI_PROVIDER_ERROR
   * (`details.reason` 'no-access' or 'offline') when Claude cannot be reached.
   */
  send: {
    request: z.object({
      conversationId: itemIdSchema.optional(),
      text: z.string().trim().min(1).max(AI_LIMITS.message),
      model: z.string().min(1).max(100),
      reasoning: reasoningLevelSchema,
      contextDocIds: z.array(documentIdSchema).max(AI_LIMITS.contextDocs).default([]),
      /** Page the user is reading, when the chat is opened from the reader. */
      contextPage: z.number().int().positive().max(STUDY_LIMITS.pageMax).optional(),
      confirmed: z.boolean().default(false),
    }),
    response: z.object({ conversationId: itemIdSchema, turnId: z.string() }),
  },
  /** Stops a running turn; what was streamed so far is kept, marked as cancelled. */
  cancel: { request: z.object({ turnId: z.string().max(100) }), response: z.object({ cancelled: z.boolean() }) },
  list: {
    request: z.object({ limit: z.number().int().min(1).max(AI_LIMITS.conversations).default(100) }),
    response: z.object({ items: z.array(chatConversationSummarySchema) }),
  },
  get: {
    request: z.object({ conversationId: itemIdSchema }),
    response: z.object({ id: itemIdSchema, title: z.string(), turns: z.array(chatTurnSchema) }),
  },
  /** Removes a conversation from the local history (the AI-send log keeps its records). */
  delete: { request: z.object({ conversationId: itemIdSchema }), response: z.object({ deleted: z.boolean() }) },
});

/** Streamed parts of a running turn. `done` and `error` end it. */
export const chatEvents = defineEvents('chat', {
  event: z.object({
    conversationId: itemIdSchema,
    turnId: z.string(),
    event: z.discriminatedUnion('type', [
      z.object({ type: z.literal('text-delta'), text: z.string() }),
      z.object({ type: z.literal('card'), card: chatCardSchema }),
      z.object({ type: z.literal('usage'), usage: chatUsageSchema }),
      z.object({ type: z.literal('done') }),
      z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
    ]),
  }),
});

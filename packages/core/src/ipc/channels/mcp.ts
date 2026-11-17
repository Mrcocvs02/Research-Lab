import { z } from 'zod';
import { documentIdSchema, isoDateSchema } from '../../common.js';
import { defineChannels, defineEvents } from '../registry.js';

export const MCP_LIMITS = {
  /** Calls kept in the local log (oldest dropped first). */
  logKept: 500,
  /** Largest request body accepted by the server. */
  bodyBytes: 1_048_576,
  /** Requests handled at the same time (more get HTTP 429) and messages run at the same time, batches included. */
  concurrent: 4,
  /** Most messages of one JSON-RPC batch; a larger batch is refused with an error, never cut. */
  batchMax: 20,
} as const;

/**
 * Tools the local MCP server exposes to Claude Code (plan §6). All read only except `write_ai_field`, listed only when
 * writing is enabled. Same folder rules as the in-app agent: only documents of AI-enabled folders exist for the
 * server (excluded folders never), page text only through `read_pages` within its limits, the user's notes read only.
 */
export const MCP_TOOL_NAMES = [
  'search_library',
  'get_document',
  'read_pages',
  'list_notes',
  'read_note',
  'list_highlights',
  'similar_documents',
  'citations',
  'list_projects',
  'get_project',
  'read_next',
  'write_ai_field',
] as const;
export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES);

export const mcpStatusSchema = z.object({
  /** Library setting (`library.json` `mcp.enabled`): the server runs while this library is open in the app. */
  enabled: z.boolean(),
  writeEnabled: z.boolean(),
  running: z.boolean(),
  /** Loopback port of this computer (remembered locally, not synced); null until first started. */
  port: z.number().int().min(1024).max(65535).nullable(),
  /** `http://127.0.0.1:<port>/mcp` while running. */
  url: z.string().nullable(),
  /** Why the server is not running although enabled (e.g. `PORT_IN_USE`). */
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  tools: z.array(mcpToolNameSchema),
  calls: z.number().int().nonnegative(),
  lastCallAt: isoDateSchema.nullable(),
});
export type McpStatus = z.infer<typeof mcpStatusSchema>;

export const mcpLogItemSchema = z.object({
  at: isoDateSchema,
  tool: z.string().max(100),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  /** Error code of a failed call (no message from the request, no document text). */
  code: z.string().max(60).nullable(),
  /** Documents the call returned or touched. */
  docIds: z.array(documentIdSchema).max(50),
});

/**
 * Local MCP server for Claude Code (plan §6): Streamable HTTP on 127.0.0.1 only, one per open library, started only
 * when enabled. Every request needs `Authorization: Bearer <token>` (random, kept in the OS secure store, compared in
 * constant time); requests with an `Origin` header or a `Host` that is not the loopback address and port are refused
 * (DNS rebinding). Read only by default; with writing enabled Claude Code may only PROPOSE AI fields (reviewed by the
 * user like any AI output), never the user's notes or own fields. Calls are logged locally (tool, outcome, documents),
 * never their content. The token never crosses IPC: the main process writes the configuration line to the clipboard.
 */
export const mcpChannels = defineChannels('mcp', {
  status: { request: z.object({}), response: mcpStatusSchema },
  /** Saves `mcp.enabled` for the library and starts or stops the server. A port in use leaves it enabled with `error`. */
  setEnabled: { request: z.object({ enabled: z.boolean() }), response: mcpStatusSchema },
  /** Saves `mcp.writeEnabled`; the tool list changes for the next `tools/list` of the client. */
  setWriteEnabled: { request: z.object({ writeEnabled: z.boolean() }), response: mcpStatusSchema },
  /** Port of this computer (null: pick a free one and remember it); restarts a running server. */
  setPort: { request: z.object({ port: z.number().int().min(1024).max(65535).nullable() }), response: mcpStatusSchema },
  /**
   * Puts the configuration for Claude Code on the clipboard (`cli`: a `claude mcp add --transport http …` command;
   * `json`: an `.mcp.json` entry) and returns the same text with the token masked. CONFLICT `not-running` when the server is not
   * running.
   */
  copyConfig: { request: z.object({ format: z.enum(['cli', 'json']) }), response: z.object({ preview: z.string() }) },
  /** New token; the old one stops working at once (a running server keeps running with the new one). */
  rotateToken: { request: z.object({}), response: mcpStatusSchema },
  log: {
    request: z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().nonnegative().default(0) }),
    response: z.object({ items: z.array(mcpLogItemSchema), total: z.number().int().nonnegative() }),
  },
});

export const mcpEvents = defineEvents('mcp', {
  /** Server started, stopped, failed, or calls counted (at most once every 2 s). */
  changed: mcpStatusSchema,
});

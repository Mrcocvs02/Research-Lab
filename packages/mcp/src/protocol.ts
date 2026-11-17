import { AppError } from '@rl/core';
import { z } from 'zod';

/** Newest protocol revision this server speaks; the others are accepted when the client asks for them. */
export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [LATEST_PROTOCOL_VERSION, '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

export type RpcId = string | number | null;
export interface RpcResponse {
  jsonrpc: '2.0';
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const rpcError = (id: RpcId, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

/** What a tool returns to the protocol layer: `text` is the JSON the client reads, `docIds` go to the call log only. */
export interface ToolOutcome {
  text: string;
  docIds: string[];
}

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  inputSchema: Record<string, unknown>;
  /** False for tools that write (listed only when writing is enabled, by the caller). */
  readOnly: boolean;
  run(args: unknown, ctx: { signal?: AbortSignal | undefined }): Promise<ToolOutcome>;
}

/** What the log keeps of a call: never arguments, never content. */
export interface CallRecord {
  tool: string;
  ok: boolean;
  ms: number;
  code: string | null;
  docIds: string[];
}

export interface RpcContext {
  serverName: string;
  serverVersion: string;
  /** Shown to the client at initialize; carries the rules for reading what the tools return. */
  instructions: string;
  tools(): McpTool[] | Promise<McpTool[]>;
  onCall?(rec: CallRecord): void;
  now?(): number;
  signal?: AbortSignal | undefined;
}

const requestSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string().max(200), params: z.unknown().optional() });
const initParams = z.object({ protocolVersion: z.string().max(40) }).loose();
const callParams = z.object({ name: z.string().max(100), arguments: z.record(z.string(), z.unknown()).optional() });

/** A tool failure as the client sees it: a code and a short message, never a stack or an argument value. */
function failure(e: unknown): { code: string; message: string } {
  if (e instanceof z.ZodError) return { code: 'INVALID_REQUEST', message: `Invalid arguments: ${[...new Set(e.issues.map((i) => i.path.join('.') || 'input'))].slice(0, 8).join(', ')}` };
  if (e instanceof AppError) return { code: e.code, message: e.message };
  return { code: 'INTERNAL', message: 'The tool failed' };
}

/**
 * One JSON-RPC message of the MCP protocol (stateless: nothing is kept between requests). Returns the response, or null
 * for a notification. Tool failures come back as `isError` results (the model sees them); protocol faults as RPC errors.
 */
export async function handleRpc(message: unknown, ctx: RpcContext): Promise<RpcResponse | null> {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) return rpcError(null, RPC.invalidRequest, 'Invalid request');
  const { id, method, params } = parsed.data;
  if (id === undefined) return null; // notification (initialized, cancelled, ...): nothing to answer
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });

  switch (method) {
    case 'initialize': {
      const p = initParams.safeParse(params);
      if (!p.success) return rpcError(id, RPC.invalidParams, 'initialize needs protocolVersion');
      const wanted = p.data.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(wanted) ? wanted : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: ctx.serverName, version: ctx.serverVersion },
        instructions: ctx.instructions,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list': {
      const tools = await ctx.tools();
      return ok({
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly, openWorldHint: false, ...(t.readOnly ? {} : { destructiveHint: false }) } })),
      });
    }
    case 'tools/call': {
      const p = callParams.safeParse(params);
      if (!p.success) return rpcError(id, RPC.invalidParams, 'tools/call needs a tool name and object arguments');
      const tool = (await ctx.tools()).find((t) => t.name === p.data.name);
      if (!tool) return rpcError(id, RPC.invalidParams, 'Unknown tool');
      const now = ctx.now ?? Date.now;
      const t0 = now();
      try {
        const out = await tool.run(p.data.arguments ?? {}, { signal: ctx.signal });
        ctx.onCall?.({ tool: tool.name, ok: true, ms: Math.max(0, Math.round(now() - t0)), code: null, docIds: out.docIds.slice(0, 50) });
        return ok({ content: [{ type: 'text', text: out.text }] });
      } catch (e) {
        const f = failure(e);
        ctx.onCall?.({ tool: tool.name, ok: false, ms: Math.max(0, Math.round(now() - t0)), code: f.code, docIds: [] });
        return ok({ isError: true, content: [{ type: 'text', text: JSON.stringify(f) }] });
      }
    }
    default:
      return rpcError(id, RPC.methodNotFound, 'Method not found');
  }
}

/** Builds an `McpTool` from a tool of the in-app agent (`ToolSpec` shape): same input schema, same gate, same result shape. */
export function toMcpTool(spec: { name: string; description: string; input: z.ZodType; writes: boolean; run(input: unknown, ctx: { signal?: AbortSignal }): Promise<unknown> }): McpTool {
  const { $schema: _s, ...schema } = z.toJSONSchema(spec.input) as Record<string, unknown>;
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: schema,
    readOnly: !spec.writes,
    async run(args, ctx) {
      const r = (await spec.run(args, ctx.signal ? { signal: ctx.signal } : {})) as { data?: unknown; docIds?: unknown };
      const docIds = Array.isArray(r.docIds) ? r.docIds.filter((d): d is string => typeof d === 'string') : [];
      return { text: JSON.stringify(r.data ?? null), docIds };
    },
  };
}

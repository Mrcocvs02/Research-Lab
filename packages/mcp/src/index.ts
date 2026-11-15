import type { LibraryStore, McpServerService } from '@rl/core';

/** Owner: export-mcp. Local MCP server (loopback only, token, read-only by default). */
export function createMcpServerService(_store: LibraryStore): McpServerService {
  throw new Error('not implemented');
}

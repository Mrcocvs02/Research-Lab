/** Phase 7: local MCP server for Claude Code (D-242). Contract in `packages/core/src/ipc/channels/mcp.ts`; the logic lives in `main/mcp/`. */
import { copyConfig, mcpLog, mcpStatus, rotateToken, setEnabled, setPort, setWriteEnabled } from '../../mcp/service.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const mcpHandlers = (s: MainServices): DomainHandlers<'mcp'> => ({
  'mcp:status': () => mcpStatus(s),
  'mcp:setEnabled': ({ enabled }) => setEnabled(s, enabled),
  'mcp:setWriteEnabled': ({ writeEnabled }) => setWriteEnabled(s, writeEnabled),
  'mcp:setPort': ({ port }) => setPort(s, port),
  'mcp:copyConfig': ({ format }) => copyConfig(s, format),
  'mcp:rotateToken': () => rotateToken(s),
  'mcp:log': ({ limit, offset }) => mcpLog(s, limit, offset),
});

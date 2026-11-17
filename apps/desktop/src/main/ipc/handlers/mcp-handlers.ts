/** Phase 7: contract in `packages/core/src/ipc/channels/mcp.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const mcpHandlers = (_s: MainServices): DomainHandlers<'mcp'> => ({
  'mcp:status': todo,
  'mcp:setEnabled': todo,
  'mcp:setWriteEnabled': todo,
  'mcp:setPort': todo,
  'mcp:copyConfig': todo,
  'mcp:rotateToken': todo,
  'mcp:log': todo,
});

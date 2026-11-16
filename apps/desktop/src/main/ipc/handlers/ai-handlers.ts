/**
 * Phase 4 (AI): status, preview, usage and log of the AI layer, the chat with Claude, the user's commands.
 * Contracts: `packages/core/src/ipc/channels/{ai,chat,commands}.ts`. NOT_IMPLEMENTED until built.
 */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const notYet = (channel: string) => () => {
  throw new AppError('NOT_IMPLEMENTED', `${channel} is not implemented yet`);
};

export const aiHandlers = (_s: MainServices): DomainHandlers<'ai'> => ({
  'ai:status': notYet('ai:status'),
  'ai:preview': notYet('ai:preview'),
  'ai:usage': notYet('ai:usage'),
  'ai:log': notYet('ai:log'),
});

export const chatHandlers = (_s: MainServices): DomainHandlers<'chat'> => ({
  'chat:send': notYet('chat:send'),
  'chat:cancel': notYet('chat:cancel'),
  'chat:list': notYet('chat:list'),
  'chat:get': notYet('chat:get'),
  'chat:delete': notYet('chat:delete'),
});

export const commandsHandlers = (_s: MainServices): DomainHandlers<'commands'> => ({
  'commands:list': notYet('commands:list'),
});

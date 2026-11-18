/**
 * Phase 4 (AI): status, preview, usage and log of the AI layer, the chat with Claude, the user's commands (D-204..).
 * Contracts: `packages/core/src/ipc/channels/{ai,chat,commands}.ts`. The logic lives in `main/ai/`.
 */
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@rl/core';
import { ChatStore } from '../../ai/chat-store.js';
import { listUserCommands } from '../../ai/guide-files.js';
import { abortAllChatTurns, cancelTurn, computePreview, computeStatus, discardConversationTurns, loadCtx, monthUsage, startChatTurn } from '../../ai/service.js';
import { aiSends, monthOf } from '../../ai/usage.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export { abortAllChatTurns };

/** TODO(B1): contract stubs of the Claude account channels (§10.3-§10.4, D-431); B1 replaces them with `main/ai/account.ts` and `usage-all.ts`. */
const notYet = (channel: string) => (): never => {
  throw new AppError('NOT_IMPLEMENTED', `${channel} is not implemented yet`);
};

export const aiHandlers = (s: MainServices): DomainHandlers<'ai'> => ({
  'ai:status': () => computeStatus(s),
  'ai:account': notYet('ai:account'),
  'ai:setAuthMode': notYet('ai:setAuthMode'),
  'ai:login': notYet('ai:login'),
  'ai:loginDone': notYet('ai:loginDone'),
  'ai:logout': notYet('ai:logout'),
  'ai:test': notYet('ai:test'),
  'ai:usageAll': notYet('ai:usageAll'),
  'ai:chooseExecutable': async () => {
    // Only a dialog shown by main can name the program: the renderer never passes a path.
    const picked = await s.pickExecutable?.();
    if (!picked) return { path: null };
    if (!path.isAbsolute(picked)) throw new AppError('INVALID_REQUEST', 'The chosen file is not an absolute path');
    const real = await realpath(picked).catch(() => null);
    const st = real ? await stat(real).catch(() => null) : null;
    if (!real || !st?.isFile()) throw new AppError('INVALID_REQUEST', 'The chosen path is not a regular file');
    await s.settings.update((cur) => {
      cur.ai.claudeCodePath = real;
    });
    return { path: real };
  },
  'ai:clearExecutable': async () => {
    await s.settings.update((cur) => {
      cur.ai.claudeCodePath = null;
    });
    return { ok: true as const };
  },
  'ai:preview': async ({ purpose, model, docIds, promptChars }) => {
    const ctx = await loadCtx(s);
    return (await computePreview(s, ctx, { purpose, model, docIds, promptChars })).preview;
  },
  'ai:usage': async ({ month }) => {
    const rt = await s.runtime.require();
    return monthUsage(rt, month ?? monthOf(new Date()));
  },
  'ai:log': async ({ limit, before }) => {
    const rt = await s.runtime.require();
    const entries = aiSends(await rt.store.readLog({ type: 'ai-send' }))
      .filter((e) => before === undefined || e.at < before)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
    return {
      items: entries.map((e) => ({
        at: e.at,
        provider: e.provider,
        model: e.model,
        purpose: e.purpose,
        docIds: e.docIds,
        folders: e.folders,
        approxInputTokens: e.approxInputTokens,
        ...(e.approxOutputTokens !== undefined ? { approxOutputTokens: e.approxOutputTokens } : {}),
        ...(e.estimatedCostUsd !== undefined ? { estimatedCostUsd: e.estimatedCostUsd } : {}),
        confirmed: e.confirmed,
      })),
    };
  },
});

export const chatHandlers = (s: MainServices): DomainHandlers<'chat'> => {
  const store = async () => new ChatStore(s.localDataDir, (await s.runtime.require()).libraryId);
  return {
    'chat:send': (req) => startChatTurn(s, req),
    'chat:cancel': async ({ turnId }) => ({ cancelled: cancelTurn(turnId) }),
    'chat:list': async ({ limit }) => ({ items: await (await store()).list(limit) }),
    'chat:get': async ({ conversationId }) => {
      const c = await (await store()).get(conversationId);
      if (!c) throw new AppError('NOT_FOUND', 'Unknown conversation');
      return { id: c.id, title: c.title, turns: c.turns };
    },
    'chat:delete': async ({ conversationId }) => {
      const st = await store();
      discardConversationTurns(conversationId);
      return { deleted: await st.delete(conversationId) };
    },
  };
};

export const commandsHandlers = (s: MainServices): DomainHandlers<'commands'> => ({
  'commands:list': async () => {
    const rt = await s.runtime.require();
    return { items: await listUserCommands(await s.libraries.dataDir(rt.libraryId)) };
  },
});

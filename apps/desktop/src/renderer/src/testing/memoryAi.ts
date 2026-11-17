import { AppError, defaultLibraryConfig, type LibraryConfig } from '@rl/core';
import { emitEvent } from './mockRl';

type Handler = (payload: any) => unknown;

export interface FakeSend {
  at: string;
  provider: string;
  model: string;
  purpose: string;
  docIds: string[];
  folders: string[];
  approxInputTokens: number;
  approxOutputTokens?: number;
  estimatedCostUsd?: number;
  confirmed: boolean;
}

export interface FakeTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  model?: string;
  reasoning?: string;
  cards: unknown[];
  contextDocIds: string[];
  usage?: { inputTokens: number; outputTokens: number; usd: number | null };
  error?: { code: string; message: string };
}

interface FakeConversation {
  id: string;
  title: string;
  updatedAt: string;
  turns: FakeTurn[];
}

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'card'; card: { id: string; name: string; status: 'running' | 'done' | 'failed'; summary: string; docIds: string[] } }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number; usd: number | null } }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

/**
 * A small in-memory main process for the phase 4 channels: `ai:*`, `chat:*`, `commands:list`, the library config the AI
 * settings write, and `library:listFolders`. The answer to a chat send is scripted: `state.script` returns the events
 * to stream (default: two text deltas and `done`), delivered one per macrotask after `chat:send` has answered;
 * `state.manual` leaves them to the test (`emit`), and `state.earlyEvents` delivers them before the answer.
 */
export function memoryAi(init: { config?: Partial<LibraryConfig>; docs?: Array<{ docId: string; path: string }>; folders?: string[]; commands?: Array<{ id: string; label: string; prompt: string }> } = {}) {
  const state = {
    config: { ...defaultLibraryConfig({ name: 'Alpha', language: 'en' }), ...init.config } as LibraryConfig,
    docs: init.docs ?? ([] as Array<{ docId: string; path: string }>),
    folders: init.folders ?? ['alpha', 'beta'],
    commands: init.commands ?? [],
    available: true,
    auth: 'claude-code' as 'claude-code' | 'api-key' | 'none',
    reason: undefined as undefined | 'no-access' | 'offline' | 'cap-reached' | 'error',
    monthUsd: 0,
    overCap: false,
    /** Ask for a confirmation on a send with documents (what `ai.confirmBeforeSend` does in main). */
    confirm: true,
    log: [] as FakeSend[],
    conversations: new Map<string, FakeConversation>(),
    sends: [] as any[],
    previews: [] as any[],
    cancels: [] as string[],
    /** A one-off error for the next `chat:send`. */
    sendError: null as AppError | null,
    script: ((_req: any): StreamEvent[] => [{ type: 'text-delta', text: 'Hello ' }, { type: 'text-delta', text: 'world' }, { type: 'done' }]) as (req: any) => StreamEvent[],
    manual: false,
    earlyEvents: false,
    cancelEmits: true,
    secrets: new Set<string>(),
    /** What the Claude Code executable status reports (undefined: the field is absent) and what the file dialog would return. */
    claudeCode: { path: 'bin/claude', source: 'path' } as { path: string | null; source: 'settings' | 'path' | 'local-bin' | 'sdk' | 'none' } | undefined,
    dialogPath: 'bin/chosen-claude' as string | null,
    counter: 1,
  };

  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const enabled = (path: string) => state.config.aiEnabledFolders.some((f) => dirOf(path) === f || dirOf(path).startsWith(`${f}/`));

  const preview = (p: any) => {
    const allowed: string[] = [];
    const refused: Array<{ docId: string; reason: 'folder-not-enabled' | 'missing' | 'unknown' }> = [];
    const folders = new Set<string>();
    for (const id of p.docIds ?? []) {
      const d = state.docs.find((x) => x.docId === id);
      if (!d) refused.push({ docId: id, reason: 'unknown' });
      else if (!enabled(d.path)) refused.push({ docId: id, reason: 'folder-not-enabled' });
      else (allowed.push(id), folders.add(dirOf(d.path)));
    }
    return {
      model: p.model,
      allowed,
      refused,
      folders: [...folders],
      approxInputTokens: allowed.length * 1000 + Math.ceil((p.promptChars ?? 0) / 4),
      estimatedUsd: allowed.length * 0.002,
      needsConfirmation: state.confirm && allowed.length > 0,
      overCap: state.overCap,
    };
  };

  const record = (turnId: string, ev: StreamEvent) => {
    for (const c of state.conversations.values()) {
      const t = c.turns.find((x) => x.id === turnId);
      if (!t) continue;
      if (ev.type === 'text-delta') t.text += ev.text;
      else if (ev.type === 'card') t.cards.push(ev.card);
      else if (ev.type === 'usage') t.usage = ev.usage;
      else if (ev.type === 'error') t.error = { code: ev.code, message: ev.message };
    }
  };
  /** Delivers one event of a turn, as the main process would. */
  const emit = (conversationId: string, turnId: string, event: StreamEvent) => {
    record(turnId, event);
    emitEvent('chat:event', { conversationId, turnId, event });
  };

  const handlers: Record<string, Handler> = {
    'library:getConfig': () => structuredClone(state.config),
    'library:setConfig': (p) => {
      const patch = p.patch ?? {};
      state.config = { ...state.config, ...patch, ai: { ...state.config.ai, ...(patch.ai ?? {}), usageCap: { ...state.config.ai.usageCap, ...(patch.ai?.usageCap ?? {}) } } };
      return structuredClone(state.config);
    },
    'library:listFolders': (p) => ({ folders: p.parent ? [] : state.folders.map((f) => ({ path: f, name: f, hasChildren: false })) }),
    'secrets:has': (p) => ({ exists: state.secrets.has(p.name) }),
    'secrets:set': (p) => (state.secrets.add(p.name), {}),
    'secrets:delete': (p) => (state.secrets.delete(p.name), {}),
    'commands:list': () => ({ items: state.commands }),
    'ai:status': () => ({
      provider: state.config.ai.provider,
      available: state.available,
      auth: state.auth,
      ...(state.reason ? { reason: state.reason } : {}),
      enabledFolders: state.config.aiEnabledFolders,
      monthUsd: state.monthUsd,
      capUsd: state.config.ai.usageCap.monthlyUsd,
      ...(state.claudeCode ? { claudeCode: state.claudeCode } : {}),
    }),
    'ai:chooseExecutable': () => {
      if (state.dialogPath !== null) state.claudeCode = { path: state.dialogPath, source: 'settings' };
      return { path: state.dialogPath };
    },
    'ai:clearExecutable': () => {
      state.claudeCode = { path: 'bin/claude', source: 'path' };
      return { ok: true };
    },
    'ai:preview': (p) => {
      state.previews.push(p);
      return preview(p);
    },
    'ai:usage': () => ({ month: '2026-11', usd: state.monthUsd, inputTokens: 0, outputTokens: 0, sends: state.log.length, byModel: [] }),
    'ai:log': (p) => ({ items: state.log.filter((s) => !p.before || s.at < p.before).slice(0, p.limit ?? 100) }),
    'chat:send': (p) => {
      state.sends.push(p);
      if (state.sendError) {
        const e = state.sendError;
        state.sendError = null;
        throw e;
      }
      if (!state.available) throw new AppError('AI_PROVIDER_ERROR', 'no access', { reason: state.reason ?? 'no-access' });
      if (state.overCap) throw new AppError('AI_BUDGET_EXCEEDED', 'cap');
      if (state.confirm && p.contextDocIds?.length > 0 && !p.confirmed) throw new AppError('CONFLICT', 'confirmation needed', { reason: 'needs-confirmation' });
      const n = state.counter++;
      const conversationId = p.conversationId ?? `conv-${n}`;
      const turnId = `turn-${n}`;
      const at = new Date(Date.UTC(2026, 10, 16, 10, n)).toISOString();
      const conv: FakeConversation = state.conversations.get(conversationId) ?? { id: conversationId, title: String(p.text).slice(0, 60), updatedAt: at, turns: [] };
      conv.turns.push({ id: `user-${n}`, role: 'user', text: p.text, at, cards: [], contextDocIds: p.contextDocIds ?? [] });
      conv.turns.push({ id: turnId, role: 'assistant', text: '', at, model: p.model, reasoning: p.reasoning, cards: [], contextDocIds: [] });
      conv.updatedAt = at;
      state.conversations.set(conversationId, conv);
      state.log.unshift({
        at,
        provider: state.config.ai.provider,
        model: p.model,
        purpose: 'chat',
        docIds: p.contextDocIds ?? [],
        folders: [],
        approxInputTokens: 100,
        confirmed: Boolean(p.confirmed),
      });
      const events = state.script(p);
      if (!state.manual) {
        if (state.earlyEvents) for (const ev of events) emit(conversationId, turnId, ev);
        else
          events.forEach((ev, i) => setTimeout(() => emit(conversationId, turnId, ev), i));
      }
      return { conversationId, turnId };
    },
    'chat:cancel': (p) => {
      state.cancels.push(p.turnId);
      if (state.cancelEmits) {
        const conv = [...state.conversations.values()].find((c) => c.turns.some((t) => t.id === p.turnId));
        if (conv) setTimeout(() => emit(conv.id, p.turnId, { type: 'error', code: 'CANCELLED', message: 'cancelled' }), 0);
      }
      return { cancelled: true };
    },
    'chat:list': () => ({
      items: [...state.conversations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, turns: c.turns.length })),
    }),
    'chat:get': (p) => {
      const c = state.conversations.get(p.conversationId);
      if (!c) throw new AppError('NOT_FOUND', 'conversation');
      return { id: c.id, title: c.title, turns: structuredClone(c.turns) };
    },
    'chat:delete': (p) => ({ deleted: state.conversations.delete(p.conversationId) }),
  };
  return { state, handlers, emit };
}

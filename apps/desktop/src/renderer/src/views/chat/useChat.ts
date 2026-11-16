import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channels, ReasoningLevel, ResponseOf } from '@rl/core';
import { RlError } from '../../lib/rl-error';
import { rl } from '../../lib/rl';
import type { Turn } from './ChatParts';

export type AiStatus = ResponseOf<Channels, 'ai:status'>;
export type AiUsage = ResponseOf<Channels, 'ai:usage'>;
export type AiPreview = ResponseOf<Channels, 'ai:preview'>;
export type ConversationSummary = ResponseOf<Channels, 'chat:list'>['items'][number];
type ChatEvent = { type: string; [k: string]: unknown };

export interface SendRequest {
  text: string;
  model: string;
  reasoning: ReasoningLevel;
  contextDocIds: string[];
  contextPage?: number | undefined;
}

/** A message shown above the input when a send did not start (the text stays in the input). */
export type Banner = { kind: 'overCap' } | { kind: 'noAccess' } | { kind: 'offline' } | { kind: 'provider' } | { kind: 'error'; error: unknown } | null;

/** Applies one streamed event to the turn it belongs to. */
export function applyEvent(turn: Turn, ev: ChatEvent): Turn {
  switch (ev.type) {
    case 'text-delta':
      return { ...turn, text: turn.text + String(ev.text ?? '') };
    case 'card': {
      const card = ev.card as Turn['cards'][number];
      const at = turn.cards.findIndex((c) => c.id === card.id);
      return { ...turn, cards: at < 0 ? [...turn.cards, card] : turn.cards.map((c, i) => (i === at ? card : c)) };
    }
    case 'usage':
      return { ...turn, usage: ev.usage as NonNullable<Turn['usage']> };
    case 'done':
      return { ...turn, streaming: false };
    case 'error':
      return { ...turn, streaming: false, error: { code: String(ev.code), message: String(ev.message ?? '') } };
    default:
      return turn;
  }
}

let localCounter = 0;

/**
 * State and actions of the chat panel: the conversation, the streamed answer, the preview before a send, cancel, the
 * history and the AI status and usage. Events of a turn can arrive before `chat:send` has answered, so the ones of an
 * unknown turn are held until the answer names it.
 */
export function useChat(onStarted: () => void) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [held, setHeld] = useState<{ req: SendRequest; preview: AiPreview } | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);

  const conv = useRef<string | null>(null);
  const known = useRef(new Set<string>());
  const early = useRef(new Map<string, ChatEvent[]>());
  const sendingRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const started = useRef(onStarted);
  started.current = onStarted;

  const refreshMeta = useCallback(async () => {
    const [s, u] = await Promise.allSettled([rl.invoke('ai:status', {}), rl.invoke('ai:usage', {})]);
    if (s.status === 'fulfilled') {
      setStatus(s.value);
      setStatusError(null);
    } else setStatusError(s.reason);
    if (u.status === 'fulfilled') setUsage(u.value);
  }, []);

  const finish = useCallback(
    (turnId: string) => {
      if (activeRef.current === turnId) {
        activeRef.current = null;
        sendingRef.current = false;
        setActive(null);
        setSending(false);
      }
      void refreshMeta();
    },
    [refreshMeta],
  );

  const applyTo = useCallback(
    (turnId: string, events: ChatEvent[]) => {
      setTurns((ts) => ts.map((t) => (t.id === turnId ? events.reduce(applyEvent, t) : t)));
      if (events.some((e) => e.type === 'done' || e.type === 'error')) finish(turnId);
    },
    [finish],
  );

  useEffect(() => {
    void refreshMeta();
    return rl.on('chat:event', (p) => {
      const ev = p.event as ChatEvent;
      if (known.current.has(p.turnId)) applyTo(p.turnId, [ev]);
      else if (sendingRef.current) early.current.set(p.turnId, [...(early.current.get(p.turnId) ?? []), ev]);
    });
  }, [applyTo, refreshMeta]);

  const start = useCallback(
    async (req: SendRequest, confirmed: boolean): Promise<'sent' | 'held' | 'failed'> => {
      setBanner(null);
      setHeld(null);
      const n = ++localCounter;
      const at = new Date().toISOString();
      const userTurn: Turn = { id: `local-u${n}`, role: 'user', text: req.text, at, cards: [], contextDocIds: req.contextDocIds };
      const answer: Turn = { id: `local-a${n}`, role: 'assistant', text: '', at, model: req.model, reasoning: req.reasoning, cards: [], contextDocIds: [], streaming: true };
      setTurns((ts) => [...ts, userTurn, answer]);
      sendingRef.current = true;
      early.current.clear();
      setSending(true);
      const drop = () => {
        sendingRef.current = false;
        setSending(false);
        setTurns((ts) => ts.filter((t) => t.id !== userTurn.id && t.id !== answer.id));
      };
      try {
        const r = await rl.invoke('chat:send', {
          ...(conv.current ? { conversationId: conv.current } : {}),
          text: req.text,
          model: req.model,
          reasoning: req.reasoning,
          contextDocIds: req.contextDocIds,
          ...(req.contextPage ? { contextPage: req.contextPage } : {}),
          confirmed,
        });
        conv.current = r.conversationId;
        setConversationId(r.conversationId);
        known.current.add(r.turnId);
        activeRef.current = r.turnId;
        setActive(r.turnId);
        const buffered = early.current.get(r.turnId) ?? [];
        early.current.clear();
        setTurns((ts) => ts.map((t) => (t.id === answer.id ? buffered.reduce(applyEvent, { ...t, id: r.turnId }) : t)));
        if (buffered.some((e) => e.type === 'done' || e.type === 'error')) finish(r.turnId);
        started.current();
        return 'sent';
      } catch (e) {
        drop();
        const err = RlError.from(e);
        if (err.code === 'CONFLICT' && err.details?.reason === 'needs-confirmation') {
          try {
            const preview = await rl.invoke('ai:preview', { purpose: 'chat', model: req.model, docIds: req.contextDocIds, promptChars: req.text.length });
            setHeld({ req, preview });
            return 'held';
          } catch (e2) {
            setBanner({ kind: 'error', error: e2 });
            return 'failed';
          }
        }
        if (err.code === 'AI_BUDGET_EXCEEDED') setBanner({ kind: 'overCap' });
        else if (err.code === 'AI_PROVIDER_ERROR') {
          const reason = err.details?.reason;
          setBanner({ kind: reason === 'no-access' ? 'noAccess' : reason === 'offline' ? 'offline' : 'provider' });
          void refreshMeta();
        } else setBanner({ kind: 'error', error: e });
        return 'failed';
      }
    },
    [finish, refreshMeta],
  );

  /** Sends, after the preview when documents go with it. Resolves 'sent' once the turn started. */
  const send = useCallback(
    async (req: SendRequest): Promise<'sent' | 'held' | 'failed'> => {
      setBanner(null);
      if (req.contextDocIds.length > 0) {
        try {
          const preview = await rl.invoke('ai:preview', { purpose: 'chat', model: req.model, docIds: req.contextDocIds, promptChars: req.text.length });
          if (preview.overCap) {
            setBanner({ kind: 'overCap' });
            return 'failed';
          }
          if (preview.needsConfirmation || preview.refused.length > 0) {
            setHeld({ req, preview });
            return 'held';
          }
        } catch (e) {
          setBanner({ kind: 'error', error: e });
          return 'failed';
        }
      }
      return start(req, false);
    },
    [start],
  );

  const confirmHeld = useCallback(async () => {
    if (held) await start(held.req, true);
  }, [held, start]);
  const dismissHeld = useCallback(() => setHeld(null), []);

  const cancel = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      await rl.invoke('chat:cancel', { turnId: id });
    } catch (e) {
      setBanner({ kind: 'error', error: e });
    }
    // What was streamed stays, marked as cancelled; a later `error` event of the main process says the same.
    setTurns((ts) => ts.map((t) => (t.id === id && t.streaming ? { ...t, streaming: false, error: { code: 'CANCELLED', message: '' } } : t)));
    finish(id);
  }, [finish]);

  const newConversation = useCallback(() => {
    conv.current = null;
    setConversationId(null);
    setTurns([]);
    setBanner(null);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setHistory((await rl.invoke('chat:list', {})).items);
    } catch (e) {
      setHistoryError(e);
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    try {
      const c = await rl.invoke('chat:get', { conversationId: id });
      conv.current = c.id;
      setConversationId(c.id);
      setTurns(c.turns);
      setBanner(null);
      return true;
    } catch (e) {
      setHistoryError(e);
      return false;
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await rl.invoke('chat:delete', { conversationId: id });
        if (conv.current === id) newConversation();
        await loadHistory();
      } catch (e) {
        setHistoryError(e);
      }
    },
    [loadHistory, newConversation],
  );

  return {
    conversationId, turns, active, sending, held, banner, status, statusError, usage, history, historyError,
    send, confirmHeld, dismissHeld, cancel, newConversation, loadHistory, openConversation, deleteConversation, refreshMeta,
  };
}

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
  /** 'search': the advanced search (always a new conversation, no documents). */
  mode?: 'chat' | 'search';
}

/** A message shown above the input when a send did not start (the text stays in the input). */
export type Banner =
  | { kind: 'turnRunning' }
  | { kind: 'overCap' }
  /** The monthly token cap refused the send (D-442): the request is kept to send it again after a raise. */
  | { kind: 'tokenCap'; cap: number; req: SendRequest }
  | { kind: 'noAccess' }
  | { kind: 'offline' }
  | { kind: 'provider' }
  | { kind: 'error'; error: unknown }
  | null;

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

/** After a cancel, how long to wait for the terminal event of main before unlocking the panel. */
const CANCEL_GRACE_MS = 10_000;
let localCounter = 0;
let viewCounter = 0;

/** The turn being written: its question and answer, kept apart from the turns of the conversation shown. */
interface Live {
  /** The view (blank or opened conversation) the send started in. */
  key: number;
  convId: string | null;
  turnId: string | null;
  user: Turn;
  answer: Turn;
  /** The terminal event arrived: nothing more will change. */
  done: boolean;
}
interface View {
  key: number;
  convId: string | null;
  /** Turns of the conversation as stored (without the live turn). */
  base: Turn[];
}

const showsLive = (v: View, l: Live | null): l is Live => l !== null && (l.key === v.key || (l.convId !== null && l.convId === v.convId));

/**
 * State and actions of the chat panel: the conversation, the streamed answer, the preview before a send, cancel, the
 * history and the AI status and usage. Events of a turn can arrive before `chat:send` has answered, so the ones of an
 * unknown turn are held until the answer names it. The turn being written (`live`) belongs to the conversation it
 * started in: opening another conversation or starting a new one meanwhile leaves it streaming in the background, and it
 * shows again when its conversation is opened. `sending` lasts until the terminal event, also after a cancel.
 */
export function useChat(onStarted: (mode: 'chat' | 'search') => void) {
  const [view, setViewState] = useState<View>({ key: 0, convId: null, base: [] });
  const [live, setLiveState] = useState<Live | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [held, setHeld] = useState<{ req: SendRequest; preview: AiPreview } | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);

  const viewRef = useRef<View>(view);
  const liveRef = useRef<Live | null>(null);
  const early = useRef(new Map<string, ChatEvent[]>());
  const sendingRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const started = useRef(onStarted);
  started.current = onStarted;

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);
  const setLive = useCallback((l: Live | null) => {
    liveRef.current = l;
    setLiveState(l);
  }, []);

  const refreshMeta = useCallback(async () => {
    const [s, u] = await Promise.allSettled([rl.invoke('ai:status', {}), rl.invoke('ai:usage', {})]);
    if (s.status === 'fulfilled') {
      setStatus(s.value);
      setStatusError(null);
    } else setStatusError(s.reason);
    if (u.status === 'fulfilled') setUsage(u.value);
  }, []);

  /** The turn ended (terminal event, or a cancel that found nothing to stop). */
  const finish = useCallback(
    (turnId: string) => {
      if (activeRef.current !== turnId) return;
      activeRef.current = null;
      sendingRef.current = false;
      setActive(null);
      setSending(false);
      const l = liveRef.current;
      if (l && l.turnId === turnId) setLive({ ...l, done: true, answer: { ...l.answer, streaming: false } });
      void refreshMeta();
    },
    [refreshMeta, setLive],
  );

  const applyTo = useCallback(
    (turnId: string, events: ChatEvent[]) => {
      const l = liveRef.current;
      if (!l || l.turnId !== turnId) return;
      setLive({ ...l, answer: events.reduce(applyEvent, l.answer) });
      if (events.some((e) => e.type === 'done' || e.type === 'error')) finish(turnId);
    },
    [finish, setLive],
  );

  useEffect(() => {
    void refreshMeta();
    return rl.on('chat:event', (p) => {
      const ev = p.event as ChatEvent;
      if (liveRef.current?.turnId === p.turnId) applyTo(p.turnId, [ev]);
      else if (sendingRef.current && liveRef.current?.turnId === null) early.current.set(p.turnId, [...(early.current.get(p.turnId) ?? []), ev]);
    });
  }, [applyTo, refreshMeta]);

  const start = useCallback(
    async (req: SendRequest, confirmed: boolean): Promise<'sent' | 'held' | 'failed'> => {
      setBanner(null);
      setHeld(null);
      // One answer at a time (main refuses a second one too): say so without starting anything.
      if (sendingRef.current) {
        setBanner({ kind: 'turnRunning' });
        return 'failed';
      }
      // The previous answer, when it is on screen, becomes part of the conversation shown.
      const prev = liveRef.current;
      if (showsLive(viewRef.current, prev)) setView({ ...viewRef.current, base: [...viewRef.current.base, prev.user, prev.answer] });
      const n = ++localCounter;
      const at = new Date().toISOString();
      const origin = viewRef.current;
      const userTurn: Turn = { id: `local-u${n}`, role: 'user', text: req.text, at, cards: [], contextDocIds: req.contextDocIds };
      const answer: Turn = { id: `local-a${n}`, role: 'assistant', text: '', at, model: req.model, reasoning: req.reasoning, cards: [], contextDocIds: [], streaming: true };
      setLive({ key: origin.key, convId: origin.convId, turnId: null, user: userTurn, answer, done: false });
      sendingRef.current = true;
      early.current.clear();
      setSending(true);
      const drop = () => {
        sendingRef.current = false;
        setSending(false);
        if (liveRef.current?.user.id === userTurn.id) setLive(null);
      };
      try {
        const r = await rl.invoke('chat:send', {
          ...(origin.convId && req.mode !== 'search' ? { conversationId: origin.convId } : {}),
          ...(req.mode === 'search' ? { mode: 'search' as const } : {}),
          text: req.text,
          model: req.model,
          reasoning: req.reasoning,
          contextDocIds: req.contextDocIds,
          ...(req.contextPage ? { contextPage: req.contextPage } : {}),
          confirmed,
        });
        // Still in the view the send started in: that view now is this conversation. Otherwise the stream goes on unseen.
        if (viewRef.current.key === origin.key) setView({ ...viewRef.current, convId: r.conversationId });
        activeRef.current = r.turnId;
        setActive(r.turnId);
        const buffered = early.current.get(r.turnId) ?? [];
        early.current.clear();
        const l = liveRef.current;
        if (l && l.user.id === userTurn.id) setLive({ ...l, convId: r.conversationId, turnId: r.turnId, answer: buffered.reduce(applyEvent, { ...l.answer, id: r.turnId }) });
        if (buffered.some((e) => e.type === 'done' || e.type === 'error')) finish(r.turnId);
        started.current(req.mode ?? 'chat');
        return 'sent';
      } catch (e) {
        drop();
        const err = RlError.from(e);
        if (err.code === 'CONFLICT' && err.details?.reason === 'needs-confirmation') {
          try {
            const given = err.details.preview as AiPreview | undefined;
            const preview = given && Array.isArray(given.folders) ? given : await rl.invoke('ai:preview', { purpose: 'chat', model: req.model, docIds: req.contextDocIds, promptChars: req.text.length });
            setHeld({ req, preview });
            return 'held';
          } catch (e2) {
            setBanner({ kind: 'error', error: e2 });
            return 'failed';
          }
        }
        if (err.code === 'CONFLICT' && err.details?.reason === 'turn-running') setBanner({ kind: 'turnRunning' });
        else if (err.code === 'AI_BUDGET_EXCEEDED') setBanner({ kind: 'overCap' });
        else if (err.code === 'AI_TOKEN_CAP_REACHED') setBanner({ kind: 'tokenCap', cap: Number(err.details?.tokenCap ?? 0), req });
        else if (err.code === 'AI_PROVIDER_ERROR') {
          const reason = err.details?.reason;
          setBanner({ kind: reason === 'no-access' ? 'noAccess' : reason === 'offline' ? 'offline' : 'provider' });
          void refreshMeta();
        } else setBanner({ kind: 'error', error: e });
        return 'failed';
      }
    },
    [finish, refreshMeta, setLive, setView],
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

  /** A blank conversation, or the one opened; a turn still being written stays attached to its own conversation. */
  const switchTo = useCallback(
    (convId: string | null, base: Turn[]) => {
      if (liveRef.current?.done) setLive(null);
      setView({ key: ++viewCounter, convId, base });
      setBanner(null);
    },
    [setLive, setView],
  );

  /** The advanced search: a new conversation, sent at once (the user confirmed in the dialog; no document goes with it). */
  const sendSearch = useCallback(
    async (req: Omit<SendRequest, 'contextDocIds' | 'mode'>) => {
      if (!sendingRef.current) switchTo(null, []);
      return start({ ...req, contextDocIds: [], contextPage: undefined, mode: 'search' }, true);
    },
    [start, switchTo],
  );

  const confirmHeld = useCallback(async () => {
    if (held) await start(held.req, true);
  }, [held, start]);
  const dismissHeld = useCallback(() => setHeld(null), []);

  const cancel = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const r = await rl.invoke('chat:cancel', { turnId: id });
      // Main ends the turn with a terminal event, and `sending` lasts until it arrives. With nothing to stop none will come.
      if (!r.cancelled) finish(id);
    } catch (e) {
      setBanner({ kind: 'error', error: e });
    }
    // What was streamed stays, marked as cancelled; the `error` event of the main process confirms it.
    const l = liveRef.current;
    if (l && l.turnId === id && l.answer.streaming) setLive({ ...l, answer: { ...l.answer, streaming: false, error: { code: 'CANCELLED', message: '' } } });
    // Safety net: a terminal event that never comes must not leave the panel locked.
    setTimeout(() => finish(id), CANCEL_GRACE_MS);
  }, [finish, setLive]);

  const newConversation = useCallback(() => switchTo(null, []), [switchTo]);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setHistory((await rl.invoke('chat:list', {})).items);
    } catch (e) {
      setHistoryError(e);
    }
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      try {
        const c = await rl.invoke('chat:get', { conversationId: id });
        // The turn being written has only its question in the file: the live turn shows both.
        const l = liveRef.current;
        const turns = l && !l.done && l.convId === c.id && c.turns.at(-1)?.role === 'user' ? c.turns.slice(0, -1) : c.turns;
        switchTo(c.id, turns);
        return true;
      } catch (e) {
        setHistoryError(e);
        return false;
      }
    },
    [switchTo],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await rl.invoke('chat:delete', { conversationId: id });
        if (viewRef.current.convId === id) newConversation();
        await loadHistory();
      } catch (e) {
        setHistoryError(e);
      }
    },
    [loadHistory, newConversation],
  );

  const shown = showsLive(view, live);
  const turns = shown ? [...view.base, live.user, live.answer] : view.base;
  return {
    conversationId: view.convId,
    turns,
    /** A turn is being written for another conversation than the one shown. */
    busyElsewhere: sending && !shown,
    active, sending, held, banner, status, statusError, usage, history, historyError,
    send, sendSearch, confirmHeld, dismissHeld, cancel, newConversation, loadHistory, openConversation, deleteConversation, refreshMeta,
  };
}

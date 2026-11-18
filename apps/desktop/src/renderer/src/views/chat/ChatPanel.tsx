import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_LIMITS, type ReasoningLevel } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { TurnView } from './ChatParts';
import { formatUsd } from './format';
import { PreviewDialog } from './PreviewDialog';
import { useChat, type Banner } from './useChat';
import { useDocTitle } from './useLabels';
import './chat.css';

const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];

function ContextChip({ docId, onRemove }: { docId: string; onRemove(): void }) {
  const { t } = useTranslation();
  const title = safeText(useDocTitle(docId) ?? docId.slice(0, 8));
  return (
    <li className="ctx-chip" data-testid="context-chip" data-doc-id={docId}>
      <span>{title}</span>
      <button type="button" className="icon-button" aria-label={t('chat.removeContext', { name: title })} onClick={onRemove}>
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

function BannerView({ banner, onSettings }: { banner: NonNullable<Banner>; onSettings(): void }) {
  const { t } = useTranslation();
  const text =
    banner.kind === 'turnRunning'
      ? t('chat.errors.turnRunning')
      : banner.kind === 'overCap'
      ? t('chat.errors.cap')
      : banner.kind === 'noAccess'
        ? t('chat.errors.noAccess')
        : banner.kind === 'offline'
          ? t('chat.errors.offline')
          : banner.kind === 'provider'
            ? t('chat.errors.generic')
            : errorMessage(banner.error, t);
  return (
    <div className="error-note chat-banner" role="alert" data-testid="chat-banner" data-kind={banner.kind}>
      <p>{text}</p>
      {(banner.kind === 'overCap' || banner.kind === 'noAccess') && (
        <button type="button" className="link" onClick={onSettings}>
          {t('chat.openSettings')}
        </button>
      )}
    </div>
  );
}

/** Why the AI cannot be used and how to fix it, with the way to Settings. */
function Unavailable({ reason, onSettings }: { reason: string | undefined; onSettings(): void }) {
  const { t } = useTranslation();
  const key = reason === 'no-access' || reason === 'offline' || reason === 'cap-reached' ? reason : 'error';
  return (
    <div className="callout" role="status" data-testid="ai-unavailable" data-reason={key}>
      <p>{t(`chat.unavailable.${key}`)}</p>
      <p className="hint">{t(`chat.unavailable.fix_${key}`)}</p>
      {(key === 'no-access' || key === 'cap-reached') && (
        <button type="button" className="link" onClick={onSettings}>
          {t('chat.openSettings')}
        </button>
      )}
    </div>
  );
}

/**
 * The chat side panel (phase 4): conversation with streaming, action cards, context chips from the selection or the open
 * document, the preview before a send, the model and reasoning selectors, the usage counter, cancel and the history.
 * Everything the model writes is marked as generated and rendered as safe Markdown (no HTML, only `lab://` links act).
 */
export function ChatPanel() {
  const { t } = useTranslation();
  const app = useApp();
  const ui = useAiUi();
  const ids = { text: useId(), model: useId(), reasoning: useId() };
  const [input, setInput] = useState('');
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [model, setModel] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningLevel | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  // A search leaves the draft of the input alone.
  const chat = useChat((mode) => mode === 'search' || setInput(''));

  const ai = app.config?.ai;
  const models = ai?.models ?? [];
  const effectiveModel = model && models.some((m) => m.id === model) ? model : (ai?.defaultModel ?? models[0]?.id ?? '');
  const effectiveReasoning = reasoning ?? ai?.defaultReasoning ?? 'low';
  const modelLabel = (id: string | undefined) => models.find((m) => m.id === id)?.label ?? id ?? '';

  // The context: the open document (with its page) when the reader is open, otherwise the selection of the library.
  const source = useMemo(() => (ui.reader ? [ui.reader.docId] : [...ui.selection]), [ui.reader?.docId, ui.selection]);
  useEffect(() => setRemoved(new Set()), [source]);
  const kept = source.filter((id) => !removed.has(id));
  const contextDocIds = kept.slice(0, AI_LIMITS.contextDocs);
  const overLimit = kept.length > AI_LIMITS.contextDocs;
  const contextPage = ui.reader && contextDocIds.includes(ui.reader.docId) ? ui.reader.page : undefined;

  // A command of the palette fills the prompt; it is never sent from here.
  const prefillNonce = ui.prefill?.nonce;
  useEffect(() => {
    if (!ui.prefill) return;
    setView('chat');
    setInput(ui.prefill.text);
    area.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  // The advanced search asked by the dialog of the library runs here, as a new conversation that streams in this panel.
  const search = ui.searchRequest;
  useEffect(() => {
    if (!search) return;
    ui.takeSearch(search.nonce);
    setView('chat');
    void chat.sendSearch({ text: search.text, model: search.model, reasoning: search.reasoning });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.nonce]);

  // Keep the newest text in view while it streams.
  useEffect(() => {
    const el = log.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight });
  }, [chat.turns]);

  // The advanced search dialog needs to know that an answer is being written.
  const { setChatBusy } = ui;
  useEffect(() => {
    setChatBusy(chat.sending);
    return () => setChatBusy(false);
  }, [chat.sending, setChatBusy]);

  const unavailable = chat.status !== null && !chat.status.available;
  const canSend = input.trim() !== '' && !chat.sending && !unavailable && effectiveModel !== '';

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    void chat.send({ text: input.trim(), model: effectiveModel, reasoning: effectiveReasoning, contextDocIds, contextPage });
  };

  const monthly = chat.status?.capUsd ?? ai?.usageCap.monthlyUsd ?? null;
  const usageText = chat.usage
    ? monthly === null
      ? t('chat.usage', { used: formatUsd(chat.usage.usd) })
      : t('chat.usageCap', { used: formatUsd(chat.usage.usd), cap: formatUsd(monthly) })
    : null;

  const showHistory = () => {
    setView('history');
    void chat.loadHistory();
  };

  return (
    <div className="chat-panel" data-testid="chat-content">
      <div className="chat-toolbar">
        <button type="button" onClick={() => { chat.newConversation(); setView('chat'); }} data-testid="chat-new">
          {t('chat.new')}
        </button>
        <button type="button" onClick={() => (view === 'history' ? setView('chat') : showHistory())} aria-pressed={view === 'history'} data-testid="chat-history-toggle">
          {t('chat.history')}
        </button>
        {usageText && (
          <span className="chat-usage-counter hint" data-testid="chat-usage" role="status">
            {usageText}
          </span>
        )}
      </div>

      {chat.statusError ? <ErrorNote testId="ai-status-error">{errorMessage(chat.statusError, t)}</ErrorNote> : null}
      {unavailable && chat.status && <Unavailable reason={chat.status.reason} onSettings={ui.openSettings} />}
      {chat.status && chat.status.enabledFolders.length === 0 && !unavailable && (
        <p className="hint" data-testid="no-folders-hint">
          {t('chat.noFolders')}{' '}
          <button type="button" className="link" onClick={ui.openSettings}>
            {t('chat.openSettings')}
          </button>
        </p>
      )}

      {view === 'history' ? (
        <section aria-label={t('chat.history')} data-testid="chat-history">
          {chat.historyError ? <ErrorNote>{errorMessage(chat.historyError, t)}</ErrorNote> : null}
          {chat.history === null && !chat.historyError && <p className="hint">{t('common.loading')}</p>}
          {chat.history?.length === 0 && <p className="hint">{t('chat.historyEmpty')}</p>}
          <ul className="chat-history-list">
            {chat.history?.map((c) => (
              <li key={c.id} data-testid="history-item" data-conversation-id={c.id} data-mode={c.mode} className={c.id === chat.conversationId ? 'current' : undefined}>
                {confirmDelete === c.id ? (
                  <div className="confirm" role="alertdialog" aria-label={t('chat.deleteTitle')}>
                    <p>{t('chat.deleteConfirm', { title: safeText(c.title) })}</p>
                    <div className="actions start">
                      <button type="button" className="danger" onClick={() => { setConfirmDelete(null); void chat.deleteConversation(c.id); }} data-testid="history-delete-confirm">
                        {t('chat.delete')}
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className="link history-open" onClick={() => void chat.openConversation(c.id).then((ok) => ok && setView('chat'))} data-testid="history-open">
                      {safeText(c.title)}
                    </button>
                    {c.mode === 'search' && (
                      <span className="badge" data-testid="history-mode-search">
                        {t('chat.searchLabel')}
                      </span>
                    )}
                    <span className="hint">{t('chat.turns', { count: c.turns })}</span>
                    <button type="button" className="link" onClick={() => setConfirmDelete(c.id)} aria-label={t('chat.deleteOne', { title: safeText(c.title) })} data-testid="history-delete">
                      {t('chat.delete')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {chat.turns.length === 0 ? (
            <p className="hint chat-empty" data-testid="chat-empty">
              {t('chat.empty')}
            </p>
          ) : (
            <ol className="chat-log" ref={log} aria-live="polite" aria-label={t('chat.conversation')} data-testid="chat-log">
              {chat.turns.map((turn) => (
                <TurnView key={turn.id} turn={turn} modelLabel={modelLabel(turn.model)} />
              ))}
            </ol>
          )}

          {chat.banner && <BannerView banner={chat.banner} onSettings={ui.openSettings} />}

          {kept.length > 0 && (
            <div className="chat-context" data-testid="chat-context">
              <p className="hint">{ui.reader ? t('chat.contextReader', { page: ui.reader.page }) : t('chat.context', { count: contextDocIds.length })}</p>
              {overLimit && (
                <p className="hint warn" role="status" data-testid="context-limit">
                  {t('chat.contextLimit', { limit: AI_LIMITS.contextDocs, count: kept.length })}
                </p>
              )}
              <ul className="ctx-chips">
                {contextDocIds.map((id) => (
                  <ContextChip key={id} docId={id} onRemove={() => setRemoved((r) => new Set([...r, id]))} />
                ))}
              </ul>
            </div>
          )}

          {chat.busyElsewhere && (
            <p className="hint" role="status" data-testid="chat-busy-other">
              {t('chat.busyOther')}
            </p>
          )}

          <form className="chat-form" onSubmit={submit}>
            <label htmlFor={ids.text} className="sr-only">
              {t('chat.input')}
            </label>
            <textarea
              id={ids.text}
              ref={area}
              rows={3}
              value={input}
              maxLength={AI_LIMITS.message}
              disabled={unavailable}
              placeholder={t('chat.inputPlaceholder')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
              }}
              data-testid="chat-input"
            />
            <div className="chat-selectors">
              <label htmlFor={ids.model}>{t('chat.model')}</label>
              <select id={ids.model} value={effectiveModel} onChange={(e) => setModel(e.target.value)} data-testid="chat-model">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <label htmlFor={ids.reasoning}>{t('chat.reasoning')}</label>
              <select id={ids.reasoning} value={effectiveReasoning} onChange={(e) => setReasoning(e.target.value as ReasoningLevel)} data-testid="chat-reasoning">
                {REASONING.map((r) => (
                  <option key={r} value={r}>
                    {t(`settings.library.reasoning${r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="actions">
              {chat.sending && (
                <button type="button" onClick={() => void chat.cancel()} data-testid="chat-cancel">
                  {t('chat.cancel')}
                </button>
              )}
              <button type="submit" className="primary" disabled={!canSend} data-testid="chat-send">
                {t('chat.send')}
              </button>
            </div>
            <p className="hint">{t('chat.shortcuts')}</p>
          </form>
        </>
      )}

      {chat.held && <PreviewDialog agent preview={chat.held.preview} models={models} busy={chat.sending} onConfirm={() => void chat.confirmHeld()} onCancel={chat.dismissHeld} />}
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_LIMITS, type ReasoningLevel } from '@rl/core';
import { Button } from '../../components/Button';
import { ChoiceChip } from '../../components/ChoiceChip';
import { IconButton } from '../../components/IconButton';
import { IconMore } from '../../components/icons';
import { Menu } from '../../components/Menu';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { useCapActions } from '../ai/tokenCap';
import { safeText } from '../library/safeText';
import { TurnView } from './ChatParts';
import { formatUsd } from './format';
import { PreviewDialog } from './PreviewDialog';
import { useChat, type AiPreview, type Banner, type SendRequest } from './useChat';
import { useDocTitle } from './useLabels';
import './chat.css';

const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];

function NewDocs({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id, i) => (
        <NewDoc key={id} id={id} last={i === ids.length - 1} />
      ))}
    </>
  );
}
function NewDoc({ id, last }: { id: string; last: boolean }) {
  const title = safeText(useDocTitle(id) ?? id.slice(0, 8));
  return (
    <>
      <strong data-testid="inline-new-doc">{title}</strong>
      {last ? '' : ', '}
    </>
  );
}

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

function TokenCapBanner({ cap, onRetry }: { cap: number; onRetry(): void }) {
  const { t, i18n } = useTranslation();
  const actions = useCapActions()(onRetry);
  return (
    <div className="error-note chat-banner" role="alert" data-testid="chat-banner" data-kind="tokenCap">
      <p>{t('tokenCap.refused', { cap: new Intl.NumberFormat(i18n.language).format(cap) })}</p>
      {actions.map((a) => (
        <button key={a.label} type="button" className="link" onClick={a.run} data-testid="token-cap-action">
          {a.label}
        </button>
      ))}
    </div>
  );
}

function BannerView({ banner, onSettings, onRetry }: { banner: NonNullable<Banner>; onSettings(): void; onRetry(req: SendRequest): void }) {
  const { t } = useTranslation();
  if (banner.kind === 'tokenCap') return <TokenCapBanner cap={banner.cap} onRetry={() => onRetry(banner.req)} />;
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
  const ids = { text: useId() };
  const [input, setInput] = useState('');
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [model, setModel] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningLevel | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchor = useRef<HTMLSpanElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  // A search leaves the draft of the input alone.
  const chat = useChat((mode) => mode === 'search' || setInput(''));

  const ai = app.config?.ai;
  const models = ai?.models ?? [];
  const effectiveModel = model && models.some((m) => m.id === model) ? model : (ai?.defaultModel ?? models[0]?.id ?? '');
  const effectiveReasoning = reasoning ?? ai?.defaultReasoning ?? 'low';
  const reasoningName = (r: ReasoningLevel) => t(`settings.library.reasoning${r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}`).toLowerCase();
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

  // After the first confirmation of the conversation the preview of the next turn sits above the field (D-339, D-364).
  const inline = chat.confirmed;
  const [pv, setPv] = useState<AiPreview | null>(null);
  const [detail, setDetail] = useState(false);
  const docKey = contextDocIds.join(',');
  const sizeBucket = Math.ceil(input.length / 200);
  useEffect(() => {
    if (!inline) {
      setPv(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      rl.invoke('ai:preview', { purpose: 'chat', model: effectiveModel, docIds: docKey ? docKey.split(',') : [], promptChars: Math.max(input.length, 1) }).then(
        (r) => live && setPv(r),
        () => live && setPv(null),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline, effectiveModel, docKey, sizeBucket]);
  const newDocs = inline && pv ? pv.allowed.filter((id) => !inline.docs.has(id)) : [];
  const asksAgain = inline !== null && pv !== null && (newDocs.length > 0 || inline.model !== effectiveModel || pv.refused.length > 0);

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
        {usageText && (
          <span className="chat-usage-counter hint" data-testid="chat-usage" role="status">
            {usageText}
          </span>
        )}
        <span ref={moreAnchor} className="chat-toolbar__more">
          <IconButton label={t('chat.more')} size="sm" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="chat-more">
            <IconMore size={16} />
          </IconButton>
        </span>
        <Menu
          anchor={moreAnchor}
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          label={t('chat.more')}
          groups={[
            {
              id: 'conversations',
              items: [
                { id: 'new', label: t('chat.new'), testId: 'chat-new', onSelect: () => (chat.newConversation(), setView('chat')) },
                { id: 'history', label: view === 'history' ? t('chat.backToChat') : t('chat.history'), testId: 'chat-history-toggle', onSelect: () => (view === 'history' ? setView('chat') : showHistory()) },
              ],
            },
          ]}
        />
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

          {chat.banner && <BannerView banner={chat.banner} onSettings={ui.openSettings} onRetry={(r) => void chat.send(r)} />}

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
            {inline && pv && (
              <div className="chat-inline" role="status" data-testid="chat-inline-preview" data-asks={asksAgain || undefined}>
                <span>
                  {pv.allowed.length > 0 ? t('chat.inline.withDocs', { count: pv.allowed.length }) : t('chat.inline.only')} ·{' '}
                  {pv.estimatedUsd === null ? t('chat.preview.noPrice') : t('chat.inline.cost', { usd: formatUsd(pv.estimatedUsd) })}
                </span>
                {newDocs.length > 0 && (
                  <span data-testid="inline-new-docs">
                    {' '}
                    {t('chat.inline.newDocs')} <NewDocs ids={newDocs} />
                  </span>
                )}
                {asksAgain && <span> {t('chat.inline.asksAgain')}</span>}{' '}
                <button type="button" className="link" onClick={() => setDetail(true)} data-testid="inline-details">
                  {t('chat.inline.details')}
                </button>
              </div>
            )}
            <div className="chat-composer-row">
              <ChoiceChip text={modelLabel(effectiveModel)} heading={t('chat.model')} value={effectiveModel} options={models.map((m) => ({ id: m.id, label: m.label || m.id }))} onPick={setModel} testId="chat-model" />
              <ChoiceChip text={t('chat.reasoningChip', { level: reasoningName(effectiveReasoning) })} heading={t('chat.reasoning')} value={effectiveReasoning} options={REASONING.map((r) => ({ id: r, label: reasoningName(r) }))} onPick={(r) => setReasoning(r as ReasoningLevel)} testId="chat-reasoning" />
              <span className="chat-composer-row__fill" />
              {chat.sending && (
                <Button size="sm" onClick={() => void chat.cancel()} data-testid="chat-cancel">
                  {t('chat.cancel')}
                </Button>
              )}
              <button type="submit" className="primary chat-send" disabled={!canSend} title={t('chat.sendTip')} aria-label={t('chat.send')} data-testid="chat-send">
                <span aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
        </>
      )}

      {detail && pv && <PreviewDialog readOnly agent preview={pv} models={models} busy={false} onConfirm={() => setDetail(false)} onCancel={() => setDetail(false)} />}
      {chat.held && <PreviewDialog agent preview={chat.held.preview} models={models} busy={chat.sending} onConfirm={() => void chat.confirmHeld()} onCancel={chat.dismissHeld} />}
    </div>
  );
}

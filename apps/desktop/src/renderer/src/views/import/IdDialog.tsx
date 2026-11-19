import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportIdAddResult, ImportIdItem } from '@rl/core';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Dialog } from '../../components/Dialog';
import { CheckField, ErrorNote, TextAreaField } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import '../chat/dialogs.css';
import '../resources/resources.css';

const TONE = { recognized: 'success', 'in-library': 'info', 'not-found': 'warning', offline: 'warning', invalid: 'danger' } as const;

/**
 * "Add > From DOI, arXiv or URL..." (17.4.3): one identifier or address per line, looked up in OpenAlex and arXiv. What is
 * recognised is shown (title, authors, year); what is already in the library links there. The open PDF (arXiv) is
 * downloaded only if the user ticks it, and goes to Arrivals, where the name and the folder are confirmed.
 */
export default function IdDialog({ initialText, onClose }: { initialText: string; onClose(): void }) {
  const { t } = useTranslation();
  const { invalidateAll } = useLibraryEvents();
  const { openInbox } = useAiUi();
  const { openReader } = useReader();
  const [text, setText] = useState(initialText);
  const [items, setItems] = useState<ImportIdItem[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [download, setDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportIdAddResult | null>(null);

  const find = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await rl.invoke('importId:resolve', { text });
      setItems(r.items);
      setChosen(new Set(r.items.flatMap((it, i) => (it.state === 'recognized' ? [i] : []))));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!items) return;
    const entries = [...chosen].flatMap((i) => (items[i]?.kind && items[i]?.id ? [{ kind: items[i]!.kind!, id: items[i]!.id! }] : []));
    setError(null);
    setBusy(true);
    try {
      setResult(await rl.invoke('importId:add', { entries, downloadPdf: download }));
      invalidateAll();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const anyOffline = items?.some((it) => it.state === 'offline') ?? false;
  const canDownload = items?.some((it, i) => chosen.has(i) && it.canDownload) ?? false;

  return (
    <Dialog title={t('importId.title')} onClose={onClose} testId="id-dialog">
      <div className="dlg-scroll id-dialog">
        {error && <ErrorNote testId="id-error">{error}</ErrorNote>}
        {result === null && (
          <>
            <TextAreaField label={t('importId.field')} hint={t('importId.hint')} rows={4} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} data-testid="id-text" />
            <div>
              <Button variant={items === null ? 'primary' : 'secondary'} busy={busy && items === null} disabled={text.trim() === ''} onClick={() => void find()} data-testid="id-find">
                {t('importId.find')}
              </Button>
            </div>
          </>
        )}
        {items && result === null && (
          <ul className="id-results" data-testid="id-results">
            {items.map((it, i) => (
              <li key={`${i}:${it.input}`} data-testid="id-result" data-state={it.state}>
                {it.state === 'recognized' ? (
                  <input
                    type="checkbox"
                    aria-label={t('importId.pick', { title: safeText(it.metadata?.title ?? it.input) })}
                    checked={chosen.has(i)}
                    onChange={(e) => setChosen((s) => (e.target.checked ? new Set(s).add(i) : new Set([...s].filter((x) => x !== i))))}
                    data-testid="id-pick"
                  />
                ) : (
                  <span style={{ width: '1rem' }} />
                )}
                <div className="id-results__body">
                  <Chip kind="status" tone={TONE[it.state]}>
                    {t(`importId.state.${it.state}`)}
                  </Chip>{' '}
                  <strong>{safeText(it.metadata?.title ?? it.existing?.title ?? it.input)}</strong>
                  {it.metadata && (
                    <div className="id-results__meta">
                      {safeText([it.metadata.authors.slice(0, 3).join(', '), it.metadata.year, it.metadata.venue].filter(Boolean).join(' · ') || t('importId.noTitle'))}
                    </div>
                  )}
                  {it.reason && it.state !== 'recognized' && <div className="id-results__meta">{t(`importId.reason.${it.reason}`, { defaultValue: '' })}</div>}
                  {it.state === 'in-library' && it.existing?.kind === 'document' && (
                    <button type="button" className="link" onClick={() => (onClose(), openReader(it.existing!.id))} data-testid="id-open-existing">
                      {t('importId.openExisting')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {anyOffline && result === null && (
          <div>
            <p className="hint" data-testid="id-offline">
              {t('importId.offlineHint')}
            </p>
            <Button busy={busy} onClick={() => void find()} data-testid="id-retry">
              {t('importId.retry')}
            </Button>
          </div>
        )}
        {items && result === null && chosen.size > 0 && (
          <>
            {canDownload && <CheckField label={t('importId.download')} hint={t('importId.downloadHint')} checked={download} onChange={(e) => setDownload(e.target.checked)} data-testid="id-download" />}
            <p className="hint">{t('importId.noFileNote')}</p>
          </>
        )}
        {result && (
          <div data-testid="id-result-summary" role="status">
            <p>{t('importId.result', { added: result.added, skipped: result.skipped })}</p>
            {result.queued > 0 && <p>{t('importId.resultQueued', { count: result.queued })}</p>}
            {result.failedDownloads > 0 && <p>{t('importId.resultFailed', { count: result.failedDownloads })}</p>}
          </div>
        )}
      </div>
      <div className="actions dlg-foot">
        {result ? (
          <>
            {result.queued > 0 && (
              <Button onClick={() => (onClose(), openInbox())} data-testid="id-open-inbox">
                {t('importId.openInbox')}
              </Button>
            )}
            <Button variant="primary" onClick={onClose} data-testid="id-close">
              {t('common.close')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" busy={busy && items !== null} disabled={chosen.size === 0} onClick={() => void add()} data-testid="id-add">
              {t('importId.add', { count: chosen.size })}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

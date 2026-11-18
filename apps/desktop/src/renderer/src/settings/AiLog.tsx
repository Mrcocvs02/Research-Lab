import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useReader } from '../lib/reader';
import { safeText } from '../views/library/safeText';
import { formatTokens, formatUsd } from '../views/chat/format';
import { useDocTitle } from '../views/chat/useLabels';
import './settings.css';

type Send = ResponseOf<Channels, 'ai:log'>['items'][number];

const PAGE = 50;
const MAX_DOCS = 3;

function DocLink({ docId }: { docId: string }) {
  const { openReader } = useReader();
  const title = useDocTitle(docId);
  return (
    <button type="button" className="link" onClick={() => openReader(docId)} data-testid="log-doc">
      {safeText(title ?? docId.slice(0, 8))}
    </button>
  );
}

/** The log of what was sent to the AI: when, which model, why, which documents, how many tokens and what it cost. */
export function AiLog({ reloadKey }: { reloadKey: unknown }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Send[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (before?: string) => {
    setError(null);
    try {
      const r = await rl.invoke('ai:log', { limit: PAGE, ...(before ? { before } : {}) });
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items));
      setMore(r.items.length === PAGE);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <div data-testid="ai-log" data-set="aiLog">
      <p className="set-help">{t('settings.ai.log.hint')}</p>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {items?.length === 0 && <p className="hint">{t('settings.ai.log.empty')}</p>}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>{t('settings.ai.log.date')}</th>
                <th>{t('settings.ai.log.model')}</th>
                <th>{t('settings.ai.log.purpose')}</th>
                <th>{t('settings.ai.log.documents')}</th>
                <th>{t('settings.ai.log.tokens')}</th>
                <th>{t('settings.ai.log.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr key={`${s.at}-${i}`} data-testid="log-row">
                  <td>{when(s.at)}</td>
                  <td>{safeText(s.model)}</td>
                  <td>{safeText(s.purpose)}</td>
                  <td>
                    {s.docIds.slice(0, MAX_DOCS).map((id) => (
                      <DocLink key={id} docId={id} />
                    ))}
                    {s.docIds.length > MAX_DOCS && <span className="hint"> {t('settings.ai.log.moreDocs', { count: s.docIds.length - MAX_DOCS })}</span>}
                  </td>
                  <td>
                    {formatTokens(s.approxInputTokens)}
                    {s.approxOutputTokens !== undefined ? ` / ${formatTokens(s.approxOutputTokens)}` : ''}
                  </td>
                  <td>{s.estimatedCostUsd !== undefined ? formatUsd(s.estimatedCostUsd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && items && items.length > 0 && (
        <div className="actions start">
          <button type="button" onClick={() => void load(items[items.length - 1]!.at)} data-testid="log-more">
            {t('settings.ai.log.more')}
          </button>
        </div>
      )}
    </div>
  );
}

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { useHistory } from '../../lib/history';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { openExternal, workLink } from '../../lib/workLinks';
import { safeText } from '../library/safeText';

type Check = ResponseOf<Channels, 'watch:checkPublished'>;
type Proposal = Check['proposals'][number];

/**
 * "Published": preprints of the library for which a published version was found. Looking is a network call made only
 * on request; nothing changes until the user confirms a proposal (one logged change, with an undo in the notice).
 */
export function Published() {
  const { t } = useTranslation();
  const { info, reportError } = useNotify();
  const { invalidate } = useLibraryEvents();
  const history = useHistory();
  const [ownOnly, setOwnOnly] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ownId = useId();

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await rl.invoke('watch:checkPublished', { ownOnly });
      setResult(r);
      setProposals(r.proposals);
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };

  const confirm = async (p: Proposal) => {
    setApplying(p.docId);
    try {
      const r = await rl.invoke('watch:applyPublished', {
        docId: p.docId,
        doi: p.found.doi,
        venue: p.found.venue,
        venueRef: p.found.venueRef,
        year: p.found.year,
        source: p.found.source,
        expectedRevision: p.revision,
      });
      setProposals((cur) => cur.filter((x) => x.docId !== p.docId));
      invalidate('documents');
      info(t('discover.published.applied', { title: safeText(p.title?.trim() || t('citations.untitled')) }), { label: t('discover.published.undo'), run: () => void history.undo(r.changeId) });
    } catch (e) {
      reportError(e);
    } finally {
      setApplying(null);
    }
  };

  const none = t('discover.published.none');
  return (
    <div data-testid="discover-published">
      <p className="hint">{t('discover.published.intro')}</p>
      <div className="discover-bar">
        <div className="check">
          <input id={ownId} type="checkbox" checked={ownOnly} onChange={(e) => setOwnOnly(e.target.checked)} aria-describedby={`${ownId}-hint`} data-testid="published-own-only" />
          <label htmlFor={ownId}>{t('discover.published.ownOnly')}</label>
          <p className="hint" id={`${ownId}-hint`}>
            {t('discover.published.ownOnlyHint')}
          </p>
        </div>
        <button type="button" className="primary" onClick={() => void check()} disabled={checking} data-testid="published-check">
          {checking ? t('discover.published.checking') : t('discover.published.check')}
        </button>
      </div>
      {error !== null && <ErrorNote testId="published-error">{errorMessage(error, t)}</ErrorNote>}
      {result === null && error === null && <p className="hint">{t('discover.published.notChecked')}</p>}
      {result && (
        <p role="status" data-testid="published-summary">
          {t('discover.published.checked', { checked: result.checked, count: result.proposals.length, failed: result.failed })}
        </p>
      )}
      {result && proposals.length === 0 && (
        <p className="empty" data-testid="published-empty">
          {t('discover.published.empty')}
        </p>
      )}
      <ul className="work-list">
        {proposals.map((p) => {
          const title = safeText(p.title?.trim() || t('citations.untitled'));
          const link = workLink({ doi: p.found.doi });
          return (
            <li key={p.docId} className="work-row" data-testid="published-item" data-doc-id={p.docId}>
              <span className="work-title">{title}</span>
              <dl className="proposal-grid">
                <dt />
                <dd>
                  <strong>{t('discover.published.current')}</strong>
                </dd>
                <dd>
                  <strong>{t('discover.published.found')}</strong>
                </dd>
                <dt>{t('discover.published.doi')}</dt>
                <dd data-testid="published-current-doi">{safeText(p.current.doi ?? none)}</dd>
                <dd data-testid="published-found-doi">{safeText(p.found.doi)}</dd>
                <dt>{t('discover.published.venue')}</dt>
                <dd>{safeText(p.current.venue ?? none)}</dd>
                <dd>{safeText(p.found.venue ?? none)}</dd>
                <dt>{t('discover.published.year')}</dt>
                <dd>{p.current.year ?? none}</dd>
                <dd>{p.found.year ?? none}</dd>
                <dt>{t('discover.published.source')}</dt>
                <dd />
                <dd>{p.found.source}</dd>
              </dl>
              <div className="work-actions">
                <button type="button" className="primary" onClick={() => void confirm(p)} disabled={applying !== null} aria-label={`${t('discover.published.confirm')}: ${title}`} data-testid="published-confirm">
                  {applying === p.docId ? t('discover.published.confirming') : t('discover.published.confirm')}
                </button>
                {link && (
                  <button type="button" className="link" onClick={() => void openExternal(link.url).catch(reportError)} aria-label={t('citations.openExternal', { target: t('citations.openDoi'), title })} data-testid="published-open">
                    {t('citations.openDoi')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

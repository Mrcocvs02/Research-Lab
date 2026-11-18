import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { useHistory } from '../../lib/history';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { openWork, workLink } from '../../lib/workLinks';
import { safeText } from '../library/safeText';
import { useWatchOp } from './watchOps';
import '../citations/citations.css';
import './discover.css';

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
  const op = useWatchOp<Check>('checkPublished');
  const { running: checking, result, error } = op;
  const proposals = result?.proposals ?? [];
  const [applying, setApplying] = useState<string | null>(null);
  const ownId = useId();

  const check = () => void op.run(() => rl.invoke('watch:checkPublished', { ownOnly }));

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
      op.patch((r) => ({ ...r, proposals: r.proposals.filter((x) => x.docId !== p.docId) }));
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
        <button type="button" className="primary" onClick={check} disabled={checking} data-testid="published-check">
          {checking ? t('discover.published.checking') : t('discover.published.check')}
        </button>
      </div>
      {checking && (
        <p role="status" data-testid="published-progress">
          {op.progress ? t('discover.published.progress', { done: op.progress.done, total: op.progress.total }) : t('discover.published.checking')}{' '}
          <button type="button" className="link" onClick={() => void op.cancel()} disabled={op.cancelling} data-testid="published-cancel">
            {t('discover.cancel')}
          </button>
        </p>
      )}
      {error !== null && !checking && <ErrorNote testId="published-error">{errorMessage(error, t)}</ErrorNote>}
      {result === null && error === null && !checking && <p className="hint">{t('discover.published.notChecked')}</p>}
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
              {p.ownedBy && (
                <p className="hint" data-testid="published-owned">
                  {t('discover.published.alreadyOwned')}
                </p>
              )}
              <div className="work-actions">
                <button type="button" className="primary" onClick={() => void confirm(p)} disabled={applying !== null || Boolean(p.ownedBy)} aria-label={`${t('discover.published.confirm')}: ${title}`} data-testid="published-confirm">
                  {applying === p.docId ? t('discover.published.confirming') : t('discover.published.confirm')}
                </button>
                {link && (
                  <button type="button" className="link" onClick={() => void openWork(link).catch(reportError)} aria-label={t('citations.openExternal', { target: t('citations.openDoi'), title })} data-testid="published-open">
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

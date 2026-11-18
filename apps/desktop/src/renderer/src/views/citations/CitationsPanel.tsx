import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { RlError } from '../../lib/rl-error';
import { useCitationJob } from '../../lib/citationJobs';
import { rl } from '../../lib/rl';
import { WorkRow } from './WorkRow';
import './citations.css';

type View = ResponseOf<Channels, 'citations:get'>;
type Link = View['references'][number];

const PAGE = 50;

function Links({ links, testId, empty, title }: { links: readonly Link[]; testId: string; empty: string; title: string }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(PAGE);
  const headId = useId();
  return (
    <section aria-labelledby={headId} data-testid={`${testId}-list`}>
      <h4 id={headId}>{title}</h4>
      {links.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <>
          <ul className="work-list">
            {links.slice(0, shown).map((l, i) => (
              <WorkRow key={`${l.externalId ?? l.doi ?? l.arxivId ?? ''}-${i}`} testId={testId} title={l.title} authors={l.authors} year={l.year} venue={l.venue} ids={l} matched={l.matched} />
            ))}
          </ul>
          {links.length > shown && (
            <button type="button" className="link" onClick={() => setShown(shown + PAGE)} data-testid={`${testId}-more`}>
              {t('citations.more', { count: links.length - shown })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * References and "cited by" of one document (lazy). What is stored is shown offline; the network is used only by
 * "Refresh". A work in the library opens the document; the others link to their DOI or arXiv page.
 */
export function CitationsPanel({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { version } = useCitationJob();
  const current = useRef(docId);
  current.current = docId;

  // Another document has its own refresh state (a refresh of the previous one may still be running).
  useEffect(() => setBusy(false), [docId]);

  useEffect(() => {
    let live = true;
    setView(null);
    setError(null);
    rl.invoke('citations:get', { docId }).then(
      (v) => live && setView(v),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [docId, version]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const asked = docId;
    try {
      const v = await rl.invoke('citations:refresh', { docId });
      if (current.current === asked) setView(v);
    } catch (e) {
      if (current.current === asked) setError(e);
    } finally {
      if (current.current === asked) setBusy(false);
    }
  }, [docId]);

  const checked = view ? [view.referencesCheckedAt, view.citedByCheckedAt].filter((d): d is string => d !== null).sort().pop() : undefined;
  const notFound = error !== null && RlError.from(error).code === 'NOT_FOUND';

  return (
    <div className="citations-panel" data-testid="citations-panel" aria-busy={busy || (view === null && error === null)}>
      <div className="citations-head">
        <button type="button" onClick={() => void refresh()} disabled={busy || (view === null && error === null)} title={t('citations.refreshHint')} data-testid="citations-refresh">
          {busy ? t('citations.refreshing') : t('citations.refresh')}
        </button>
        {view?.fetched && (
          <>
            <span data-testid="citations-summary">{t('citations.summary', { inLibrary: view.inLibrary, missing: view.missing })}</span>
            {view.citedByCount !== null && <span data-testid="citations-count">{t('citations.citedByCount', { count: view.citedByCount })}</span>}
            {checked && (
              <span className="hint" data-testid="citations-checked">
                {t('citations.checkedAt', { date: checked.slice(0, 10) })}
              </span>
            )}
          </>
        )}
      </div>
      {error !== null && <ErrorNote testId="citations-error">{notFound ? t('citations.notFound') : errorMessage(error, t)}</ErrorNote>}
      {view === null && error === null && (
        <p className="hint" role="status">
          {t('citations.loading')}
        </p>
      )}
      {view && !view.fetched && (
        <p className="hint" data-testid="citations-empty">
          {t('citations.neverFetched')}
        </p>
      )}
      {view?.fetched && (
        <>
          <Links key={`ref-${docId}`} links={view.references} testId="citation-ref" title={t('citations.references', { count: view.references.length })} empty={t('citations.emptyRefs')} />
          <Links key={`by-${docId}`} links={view.citedBy} testId="citation-citedby" title={t('citations.citedBy', { count: view.citedBy.length })} empty={t('citations.emptyCitedBy')} />
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { useDocTitle } from '../chat/useLabels';
import { safeText } from '../library/safeText';

type Similar = ResponseOf<Channels, 'graph:similar'>['items'][number];
type Pair = ResponseOf<Channels, 'graph:surprising'>['pairs'][number];

export function DocLink({ docId, onOpen }: { docId: string; onOpen(docId: string): void }) {
  const title = useDocTitle(docId);
  return (
    <button type="button" className="link sim-title" onClick={() => onOpen(docId)} data-testid="sim-open" data-doc-id={docId}>
      {safeText(title ?? docId.slice(0, 8))}
    </button>
  );
}

function SimilarRow({ item, tagLabel, onOpen }: { item: Similar; tagLabel(id: string): string; onOpen(docId: string): void }) {
  const { t } = useTranslation();
  const { tags, citations, terms } = item.shared;
  return (
    <li className="sim-row" data-testid="similar-item" data-doc-id={item.docId}>
      <DocLink docId={item.docId} onOpen={onOpen} />
      <span className="badge" title={t('network.similar.score')}>
        {Math.round(item.score * 100)}%
      </span>
      <span className="sim-reasons">
        {item.reasons.map((r) => (
          <span key={r} className="badge" data-reason={r}>
            {t(`network.reason.${r}`)}
          </span>
        ))}
      </span>
      {(tags.length > 0 || citations > 0 || terms.length > 0) && (
        <span className="hint sim-shared">
          {tags.length > 0 && <span data-testid="shared-tags">{t('network.similar.sharedTags', { tags: tags.map((x) => safeText(tagLabel(x))).join(', ') })}. </span>}
          {citations > 0 && <span data-testid="shared-citations">{t('network.similar.sharedCitations', { count: citations })}. </span>}
          {terms.length > 0 && <span data-testid="shared-terms">{t('network.similar.sharedTerms', { terms: terms.map(safeText).join(', ') })}.</span>}
        </span>
      )}
    </li>
  );
}

function Terms({ pair }: { pair: Pair }) {
  const { t } = useTranslation();
  return pair.terms.length > 0 ? <span className="hint">{t('network.similar.sharedTerms', { terms: pair.terms.map(safeText).join(', ') })}</span> : null;
}

/**
 * Close papers of one document: the most similar ones with the reasons (text, citations, tags) and what they share, and
 * the ones that are close in content but do not look it (no shared tag, citation or folder). Loads when mounted, so the
 * document card pays nothing until the section is opened.
 */
export function SimilarPanel({ docId, tagLabel = (id) => id, onOpen }: { docId: string; tagLabel?: (id: string) => string; onOpen(docId: string): void }) {
  const { t } = useTranslation();
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setSimilar(null);
    setPairs(null);
    setError(null);
    rl.invoke('graph:similar', { docId, limit: 10 }).then(
      (r) => live && setSimilar(r.items),
      (e: unknown) => live && setError(e),
    );
    rl.invoke('graph:surprising', { docId, limit: 10 }).then(
      (r) => live && setPairs(r.pairs),
      () => live && setPairs([]),
    );
    return () => {
      live = false;
    };
  }, [docId]);

  return (
    <div className="similar-panel" data-testid="similar-panel">
      {error ? <ErrorNote testId="similar-error">{errorMessage(error, t)}</ErrorNote> : null}
      {!similar && !error && <p className="hint">{t('common.loading')}</p>}
      {similar && similar.length === 0 && <p className="hint" data-testid="similar-empty">{t('network.similar.none')}</p>}
      {similar && similar.length > 0 && (
        <ul className="sim-list" data-testid="similar-list">
          {similar.map((s) => (
            <SimilarRow key={s.docId} item={s} tagLabel={tagLabel} onOpen={onOpen} />
          ))}
        </ul>
      )}
      <h4>{t('network.similar.surprisingTitle')}</h4>
      <p className="hint">{t('network.similar.surprisingHint')}</p>
      {pairs && pairs.length === 0 && <p className="hint" data-testid="surprising-empty">{t('network.similar.noSurprising')}</p>}
      {pairs && pairs.length > 0 && (
        <ul className="sim-list" data-testid="surprising-list">
          {pairs.map((p) => (
            <li key={`${p.a}${p.b}`} className="sim-row" data-testid="surprising-item">
              <DocLink docId={p.a === docId ? p.b : p.a} onOpen={onOpen} />
              <span className="badge">{Math.round(p.score * 100)}%</span>
              <Terms pair={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The strongest "close but do not look it" pairs of the whole library. */
export function SurprisingList({ onOpen }: { onOpen(docId: string): void }) {
  const { t } = useTranslation();
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    rl.invoke('graph:surprising', { limit: 50 }).then(
      (r) => live && setPairs(r.pairs),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="net-tab surprising-tab" data-testid="surprising-panel">
      <p className="hint">{t('network.similar.surprisingHint')}</p>
      {error ? <ErrorNote testId="surprising-error">{errorMessage(error, t)}</ErrorNote> : null}
      {!pairs && !error && <p className="hint">{t('common.loading')}</p>}
      {pairs && pairs.length === 0 && <p className="hint" data-testid="surprising-empty">{t('network.similar.noSurprising')}</p>}
      {pairs && pairs.length > 0 && (
        <ol className="sim-list pair-list" data-testid="surprising-all">
          {pairs.map((p) => (
            <li key={`${p.a}${p.b}`} className="sim-row" data-testid="surprising-pair">
              <DocLink docId={p.a} onOpen={onOpen} />
              <span aria-hidden="true">↔</span>
              <DocLink docId={p.b} onOpen={onOpen} />
              <span className="badge">{Math.round(p.score * 100)}%</span>
              <Terms pair={p} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

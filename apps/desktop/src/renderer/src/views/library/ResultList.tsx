import { useTranslation } from 'react-i18next';
import { Snippet } from './Snippet';
import type { SearchResults } from './useSearch';

type Hit = SearchResults['hits'][number];

/** One search result: title, authors, year, snippet with the matches marked, pages where the text matched. */
export function ResultItem({ hit }: { hit: Hit }) {
  const { t } = useTranslation();
  const authors = hit.authors.slice(0, 3).join(', ') + (hit.authors.length > 3 ? ' …' : '');
  const meta = [authors, hit.year, hit.type].filter((x) => x !== '' && x !== null && x !== undefined);
  return (
    <li className="result" data-testid="search-result" data-doc-id={hit.docId}>
      <h3 className="result-title" data-testid="result-title">
        {hit.title ?? t('search.untitled')}
      </h3>
      {meta.length > 0 && <p className="result-meta">{meta.join(' · ')}</p>}
      {hit.snippet && (
        <p className="result-snippet" data-testid="result-snippet" data-field={hit.field}>
          <Snippet text={hit.snippet} />
        </p>
      )}
      {hit.pages && hit.pages.length > 0 && (
        <p className="result-pages" data-testid="result-pages">
          <span className="result-pages-label">{t('search.pagesLabel')}</span>{' '}
          {hit.pages.map((p) => (
            <span key={p.page} className="page-chip" data-page={p.page} title={p.snippet.replace(/\[\[|\]\]/g, '')}>
              {t('search.page', { page: p.page })}
            </span>
          ))}
        </p>
      )}
      <p className="result-path" data-testid="result-path">
        {hit.path}
      </p>
    </li>
  );
}

export function ResultList({ hits }: { hits: Hit[] }) {
  return (
    <ol className="results" data-testid="search-results">
      {hits.map((h) => (
        <ResultItem key={h.docId} hit={h} />
      ))}
    </ol>
  );
}

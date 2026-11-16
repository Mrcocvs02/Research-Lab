import { useTranslation } from 'react-i18next';
import type { SearchFilters } from '@rl/core';
import { safeText } from './safeText';
import type { SearchFacetsData } from './useSearch';

type Facet = 'tags' | 'authors' | 'types' | 'venues' | 'studyStates' | 'years' | 'folders';
const FACETS: Facet[] = ['tags', 'authors', 'types', 'venues', 'studyStates', 'years', 'folders'];

function isSelected(filters: SearchFilters, facet: Facet, value: string): boolean {
  switch (facet) {
    case 'years':
      return filters.yearFrom === Number(value) && filters.yearTo === Number(value);
    case 'studyStates':
      return (filters.studyStates ?? []).includes(value as 'read');
    default:
      return (filters[facet] ?? []).includes(value);
  }
}

/** Adds or removes one facet value from the filters (a year selects that single year). */
export function toggleFilter(filters: SearchFilters, facet: Facet, value: string): SearchFilters {
  const next: SearchFilters = { ...filters };
  if (facet === 'years') {
    if (isSelected(filters, facet, value)) {
      delete next.yearFrom;
      delete next.yearTo;
    } else {
      next.yearFrom = Number(value);
      next.yearTo = Number(value);
    }
    return next;
  }
  const list = (filters[facet] ?? []) as string[];
  const updated = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  if (updated.length === 0) delete next[facet];
  else (next as Record<string, unknown>)[facet] = updated;
  return next;
}

export const hasFilters = (f: SearchFilters) => Object.keys(f).length > 0;

/** Simple facets: counts per tag, author, type, venue, study state, year and top-level folder; click to filter. */
export function Facets({ facets, filters, onChange }: { facets: SearchFacetsData | null; filters: SearchFilters; onChange(next: SearchFilters): void }) {
  const { t } = useTranslation();
  if (!facets) return null;
  const labelOf = (facet: Facet, b: { value: string; label?: string | undefined }) =>
    facet === 'studyStates' ? t(`search.study.${b.value}`, { defaultValue: b.value }) : safeText(b.label ?? b.value);
  return (
    <aside className="facets" aria-label={t('search.filters')} data-testid="search-facets">
      <div className="facets-head">
        <h2>{t('search.filters')}</h2>
        {hasFilters(filters) && (
          <button type="button" className="link" onClick={() => onChange({})} data-testid="search-clear-filters">
            {t('search.clearFilters')}
          </button>
        )}
      </div>
      {FACETS.map((facet) => {
        const buckets = facets[facet];
        if (buckets.length === 0) return null;
        return (
          <fieldset key={facet} className="facet" data-testid={`facet-${facet}`}>
            <legend>{t(`search.facet.${facet}`)}</legend>
            <ul>
              {buckets.slice(0, 12).map((b) => (
                <li key={b.value}>
                  <label>
                    <input type="checkbox" checked={isSelected(filters, facet, b.value)} onChange={() => onChange(toggleFilter(filters, facet, b.value))} />
                    <span className="facet-name">{labelOf(facet, b)}</span>
                    <span className="facet-count">{b.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </aside>
  );
}

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchFilters } from '@rl/core';
import { safeText } from './safeText';
import type { SearchFacetsData } from './useDocumentList';

export type Facet = 'tags' | 'authors' | 'types' | 'venues' | 'studyStates' | 'years' | 'folders';
/** Tags and folders have their own panes; the facets panel covers the rest. */
const SHOWN: Facet[] = ['studyStates', 'types', 'authors', 'venues', 'years'];

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
export function toggleFilter<F extends SearchFilters>(filters: F, facet: Facet, value: string): F {
  const next: F = { ...filters };
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

function YearRange({ filters, onChange }: { filters: SearchFilters; onChange(next: SearchFilters): void }) {
  const { t } = useTranslation();
  const fromId = useId();
  const toId = useId();
  const [from, setFrom] = useState(filters.yearFrom?.toString() ?? '');
  const [to, setTo] = useState(filters.yearTo?.toString() ?? '');
  useEffect(() => {
    setFrom(filters.yearFrom?.toString() ?? '');
    setTo(filters.yearTo?.toString() ?? '');
  }, [filters.yearFrom, filters.yearTo]);
  const commit = () => {
    const next: SearchFilters = { ...filters };
    const a = Number.parseInt(from, 10);
    const b = Number.parseInt(to, 10);
    if (Number.isFinite(a) && a >= 1000 && a <= 3000) next.yearFrom = a;
    else delete next.yearFrom;
    if (Number.isFinite(b) && b >= 1000 && b <= 3000) next.yearTo = b;
    else delete next.yearTo;
    if (next.yearFrom !== filters.yearFrom || next.yearTo !== filters.yearTo) onChange(next);
  };
  return (
    <div className="year-range" data-testid="year-range">
      <label htmlFor={fromId}>{t('filter.yearFrom')}</label>
      <input id={fromId} type="number" min={1000} max={3000} value={from} onChange={(e) => setFrom(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} data-testid="year-from" />
      <label htmlFor={toId}>{t('filter.yearTo')}</label>
      <input id={toId} type="number" min={1000} max={3000} value={to} onChange={(e) => setTo(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} data-testid="year-to" />
    </div>
  );
}

/** Counts per study state, type, author, venue and year for the current result; a click adds the value as a filter. */
export function Facets<F extends SearchFilters>({ facets, filters, onChange }: { facets: SearchFacetsData | null; filters: F; onChange(next: F): void }) {
  const { t } = useTranslation();
  if (!facets) return null;
  const labelOf = (facet: Facet, b: { value: string; label?: string | undefined }) =>
    facet === 'studyStates' ? t(`search.study.${b.value}`, { defaultValue: b.value }) : safeText(b.label ?? b.value);
  return (
    <div className="facets" aria-label={t('search.filters')} data-testid="search-facets">
      {SHOWN.map((facet) => {
        const buckets = facets[facet];
        if (buckets.length === 0 && facet !== 'years') return null;
        return (
          <fieldset key={facet} className="facet" data-testid={`facet-${facet}`}>
            <legend>{t(`search.facet.${facet}`)}</legend>
            {facet === 'years' && <YearRange filters={filters} onChange={(f) => onChange(f as F)} />}
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
    </div>
  );
}

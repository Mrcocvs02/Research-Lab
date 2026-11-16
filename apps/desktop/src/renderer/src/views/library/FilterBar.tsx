import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchFilters } from '@rl/core';
import { setTagFilter, type BrowseState, type TagMode } from './docQuery';
import { safeText } from './safeText';
import { TagChip, TagPicker } from './TagParts';
import { resolveId } from './taxonomyModel';
import { useTaxonomy } from './useTaxonomy';

/**
 * Tag filter: tags to include (with "all of them" / "at least one"), tags to exclude, each chosen with the
 * completion of the taxonomy. It combines with the text, the folder and the other filters.
 */
export function TagFilterBar({ tags, onChange }: { tags: BrowseState['tags']; onChange(next: BrowseState['tags']): void }) {
  const { t } = useTranslation();
  const { model, colorOf, labelOf } = useTaxonomy();
  const groupId = useId();
  const taken = useMemo(() => new Set([...tags.include, ...tags.exclude]), [tags]);
  const chip = (id: string, excluded: boolean) => {
    const node = model.byId.get(resolveId(model, id));
    return (
      <TagChip
        key={`${excluded ? 'x' : 'i'}-${id}`}
        id={id}
        testId={excluded ? 'filter-tag-excluded' : 'filter-tag'}
        label={excluded ? t('filter.not', { name: labelOf(id) }) : labelOf(id)}
        color={excluded ? undefined : colorOf(id)}
        deprecated={node?.status === 'deprecated'}
        excluded={excluded}
        removeLabel={t('search.removeFilter', { name: labelOf(id) })}
        onRemove={() => onChange(setTagFilter(tags, id, null))}
      />
    );
  };
  return (
    <div className="tag-filter" data-testid="tag-filter">
      <span className="tag-filter-label">{t('filter.tags')}</span>
      {tags.include.map((id) => chip(id, false))}
      {tags.exclude.map((id) => chip(id, true))}
      {tags.include.length > 1 && (
        <div className="radio-row" role="radiogroup" aria-label={t('filter.mode')} id={groupId}>
          {(['all', 'any'] as TagMode[]).map((m) => (
            <label key={m} className="radio-chip">
              <input type="radio" name={`tag-mode-${groupId}`} checked={tags.mode === m} onChange={() => onChange({ ...tags, mode: m })} data-testid={`tag-mode-${m}`} />
              <span>{t(`filter.mode_${m}`)}</span>
            </label>
          ))}
        </div>
      )}
      <TagPicker model={model} exclude={taken} ariaLabel={t('filter.include')} placeholder={t('filter.includePlaceholder')} onPick={(id) => onChange(setTagFilter(tags, id, 'include'))} testId="filter-include-input" />
      <TagPicker model={model} exclude={taken} ariaLabel={t('filter.exclude')} placeholder={t('filter.excludePlaceholder')} onPick={(id) => onChange(setTagFilter(tags, id, 'exclude'))} testId="filter-exclude-input" />
    </div>
  );
}

type FacetFilters = BrowseState['filters'];

/** One removable chip for every facet filter and the folder that is in force. */
export function ActiveFilters({ filters, folder, includeSub, onFilters, onFolder, onClearAll, anything }: {
  filters: FacetFilters;
  folder: string | null;
  includeSub: boolean;
  onFilters(next: FacetFilters): void;
  onFolder(path: string | null): void;
  onClearAll(): void;
  anything: boolean;
}) {
  const { t } = useTranslation();
  const chips: Array<{ key: string; text: string; remove(): void }> = [];
  const list = (name: 'authors' | 'types' | 'venues', label: string) => {
    for (const v of filters[name] ?? []) {
      chips.push({
        key: `${name}:${v}`,
        text: `${label}: ${safeText(v)}`,
        remove: () => {
          const rest = (filters[name] ?? []).filter((x) => x !== v);
          const next: FacetFilters = { ...filters };
          if (rest.length === 0) delete next[name];
          else next[name] = rest;
          onFilters(next);
        },
      });
    }
  };
  list('authors', t('search.facet.authors'));
  list('types', t('search.facet.types'));
  list('venues', t('search.facet.venues'));
  for (const s of filters.studyStates ?? []) {
    chips.push({
      key: `study:${s}`,
      text: `${t('search.facet.studyStates')}: ${t(`study.${s}`)}`,
      remove: () => {
        const rest = (filters.studyStates ?? []).filter((x) => x !== s);
        const next: FacetFilters = { ...filters };
        if (rest.length === 0) delete next.studyStates;
        else next.studyStates = rest;
        onFilters(next);
      },
    });
  }
  if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    chips.push({
      key: 'years',
      text: `${t('search.facet.years')}: ${filters.yearFrom ?? '…'} – ${filters.yearTo ?? '…'}`,
      remove: () => {
        const next: FacetFilters = { ...filters };
        delete next.yearFrom;
        delete next.yearTo;
        onFilters(next);
      },
    });
  }
  if (folder !== null && !(folder === '' && includeSub)) {
    chips.push({
      key: 'folder',
      text: `${t('search.facet.folders')}: ${folder === '' ? t('folders.rootOnly') : safeText(folder)}${includeSub ? '' : ` (${t('folders.exact')})`}`,
      remove: () => onFolder(null),
    });
  }
  if (chips.length === 0 && !anything) return null;
  return (
    <div className="active-filters" data-testid="active-filters">
      {chips.map((c) => (
        <span key={c.key} className="filter-chip" data-testid="filter-chip">
          {c.text}
          <button type="button" className="tag-remove" aria-label={t('search.removeFilter', { name: c.text })} onClick={c.remove}>
            <span aria-hidden="true">×</span>
          </button>
        </span>
      ))}
      {anything && (
        <button type="button" className="link" onClick={onClearAll} data-testid="search-clear-filters">
          {t('search.clearFilters')}
        </button>
      )}
    </div>
  );
}

export type { SearchFilters };

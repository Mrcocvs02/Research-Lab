import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { IconChevronDown } from '../../components/icons';
import { Popover } from '../../components/Popover';
import { setTagFilter, withMissing, type BrowseState, type TagMode } from './docQuery';
import { toggleFilter, YearRange, type Facet } from './Facets';
import { safeText } from './safeText';
import { TagChip, TagPicker } from './TagParts';
import { resolveId } from './taxonomyModel';
import { useTaxonomy } from './useTaxonomy';
import type { SearchFacetsData } from './useDocumentList';

type FacetFilters = BrowseState['filters'];
type ChipFacet = Facet | 'tags';
/** The six facets of the filter row (17.3), in the order of the design. */
const CHIPS: ChipFacet[] = ['studyStates', 'types', 'years', 'venues', 'authors', 'tags'];

function isOn(filters: FacetFilters, facet: Facet, value: string): boolean {
  switch (facet) {
    case 'years':
      return filters.yearFrom === Number(value) && filters.yearTo === Number(value);
    case 'studyStates':
      return (filters.studyStates ?? []).includes(value as 'read');
    default:
      return ((filters as Record<string, string[] | undefined>)[facet] ?? []).includes(value);
  }
}

/** One chip of the row: its label and a chevron; a click opens the popover with the values of that facet in the result. */
function FacetChip({ id, active, children }: { id: ChipFacet; active: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} className="facet-chip" data-testid={`facet-chip-${id}`}>
      <Chip selected={active || open} onClick={() => setOpen(!open)}>
        {t(`library.facet.${id}`)}
        <IconChevronDown size={16} />
      </Chip>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={t(`library.facet.${id}`)} width={id === 'tags' ? 340 : 280}>
        <div className="lib-pop-body">{children}</div>
      </Popover>
    </span>
  );
}

function ValueList({ facet, data, filters, onChange }: { facet: Facet; data: SearchFacetsData | null; filters: FacetFilters; onChange(next: FacetFilters): void }) {
  const { t } = useTranslation();
  const buckets = data?.[facet] ?? [];
  const label = (b: { value: string; label?: string | undefined }) => (facet === 'studyStates' ? t(`search.study.${b.value}`, { defaultValue: b.value }) : safeText(b.label ?? b.value));
  return (
    <fieldset className="facet" data-testid={`facet-${facet}`}>
      {facet === 'years' && <YearRange filters={filters} onChange={onChange} />}
      {buckets.length === 0 && facet !== 'years' && <p className="hint">{t('library.facetEmpty')}</p>}
      <ul>
        {buckets.slice(0, 12).map((b) => (
          <li key={b.value}>
            <label>
              <input type="checkbox" checked={isOn(filters, facet, b.value)} onChange={() => onChange(toggleFilter(filters, facet, b.value))} />
              <span className="facet-name">{label(b)}</span>
              <span className="facet-count">{b.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Include and exclude pickers with the match mode: what the old tag row held, now behind the Tag chip. */
function TagPopover({ tags, onChange }: { tags: BrowseState['tags']; onChange(next: BrowseState['tags']): void }) {
  const { t } = useTranslation();
  const { model } = useTaxonomy();
  const groupId = useId();
  const included = useMemo(() => new Set(tags.include), [tags.include]);
  const excluded = useMemo(() => new Set(tags.exclude), [tags.exclude]);
  return (
    <div className="tag-filter-pop" data-testid="tag-filter">
      <TagPicker model={model} exclude={included} ariaLabel={t('filter.include')} placeholder={t('filter.includePlaceholder')} onPick={(id) => onChange(setTagFilter(tags, id, 'include'))} testId="filter-include-input" />
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
      <TagPicker model={model} exclude={excluded} ariaLabel={t('filter.exclude')} placeholder={t('filter.excludePlaceholder')} onPick={(id) => onChange(setTagFilter(tags, id, 'exclude'))} testId="filter-exclude-input" />
    </div>
  );
}

interface Props {
  facets: SearchFacetsData | null;
  browse: BrowseState;
  anything: boolean;
  onFilters(next: FacetFilters): void;
  onTags(next: BrowseState['tags']): void;
  onFolder(path: string | null): void;
  onClearAll(): void;
}

/**
 * The one row of filters (4.2, 17.3): six facet chips with their popovers, the active filters as removable chips, "Clear"
 * and "Show missing files". 8 controls at rest; the selection bar takes the place of the whole row.
 */
export function FacetBar({ facets, browse, anything, onFilters, onTags, onFolder, onClearAll }: Props) {
  const { t } = useTranslation();
  const { model, colorOf, labelOf } = useTaxonomy();
  const missingId = useId();
  const { filters, tags, folder, includeSub } = browse;
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
  const tagChip = (id: string, excluded: boolean) => {
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
        onRemove={() => onTags(setTagFilter(tags, id, null))}
      />
    );
  };
  const isActive = (id: ChipFacet): boolean => {
    if (id === 'tags') return tags.include.length + tags.exclude.length > 0;
    if (id === 'years') return filters.yearFrom !== undefined || filters.yearTo !== undefined;
    if (id === 'studyStates') return (filters.studyStates ?? []).length > 0;
    if (id === 'folders') return false;
    return (filters[id] ?? []).length > 0;
  };
  return (
    <div className="facet-bar" data-testid="facet-bar">
      <div className="facet-bar__chips" role="group" aria-label={t('search.filters')}>
        {CHIPS.map((id) => (
          <FacetChip key={id} id={id} active={isActive(id)}>
            {id === 'tags' ? <TagPopover tags={tags} onChange={onTags} /> : <ValueList facet={id} data={facets} filters={filters} onChange={onFilters} />}
          </FacetChip>
        ))}
        <div className="active-filters" data-testid="active-filters">
          {tags.include.map((id) => tagChip(id, false))}
          {tags.exclude.map((id) => tagChip(id, true))}
          {chips.map((c) => (
            <Chip key={c.key} selected onRemove={c.remove} removeLabel={t('search.removeFilter', { name: c.text })} className="filter-chip">
              <span data-testid="filter-chip">{c.text}</span>
            </Chip>
          ))}
        </div>
        {anything && (
          <Button size="sm" variant="ghost" onClick={onClearAll} data-testid="search-clear-filters">
            {t('library.clear')}
          </Button>
        )}
      </div>
      <div className="check facet-bar__missing">
        <input id={missingId} type="checkbox" checked={filters.includeMissing === true} onChange={(e) => onFilters(withMissing(filters, e.target.checked))} data-testid="show-missing" />
        <label htmlFor={missingId}>{t('library.missing')}</label>
      </div>
    </div>
  );
}

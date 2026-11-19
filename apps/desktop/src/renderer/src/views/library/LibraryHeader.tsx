import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { AddMenu } from './AddMenu';
import { IconButton } from '../../components/IconButton';
import { IconChevronDown, IconFolder, IconMore } from '../../components/icons';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { Segmented } from '../../components/Segmented';
import { useAiUi } from '../../lib/aiUi';
import { CARD_SIZES, type CardSize, type ViewMode } from './DocViews';
import { SORTS, type BrowseState } from './docQuery';
import { IconPanelRight } from './libraryIcons';

interface Props {
  count: number;
  view: ViewMode;
  onView(v: ViewMode): void;
  /** Size of the cards of the grid (S / M / L), offered with the grid. */
  cardSize: CardSize;
  onCardSize(s: CardSize): void;
  /** The sort in force (relevance only with a text). */
  sort: BrowseState['sort'];
  hasText: boolean;
  onSort(s: BrowseState['sort']): void;
  scanning: boolean;
  onScan(): void;
  onCancelScan(): void;
  onManageTags(): void;
  detailOpen: boolean;
  onDetail(open: boolean): void;
  /** Cartelle e Tag are a drawer below 900 px: the button that opens it (shown by the stylesheet only then). */
  navOpen: boolean;
  onNav(open: boolean): void;
}

/**
 * The view header (1.1, 4.2): title and count, then the four controls of the design — View, "+ Add PDF" (the one primary),
 * the menu and the details toggle, which is not an action and comes last.
 */
export function LibraryHeader({ count, view, onView, cardSize, onCardSize, sort, hasText, onSort, scanning, onScan, onCancelScan, onManageTags, detailOpen, onDetail, navOpen, onNav }: Props) {
  const { t } = useTranslation();
  const { openExport } = useAiUi();
  const viewAnchor = useRef<HTMLSpanElement>(null);
  const moreAnchor = useRef<HTMLSpanElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const shownSort = sort === 'relevance' && !hasText ? 'title' : sort;

  const more: MenuGroups = [
    {
      id: 'library',
      items: [
        { id: 'tags', label: t('library.manageTags'), onSelect: onManageTags },
        { id: 'export', label: t('secondBrain.button'), onSelect: () => openExport({}) },
        scanning ? { id: 'scan', label: t('scan.cancel'), onSelect: onCancelScan } : { id: 'scan', label: t('scan.start'), onSelect: onScan },
      ],
    },
  ];

  return (
    <header className="library-head">
      <IconButton label={t('library.navOpen')} variant="secondary" size="sm" pressed={navOpen} className="library-head__nav" onClick={() => onNav(!navOpen)} data-testid="nav-toggle">
        <IconFolder size={16} />
      </IconButton>
      <h1>{t('sections.library')}</h1>
      <span className="library-head__count" data-testid="search-summary">
        {t('search.results', { count })}
      </span>
      <div className="library-head__acts">
        <span ref={viewAnchor}>
          <Button aria-haspopup="dialog" aria-expanded={viewOpen} onClick={() => setViewOpen(!viewOpen)} data-testid="view-menu">
            {t('library.viewSummary', { view: t(`docs.view_${view}`), sort: t(`search.sorts.${shownSort}`) })}
            <IconChevronDown size={16} />
          </Button>
        </span>
        <Popover anchor={viewAnchor} open={viewOpen} onClose={() => setViewOpen(false)} label={t('library.viewPanel')} width={300} placement="bottom-end">
          <div className="lib-pop-body lib-view-pop">
            <Segmented<ViewMode>
              label={t('docs.view')}
              value={view}
              onChange={onView}
              options={[
                { value: 'list', label: t('docs.view_list'), testId: 'view-list' },
                { value: 'grid', label: t('docs.view_grid'), testId: 'view-grid' },
              ]}
            />
            {view === 'grid' && (
              <Segmented<CardSize>
                label={t('docs.cardSize')}
                value={cardSize}
                onChange={onCardSize}
                options={CARD_SIZES.map((s) => ({ value: s, label: t(`docs.size_${s}`), testId: `card-size-${s}` }))}
              />
            )}
            <label className="lib-view-pop__sort">
              <span>{t('search.sort')}</span>
              <select value={shownSort} onChange={(e) => onSort(e.target.value as BrowseState['sort'])} data-testid="search-sort">
                {SORTS.filter((s) => s !== 'relevance' || hasText).map((s) => (
                  <option key={s} value={s}>
                    {t(`search.sorts.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Popover>
        <AddMenu />
        <span ref={moreAnchor}>
          <IconButton label={t('library.more')} variant="secondary" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="library-more">
            <IconMore size={20} />
          </IconButton>
        </span>
        <Menu anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} groups={more} label={t('library.more')} width={280} />
        <IconButton label={t('library.detailToggle')} pressed={detailOpen} onClick={() => onDetail(!detailOpen)} data-testid="detail-toggle">
          <IconPanelRight size={20} />
        </IconButton>
      </div>
    </header>
  );
}

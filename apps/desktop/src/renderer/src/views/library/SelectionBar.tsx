import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { IconChevronDown, IconMore } from '../../components/icons';
import { IconClaude } from '../../components/icons-shell';
import { Lazy, lazyView } from '../../components/Lazy';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { useAiUi } from '../../lib/aiUi';
import { useCitationJob } from '../../lib/citationJobs';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { compareItem } from './selection/actions/compare';
import { extendItem } from './selection/actions/extend';
import { groupsItem } from './selection/actions/groups';
import { linksItem } from './selection/actions/links';
import { timelineItem } from './selection/actions/timeline';
import type { DocRow } from './useDocumentList';

// The comparison table and the group overview load their own chunk (and strings) the first time they are asked for.
const CompareView = lazyView(() => import('../compare/CompareView').then((m) => ({ default: m.CompareView })), ['compare']);
const GroupsDialog = lazyView(() => import('../groups/GroupsDialog').then((m) => ({ default: m.GroupsDialog })), ['groups']);
const LinkFinderDialog = lazyView(() => import('../links/LinkFinderDialog').then((m) => ({ default: m.LinkFinderDialog })), ['links']);

/** Several default-program windows at once are too many: the menu entry waits for a smaller selection. */
export const OPEN_MANY_MAX = 5;

interface Props {
  ids: string[];
  rows: DocRow[];
  /** The tag editor (lazy, loaded by the view): shown in the Tag popover. */
  tagEditor(close: () => void): React.ReactNode;
  onProject(): void;
  onPropose(): void;
  onLiterature(): void;
  onClear(): void;
}

/**
 * The bar that takes the place of the filter row when several documents are selected (3 of 1.1, 4.2): "N selected",
 * Tag, Project, Claude, the menu and "Clear selection" — five controls, one line at every width.
 */
export function SelectionBar({ ids, tagEditor, onProject, onPropose, onLiterature, onClear }: Props) {
  const { t } = useTranslation();
  const { openExport, setChatOpen } = useAiUi();
  const citationJob = useCitationJob();
  const { reportError } = useNotify();
  const { navigate } = useNav();
  const { openReader } = useReader();
  const tagAnchor = useRef<HTMLSpanElement>(null);
  const claudeAnchor = useRef<HTMLSpanElement>(null);
  const moreAnchor = useRef<HTMLSpanElement>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);

  const claude: MenuGroups = [
    {
      id: 'claude',
      items: [
        { id: 'propose', label: t('jobs.propose'), icon: <IconClaude size={16} />, testId: 'selection-propose', onSelect: onPropose },
        { id: 'literature', label: t('library.selLiterature'), icon: <IconClaude size={16} />, testId: 'selection-literature', onSelect: onLiterature },
        { ...compareItem(t, ids, () => setCompareOpen(true)), icon: <IconClaude size={16} /> },
        { ...groupsItem(t, ids, () => setGroupsOpen(true)), icon: <IconClaude size={16} /> },
        { id: 'ask', label: t('library.askClaude'), icon: <IconClaude size={16} />, onSelect: () => setChatOpen(true) },
      ],
    },
  ];
  const tooMany = ids.length > OPEN_MANY_MAX;
  // "Read side by side" (feature 3): exactly two documents, otherwise disabled with the reason.
  const side =
    ids.length === 2
      ? { id: 'side', testId: 'selection-side-by-side', label: t('library.selSideBySide'), onSelect: () => openReader(ids[0]!, undefined, { beside: ids[1]! }) }
      : { id: 'side', testId: 'selection-side-by-side', label: t('library.selSideBySide'), disabled: true as const, disabledReason: t('library.selSideReason'), onSelect: () => {} };
  const more: MenuGroups = [
    {
      id: 'more',
      items: [
        citationJob.busy
          ? { id: 'citations', label: t('citations.bulk'), disabled: true, disabledReason: t('citations.alreadyRunning'), onSelect: () => {} }
          : { id: 'citations', label: t('citations.bulk'), onSelect: () => void citationJob.start(ids) },
        { id: 'export', label: t('secondBrain.button'), onSelect: () => openExport({ docIds: ids }) },
        tooMany
          ? { id: 'open', label: t('library.openDefault'), disabled: true, disabledReason: t('library.openManyMax', { count: OPEN_MANY_MAX }), onSelect: () => {} }
          : {
              id: 'open',
              label: t('library.openDefault'),
              onSelect: () => {
                for (const docId of ids) void rl.invoke('documents:open', { docId }).catch(reportError);
              },
            },
      ],
    },
    { id: 'read', items: [side, timelineItem(t, ids, () => navigate({ view: 'map' }))] },
    { id: 'discover', items: [extendItem(t, ids, () => navigate({ view: 'discover' })), linksItem(t, () => setLinksOpen(true))] },
  ];

  return (
    <div className="selection-bar" data-testid="selection-bar" role="toolbar" aria-label={t('library.selectionActions')}>
      <b className="selection-bar__count" data-testid="selection-count">
        {t('docs.selected', { count: ids.length })}
      </b>
      <span ref={tagAnchor}>
        <Button size="sm" aria-haspopup="dialog" aria-expanded={tagOpen} onClick={() => setTagOpen(!tagOpen)} data-testid="bulk-tags-button">
          {t('library.selTag')}
          <IconChevronDown size={16} />
        </Button>
      </span>
      <Popover anchor={tagAnchor} open={tagOpen} onClose={() => setTagOpen(false)} label={t('bulk.editTags')} width={360}>
        <div className="lib-pop-body">
          <Lazy>{tagEditor(() => setTagOpen(false))}</Lazy>
        </div>
      </Popover>
      <Button size="sm" onClick={onProject} data-testid="add-to-project-button">
        {t('library.selProject')}
        <IconChevronDown size={16} />
      </Button>
      <span ref={claudeAnchor}>
        <Button size="sm" className="selection-bar__ai" aria-haspopup="menu" aria-expanded={claudeOpen} onClick={() => setClaudeOpen(!claudeOpen)} data-testid="bulk-claude">
          <IconClaude size={16} />
          {t('library.selClaude')}
          <IconChevronDown size={16} />
        </Button>
      </span>
      <Menu anchor={claudeAnchor} open={claudeOpen} onClose={() => setClaudeOpen(false)} groups={claude} label={t('library.selClaude')} placement="bottom-start" width={340} />
      <span ref={moreAnchor}>
        <IconButton label={t('library.rowMore')} variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="selection-more">
        <IconMore size={16} />
      </IconButton>
      </span>
      <Menu anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} groups={more} label={t('library.rowMore')} width={280} />
      {compareOpen && (
        <Lazy>
          <CompareView docIds={ids} onClose={() => setCompareOpen(false)} />
        </Lazy>
      )}
      {groupsOpen && (
        <Lazy>
          <GroupsDialog docIds={ids} onClose={() => setGroupsOpen(false)} />
        </Lazy>
      )}
      {linksOpen && (
        <Lazy>
          <LinkFinderDialog docIds={ids} onClose={() => setLinksOpen(false)} />
        </Lazy>
      )}
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="selection-clear">
        {t('docs.clearSelection')}
      </Button>
    </div>
  );
}

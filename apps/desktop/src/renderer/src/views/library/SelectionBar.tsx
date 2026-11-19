import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { IconChevronDown, IconMore } from '../../components/icons';
import { IconClaude } from '../../components/icons-shell';
import { Lazy } from '../../components/Lazy';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { useAiUi } from '../../lib/aiUi';
import { useCitationJob } from '../../lib/citationJobs';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { bridgeItem } from './selection/actions/bridge';
import { extendItem } from './selection/actions/extend';
import type { DocRow } from './useDocumentList';

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
  const { info, reportError } = useNotify();
  const { navigate } = useNav();
  const tagAnchor = useRef<HTMLSpanElement>(null);
  const claudeAnchor = useRef<HTMLSpanElement>(null);
  const moreAnchor = useRef<HTMLSpanElement>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const claude: MenuGroups = [
    {
      id: 'claude',
      items: [
        { id: 'propose', label: t('jobs.propose'), icon: <IconClaude size={16} />, onSelect: onPropose },
        { id: 'literature', label: t('library.selLiterature'), icon: <IconClaude size={16} />, testId: 'selection-literature', onSelect: onLiterature },
        { id: 'ask', label: t('library.askClaude'), icon: <IconClaude size={16} />, onSelect: () => setChatOpen(true) },
      ],
    },
  ];
  const tooMany = ids.length > OPEN_MANY_MAX;
  const more: MenuGroups = [
    {
      id: 'more',
      items: [
        citationJob.busy
          ? { id: 'citations', label: t('citations.bulk'), disabled: true, disabledReason: t('citations.alreadyRunning'), onSelect: () => {} }
          : { id: 'citations', label: t('citations.bulk'), onSelect: () => void citationJob.start(ids) },
        extendItem(t, ids, () => navigate({ view: 'discover' })),
        bridgeItem(t, ids, () => navigate({ view: 'discover' })),
        { id: 'export', label: t('secondBrain.button'), onSelect: () => openExport({ docIds: ids }) },
        {
          id: 'bibtex',
          testId: 'selection-copy-bib',
          label: t('library.copyBib'),
          onSelect: () =>
            void rl
              .invoke('bib:copy', { docIds: ids })
              .then((r) => info(t('library.copiedBib', { count: r.count })))
              .catch(reportError),
        },
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
      <Menu anchor={claudeAnchor} open={claudeOpen} onClose={() => setClaudeOpen(false)} groups={claude} label={t('library.selClaude')} placement="bottom-start" width={260} />
      <span ref={moreAnchor}>
        <IconButton label={t('library.rowMore')} variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="selection-more">
        <IconMore size={16} />
      </IconButton>
      </span>
      <Menu anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} groups={more} label={t('library.rowMore')} width={280} />
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="selection-clear">
        {t('docs.clearSelection')}
      </Button>
    </div>
  );
}

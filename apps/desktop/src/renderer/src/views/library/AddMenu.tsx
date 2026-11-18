import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { IconChevronDown, IconPlus } from '../../components/icons';
import { Lazy, lazyView } from '../../components/Lazy';
import { Menu, type MenuGroups } from '../../components/Menu';
import { useInbox } from '../../lib/inbox';

// The import dialog (and its strings) load the first time it is asked for.
const ImportDialog = lazyView(() => import('../import/ImportDialog'), ['import']);

/**
 * "+ Add" (17.4.1): a split button. The body adds a PDF as it always did; the arrow opens the menu of the other ways in.
 * Later waves add their entries (DOI, arXiv or URL; a resource or link) to this list.
 */
export function AddMenu() {
  const { t } = useTranslation();
  const inbox = useInbox();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const groups: MenuGroups = [
    {
      id: 'add',
      items: [
        { id: 'pdf', testId: 'add-menu-pdf', label: t('library.addMenu.pdf'), onSelect: () => void inbox.choose() },
        { id: 'zotero', testId: 'add-menu-zotero', label: t('library.addMenu.zotero'), onSelect: () => setImporting(true) },
      ],
    },
  ];
  return (
    <>
      <span className="add-split" ref={anchor}>
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => void inbox.choose()} data-testid="add-pdf">
          {t('library.addPdf')}
        </Button>
        <IconButton label={t('library.addMenu.more')} variant="secondary" className="add-split__arrow" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="add-menu">
          <IconChevronDown size={16} />
        </IconButton>
      </span>
      <Menu anchor={anchor} open={open} onClose={() => setOpen(false)} groups={groups} label={t('library.addMenu.more')} width={260} />
      {importing && (
        <Lazy>
          <ImportDialog onClose={() => setImporting(false)} />
        </Lazy>
      )}
    </>
  );
}

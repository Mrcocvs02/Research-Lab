import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { IconMore } from '../../components/icons';
import { Menu, type MenuGroups, type MenuItem } from '../../components/Menu';

interface Props {
  archived: boolean;
  /** Where the focus and the popover go: the button itself. */
  testId: string;
  /** The label of the button ("More about «Name»" in a list of many). */
  label: string;
  onExport(): void;
  /** Absent in the list (the name is edited in the project). */
  onRename?: (() => void) | undefined;
  onToggleArchive(): void;
  size?: 'sm' | 'md';
}

/**
 * The menu of a project (1.1, D-412): "Export…" (second brain and bibliography), then Rename and Archive. Later waves add their
 * entries here (link a .bib file, Claude's report, comparison table, citation suggestions) up to seven in three groups.
 */
export function ProjectMoreMenu({ archived, testId, label, onExport, onRename, onToggleArchive, size = 'md' }: Props) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const archive: MenuItem = { id: 'archive', testId: archived ? 'project-restore' : 'project-archive', label: archived ? t('projects.restore') : t('projects.archive'), onSelect: onToggleArchive };
  const groups: MenuGroups = onRename
    ? [
        { id: 'export', items: [{ id: 'export', testId: 'project-export', label: t('secondBrain.button'), onSelect: onExport }] },
        { id: 'manage', items: [{ id: 'rename', testId: 'project-rename', label: t('projects.rename'), onSelect: onRename }, archive] },
      ]
    : [{ id: 'project', items: [archive, { id: 'export', testId: 'project-export', label: t('secondBrain.button'), onSelect: onExport }] }];
  return (
    <>
      <span ref={anchor}>
        <IconButton label={label} variant="secondary" size={size} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={testId}>
          <IconMore size={size === 'sm' ? 16 : 20} />
        </IconButton>
      </span>
      <Menu anchor={anchor} open={open} onClose={() => setOpen(false)} groups={groups} label={label} width={260} />
    </>
  );
}

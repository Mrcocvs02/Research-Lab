import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { IconMore } from '../../components/icons';
import { Menu, type MenuGroup, type MenuGroups, type MenuItem } from '../../components/Menu';

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
  /** "Link a .bib file" and "Copy BibTeX" (project page only). */
  onLinkBib?: (() => void) | undefined;
  onCopyBib?: (() => void) | undefined;
  /** Tooltip of the link entry: what it is linked to and when it was updated. */
  bibTitle?: string | undefined;
  /** "With Claude ✦" (X7): the report of the period (`reportDisabled` says why it cannot be made) and citation suggestions. Project page only. */
  onReport?: (() => void) | undefined;
  reportDisabled?: string | undefined;
  onCite?: (() => void) | undefined;
  size?: 'sm' | 'md';
}

/**
 * The menu of a project (1.1, D-412): "Export…" (second brain and bibliography), then Rename and Archive. Later waves add their
 * entries here (link a .bib file, Claude's report, comparison table, citation suggestions) up to seven in three groups.
 */
export function ProjectMoreMenu({ archived, testId, label, onExport, onRename, onToggleArchive, onLinkBib, onCopyBib, bibTitle, onReport, reportDisabled, onCite, size = 'md' }: Props) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const archive: MenuItem = { id: 'archive', testId: archived ? 'project-restore' : 'project-archive', label: archived ? t('projects.restore') : t('projects.archive'), onSelect: onToggleArchive };
  const exportGroup: MenuGroup = { id: 'export', items: [{ id: 'export', testId: 'project-export', label: t('secondBrain.button'), onSelect: onExport }] };
  const bibGroup: MenuGroup | null =
    onRename && onLinkBib && onCopyBib
      ? {
          id: 'bib',
          items: [
            { id: 'copy-bib', testId: 'project-copy-bib', label: t('projects.bib.copy'), onSelect: onCopyBib },
            { id: 'link-bib', testId: 'project-link-bib', label: t('projects.bib.link'), ...(bibTitle ? { title: bibTitle } : {}), onSelect: onLinkBib },
          ],
        }
      : null;
  const claudeGroup: MenuGroup | null =
    onRename && onReport && onCite
      ? {
          id: 'claude',
          label: t('schema.withClaude'),
          items: [
            reportDisabled
              ? { id: 'report', testId: 'project-report', label: t('schema.report.menu'), disabled: true, disabledReason: reportDisabled, onSelect: onReport }
              : { id: 'report', testId: 'project-report', label: t('schema.report.menu'), onSelect: onReport },
            { id: 'cite', testId: 'project-cite', label: t('schema.cite.menu'), onSelect: onCite },
          ],
        }
      : null;
  const manage: MenuGroup | null = onRename ? { id: 'manage', items: [{ id: 'rename', testId: 'project-rename', label: t('projects.rename'), onSelect: onRename }, archive] } : null;
  const groups: MenuGroups = manage
    ? claudeGroup
      ? [{ ...exportGroup, items: [...exportGroup.items, ...(bibGroup?.items ?? [])] }, claudeGroup, manage]
      : bibGroup
        ? [exportGroup, bibGroup, manage]
        : [exportGroup, manage]
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

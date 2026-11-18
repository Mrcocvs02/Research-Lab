import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceView } from '@rl/core';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { IconMore } from '../../components/icons';
import { IconLibrary } from '../../components/icons-shell';
import { Menu, type MenuGroups } from '../../components/Menu';
import { ErrorNote } from '../../components/ui';
import { requestAdd } from '../../lib/addRequest';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { KIND_GLYPH, openFailure } from './model';
import './resources.css';

function Row({ r, onChanged }: { r: ResourceView; onChanged(): void }) {
  const { t } = useTranslation();
  const { info, fail } = useNotify();
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState(false);
  const open = () => rl.invoke('resources:open', { id: r.id }).catch((e: unknown) => fail(openFailure(e, t)));
  const groups: MenuGroups = [
    {
      id: 'actions',
      items: [
        ...(r.url !== null && r.kind !== 'reference'
          ? [
              {
                id: 'preview',
                testId: 'resource-preview',
                label: t('resources.preview'),
                onSelect: () =>
                  void rl.invoke('resources:preview', { id: r.id }).then(
                    () => (info(t('resources.previewDone')), onChanged()),
                    () => fail(t('resources.previewFailed')),
                  ),
              },
            ]
          : []),
        {
          id: 'remove',
          testId: 'resource-remove',
          label: t('resources.remove'),
          title: t('resources.removeHint'),
          onSelect: () => void rl.invoke('resources:remove', { id: r.id }).then(() => (info(t('resources.removed')), onChanged()), (e: unknown) => fail(errorMessage(e, t))),
        },
      ],
    },
  ];
  const where = r.host ?? (r.path ? `${t('resources.local')} · ${safeText(r.path)}` : '');
  const links = [r.docs.length > 0 ? t('resources.linkedDocs', { count: r.docs.length }) : '', r.projects.length > 0 ? t('resources.linkedProjects', { count: r.projects.length }) : ''].filter(Boolean).join(' · ');
  return (
    <li className="resource-row" data-testid="resource-row" data-kind={r.kind}>
      <span className="resource-row__glyph" aria-hidden="true" title={t(`resources.kind.${r.kind}`)}>
        {KIND_GLYPH[r.kind]}
      </span>
      <div className="resource-row__main">
        <div className="resource-row__title" data-testid="resource-title-text">
          {safeText(r.title)}
        </div>
        <div className="resource-row__sub">
          {t(`resources.kind.${r.kind}`)}
          {where ? ` · ${where}` : ''}
          {r.year ? ` · ${r.year}` : ''}
          {links ? ` · ${links}` : ''}
        </div>
        {r.authors.length > 0 && <div className="resource-row__sub">{safeText(r.authors.slice(0, 4).join(', '))}</div>}
        {r.preview && (r.preview.title || r.preview.description) && (
          <p className="resource-row__preview" data-testid="resource-preview-text">
            {r.preview.title ? <strong>{safeText(r.preview.title)}</strong> : null} {r.preview.description ? safeText(r.preview.description) : null}
          </p>
        )}
        {r.missing && <div className="resource-row__warn">{t('resources.missing')}</div>}
      </div>
      <div className="resource-row__actions">
        <Button size="sm" disabled={r.missing} onClick={() => void open()} data-testid="resource-open">
          {t('resources.open')}
        </Button>
        <span ref={anchor}>
          <IconButton label={t('resources.more')} size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} data-testid="resource-more">
            <IconMore size={16} />
          </IconButton>
        </span>
        <Menu anchor={anchor} open={menu} onClose={() => setMenu(false)} groups={groups} label={t('resources.more')} width={280} />
      </div>
    </li>
  );
}

/** The Library with the Type facet "Resources" on (17.4.4): the resources as rows with the type icon, "Open" in place of "Read". */
export default function ResourcesPane() {
  const { t } = useTranslation();
  const version = useChangeVersion('documents');
  const [items, setItems] = useState<ResourceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const changed = useCallback(() => setBump((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    rl.invoke('resources:list', {}).then(
      (r) => live && (setItems(r.items), setError(null)),
      (e: unknown) => live && setError(errorMessage(e, t)),
    );
    return () => {
      live = false;
    };
  }, [version, bump, t]);

  return (
    <div className="resources-pane" data-testid="resources-pane">
      {error && <ErrorNote testId="resources-error">{error}</ErrorNote>}
      {items !== null && items.length === 0 && (
        <EmptyState icon={<IconLibrary size={24} />} title={t('resources.emptyTitle')} action={<Button onClick={() => requestAdd({ kind: 'resource' })}>{t('library.addMenu.resource')}</Button>}>
          {t('resources.empty')}
        </EmptyState>
      )}
      {items !== null && items.length > 0 && (
        <ul role="list" aria-label={t('resources.list')} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((r) => (
            <Row key={r.id} r={r} onChanged={changed} />
          ))}
        </ul>
      )}
    </div>
  );
}

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { IconDiscover } from '../../components/icons-shell';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { WorkRow } from '../citations/WorkRow';
import { safeText } from '../library/safeText';
import { useFolderOptions } from '../library/useFolderOptions';
import { useRefreshCitations } from './refreshCitations';
import '../citations/citations.css';
import './discover.css';

type Result = ResponseOf<Channels, 'recommend:readNext'>;
type Item = Result['items'][number];
type Project = ResponseOf<Channels, 'projects:list'>['items'][number];
type Scope = 'all' | 'project' | 'folder';

/** The number field changes the list only after this pause (each change recomputes it in the main process). */
const MIN_DEBOUNCE_MS = 350;

/** Fewer documents than this have stored citations: the list is thin, so say so and how to improve it. */
const FEW = 5;

function useProjects(enabled: boolean): Project[] {
  const [items, setItems] = useState<Project[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    rl.invoke('projects:list', {}).then(
      (r) => live && setItems(r.items),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return items;
}

/** "Read next": works cited by several documents of the library and not owned, each with why (offline, no AI). */
export function ReadNext({ reloadKey }: { reloadKey: number }) {
  const { t } = useTranslation();
  const { info, reportError } = useNotify();
  const { openReader } = useReader();
  const [scope, setScope] = useState<Scope>('all');
  const [projectId, setProjectId] = useState('');
  const [folder, setFolder] = useState('');
  const [minInput, setMinInput] = useState(2);
  // The filters are a row that stays closed until someone opens it (4.13).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const refresh = useRefreshCitations();
  const [minCiting, setMinCiting] = useState(2);
  useEffect(() => {
    const id = setTimeout(() => setMinCiting(minInput), MIN_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [minInput]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const projects = useProjects(scope === 'project');
  const folders = useFolderOptions();
  const scopeId = useId();
  const projectSelId = useId();
  const folderSelId = useId();
  const minId = useId();

  const activeFilters = (scope !== 'all' ? 1 : 0) + (minCiting !== 2 ? 1 : 0);
  const incomplete = (scope === 'project' && projectId === '') || (scope === 'folder' && folder === '');
  useEffect(() => {
    if (incomplete) {
      setResult(null);
      return;
    }
    let live = true;
    setError(null);
    rl.invoke('recommend:readNext', { minCiting, ...(scope === 'project' ? { projectId } : {}), ...(scope === 'folder' ? { folder } : {}) }).then(
      (r) => live && setResult(r),
      (e: unknown) => {
        if (!live) return;
        setResult(null);
        setError(e);
      },
    );
    return () => {
      live = false;
    };
  }, [scope, projectId, folder, minCiting, incomplete, reloadKey]);

  const dismiss = useCallback(
    async (item: Item) => {
      try {
        await rl.invoke('recommend:dismiss', { key: item.key });
        setResult((r) => (r ? { ...r, items: r.items.filter((i) => i.key !== item.key) } : r));
        info(t('discover.readnext.dismissed'));
      } catch (e) {
        reportError(e);
      }
    },
    [info, reportError, t],
  );

  return (
    <div data-testid="discover-readnext">
      <p className="hint discover-intro">{t('discover.readnext.intro')}</p>
      <div className="vbar">
        <span data-testid="readnext-filters-toggle">
          <Chip selected={filtersOpen || activeFilters > 0} onClick={() => setFiltersOpen(!filtersOpen)}>
            {activeFilters > 0 ? t('discover.filtersActive', { count: activeFilters }) : t('discover.filters')}
          </Chip>
        </span>
      </div>
      {filtersOpen && (
        <div className="discover-bar" data-testid="readnext-filters">
          <div className="field">
            <label htmlFor={scopeId}>{t('discover.readnext.scope')}</label>
            <select id={scopeId} value={scope} onChange={(e) => setScope(e.target.value as Scope)} data-testid="readnext-scope">
              <option value="all">{t('discover.readnext.scope_all')}</option>
              <option value="project">{t('discover.readnext.scope_project')}</option>
              <option value="folder">{t('discover.readnext.scope_folder')}</option>
            </select>
          </div>
          {scope === 'project' && (
            <div className="field">
              <label htmlFor={projectSelId}>{t('discover.readnext.project')}</label>
              <select id={projectSelId} value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="readnext-project">
                <option value="">{t('discover.readnext.choose')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {safeText(p.name)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {scope === 'folder' && (
            <div className="field">
              <label htmlFor={folderSelId}>{t('discover.readnext.folder')}</label>
              <select id={folderSelId} value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="readnext-folder">
                <option value="">{t('discover.readnext.choose')}</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {safeText(f)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor={minId}>{t('discover.readnext.minCiting')}</label>
            <input id={minId} type="number" min={1} max={50} value={minInput} onChange={(e) => setMinInput(Math.min(50, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))} data-testid="readnext-min" />
          </div>
        </div>
      )}
      {error !== null && <ErrorNote testId="readnext-error">{errorMessage(error, t)}</ErrorNote>}
      {result === null && error === null && !incomplete && (
        <p className="hint" role="status">
          {t('discover.readnext.loading')}
        </p>
      )}
      {result && (
        <>
          {result.documentsWithCitations === 0 ? (
            <div data-testid="readnext-few">
              <EmptyState
                icon={<IconDiscover size={24} />}
                title={t('discover.readnext.noneTitle')}
                action={
                  <Button variant="primary" busy={refresh.busy} disabled={refresh.busy} onClick={() => void refresh.start()} data-testid="readnext-refresh">
                    {t('discover.refresh')}
                  </Button>
                }
              >
                {t('discover.readnext.none')}
              </EmptyState>
            </div>
          ) : (
            result.documentsWithCitations < FEW && (
              <div data-testid="readnext-few">
                <Banner tone="info" action={{ label: t('discover.refresh'), onClick: () => void refresh.start() }}>
                  {t('discover.readnext.few', { count: result.documentsWithCitations })} {t('discover.readnext.fewHint')}
                </Banner>
              </div>
            )
          )}
          {result.items.length === 0 ? (
            result.documentsWithCitations > 0 && (
              <p className="empty" data-testid="readnext-empty">
                {t('discover.readnext.empty')}
              </p>
            )
          ) : (
            <ul className="work-list" aria-label={t('discover.tab_readnext')}>
              {result.items.map((item) => (
                <WorkRow key={item.key} testId="readnext-item" title={item.work.title} authors={item.work.authors} year={item.work.year} venue={item.work.venue} ids={item.work}>
                  <span className="hint" data-testid="readnext-why">
                    {t('discover.readnext.why', { count: item.citingCount })}
                  </span>
                  {item.citing.map((c) => (
                    <button
                      key={c.docId}
                      type="button"
                      className="chip-button"
                      onClick={() => openReader(c.docId)}
                      aria-label={t('citations.openDoc', { title: safeText(c.title?.trim() || t('citations.untitled')) })}
                      title={safeText(c.title ?? '')}
                      data-testid="readnext-citing"
                    >
                      {safeText(c.title?.trim() || t('citations.untitled'))}
                    </button>
                  ))}
                  {item.citingCount > item.citing.length && <span className="hint">{t('discover.readnext.citingMore', { count: item.citingCount - item.citing.length })}</span>}
                  <button type="button" className="link" onClick={() => void dismiss(item)} aria-label={`${t('discover.dismiss')}: ${safeText(item.work.title ?? '')}`} data-testid="readnext-dismiss">
                    {t('discover.dismiss')}
                  </button>
                </WorkRow>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

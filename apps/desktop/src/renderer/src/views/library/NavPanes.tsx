import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { Tree, type TreeItem } from '../../components/Tree';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';
import { safeText } from './safeText';
import { flattenTree } from './taxonomyModel';
import { useTaxonomy } from './useTaxonomy';
import type { CSSProperties } from 'react';

type FolderTreeData = ResponseOf<Channels, 'library:tree'>;
type FolderNode = FolderTreeData['folders'][number];

interface FolderItem extends TreeItem {
  path: string;
  name: string;
  count: number;
}

/** The "all documents" row, and (when sub-folders are left out) the documents lying directly in the root. */
const ROOT_KEY = '';
const ROOT_ONLY_KEY = '*root-only';

/** Folders that must be open to show `path` (all its ancestors). */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function folderRows(data: FolderTreeData, expanded: ReadonlySet<string>, includeSub: boolean): FolderItem[] {
  const children = new Map<string | null, FolderNode[]>();
  for (const f of data.folders) children.set(f.parent, [...(children.get(f.parent) ?? []), f]);
  const out: FolderItem[] = [{ key: ROOT_KEY, path: ROOT_KEY, name: '', depth: 0, hasChildren: false, expanded: true, count: data.total }];
  if (!includeSub && data.rootDirect > 0) out.push({ key: ROOT_ONLY_KEY, path: ROOT_ONLY_KEY, name: '', depth: 0, hasChildren: false, expanded: true, count: data.rootDirect });
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      const kids = children.get(f.path) ?? [];
      const open = expanded.has(f.path);
      out.push({ key: f.path, path: f.path, name: f.name, depth, hasChildren: kids.length > 0, expanded: open, count: includeSub ? f.total : f.direct });
      if (open) walk(f.path, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}

/** The folders of the library with their document counts; a click lists that folder's documents. */
export function FolderPane({ folder, includeSub, onSelect, onIncludeSub, reloadKey }: { folder: string | null; includeSub: boolean; onSelect(path: string | null): void; onIncludeSub(v: boolean): void; reloadKey?: string }) {
  const { t } = useTranslation();
  const version = useChangeVersion('documents');
  const [data, setData] = useState<FolderTreeData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const load = () =>
      rl.invoke('library:tree', {}).then(
        (d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        },
        (e: unknown) => alive && setError(e),
      );
    void load();
    // The main process reuses its document list for about a second and a half: ask once more after that, so a
    // change that landed inside the window (the end of a scan) is not missed.
    const again = setTimeout(() => void load(), 1800);
    return () => {
      alive = false;
      clearTimeout(again);
    };
  }, [version, reloadKey]);

  // The chosen folder is always visible.
  useEffect(() => {
    if (folder) setExpanded((cur) => new Set([...cur, ...ancestorsOf(folder)]));
  }, [folder]);

  const rows = useMemo(() => (data ? folderRows(data, expanded, includeSub) : []), [data, expanded, includeSub]);
  if (error) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (!data) return <p className="hint">{t('common.loading')}</p>;
  const selectedKey = folder === null ? ROOT_KEY : folder === '' ? ROOT_ONLY_KEY : folder;

  return (
    <div className="nav-pane" data-testid="folder-pane">
      <Tree
        items={rows}
        selectedKey={selectedKey}
        ariaLabel={t('folders.label')}
        testId="folder-tree"
        dataKey={(i) => i.path}
        onSelect={(i) => onSelect(i.path === ROOT_KEY ? null : i.path === ROOT_ONLY_KEY ? '' : i.path)}
        onToggle={(i) => setExpanded((cur) => {
          const next = new Set(cur);
          if (next.has(i.key)) next.delete(i.key);
          else next.add(i.key);
          return next;
        })}
        renderLabel={(i) => (
          <>
            <span className="tree-name" data-testid="folder-name">
              {i.path === ROOT_KEY ? t('folders.all') : i.path === ROOT_ONLY_KEY ? t('folders.rootOnly') : safeText(i.name)}
            </span>
            <span className="facet-count" data-testid="folder-count">
              {i.count}
            </span>
          </>
        )}
      />
      <div className="check">
        <input id="include-sub" type="checkbox" checked={includeSub} onChange={(e) => onIncludeSub(e.target.checked)} data-testid="include-subfolders" />
        <label htmlFor="include-sub">{t('folders.includeSub')}</label>
      </div>
    </div>
  );
}

/** The taxonomy as a filter source: a click adds the tag to the filter, the minus button excludes it. Counts shown. */
export function TagTreePane({ include, exclude, onInclude, onExclude, onManage }: { include: string[]; exclude: string[]; onInclude(id: string): void; onExclude(id: string): void; onManage(): void }) {
  const { t } = useTranslation();
  const { model, loaded, error } = useTaxonomy();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flattenTree(model, expanded, (n) => n.status === 'deprecated'), [model, expanded]);
  if (error) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (!loaded) return <p className="hint">{t('common.loading')}</p>;
  return (
    <div className="nav-pane" data-testid="tag-pane">
      {rows.length === 0 ? (
        <p className="hint" data-testid="tag-pane-empty">
          {t('tags.none')}
        </p>
      ) : (
        <Tree
          items={rows}
          selectedKey={null}
          ariaLabel={t('tags.treeLabel')}
          testId="tag-tree"
          dataKey={(i) => i.id}
          onSelect={(i) => onInclude(i.id)}
          onToggle={(i) =>
            setExpanded((cur) => {
              const next = new Set(cur);
              if (next.has(i.key)) next.delete(i.key);
              else next.add(i.key);
              return next;
            })
          }
          renderLabel={(i) => {
            const node = model.byId.get(i.id)!;
            const on = include.includes(i.id);
            const off = exclude.includes(i.id);
            return (
              <>
                <span className="swatch" style={node.color ? ({ background: node.color } as CSSProperties) : undefined} aria-hidden="true" />
                <span className={on ? 'tree-name filter-on' : off ? 'tree-name filter-off' : 'tree-name'}>{safeText(node.label)}</span>
                <span className="facet-count" title={t('tags.countHint')}>
                  {node.counts.subtree}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  tabIndex={-1}
                  title={t('tags.excludeThis', { name: node.label })}
                  aria-label={t('tags.excludeThis', { name: node.label })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExclude(i.id);
                  }}
                  data-testid="tag-exclude"
                >
                  <span aria-hidden="true">⊖</span>
                </button>
              </>
            );
          }}
        />
      )}
      <button type="button" className="link" onClick={onManage} data-testid="manage-taxonomy">
        {t('tags.manage')}
      </button>
    </div>
  );
}

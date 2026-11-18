import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../lib/errors';
import { ErrorNote } from './ui';
import './tree.css';

export interface FolderEntry {
  path: string;
  name: string;
  hasChildren: boolean;
}

interface Props {
  /** Loads the direct sub-folders of a folder (relative path, '' = root). Must be a stable reference. */
  load(parent: string): Promise<FolderEntry[]>;
  /** Selected folders (relative paths). A selected folder includes everything below it. */
  value: string[];
  onChange(next: string[]): void;
  ariaLabel: string;
  testId?: string;
  /** Everything is included from above (e.g. the whole library is enabled): every folder shows checked and locked. */
  allIncluded?: boolean;
}

const isUnder = (child: string, ancestor: string) => child.startsWith(`${ancestor}/`);

/** Lazily loaded folder tree with one checkbox per folder; native controls keep it keyboard accessible. */
export function FolderTree({ load, value, onChange, ariaLabel, testId, allIncluded = false }: Props) {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    setRoots(null);
    load('').then(
      (r) => alive && setRoots(r),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  const toggle = useCallback(
    (path: string, checked: boolean) => {
      const rest = value.filter((p) => p !== path && !isUnder(p, path));
      onChange(checked ? [...rest, path].sort() : rest);
    },
    [value, onChange],
  );

  if (error) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (!roots) return <p className="hint">{t('common.loading')}</p>;
  if (roots.length === 0) return <p className="hint">{t('folders.empty')}</p>;
  return (
    <ul className="folder-tree" aria-label={ariaLabel} data-testid={testId}>
      {roots.map((f) => (
        <FolderNode key={f.path} entry={f} load={load} value={value} toggle={toggle} inherited={allIncluded} />
      ))}
    </ul>
  );
}

function FolderNode({
  entry,
  load,
  value,
  toggle,
  inherited,
}: {
  entry: FolderEntry;
  load: Props['load'];
  value: string[];
  toggle: (path: string, checked: boolean) => void;
  inherited: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const selected = value.includes(entry.path);
  const included = inherited || selected;

  const expand = () => {
    const next = !open;
    setOpen(next);
    if (next && !children) {
      load(entry.path).then(setChildren, (e: unknown) => setError(e));
    }
  };

  return (
    <li>
      <div className="folder-row">
        {entry.hasChildren ? (
          <button type="button" className="icon-button" onClick={expand} aria-expanded={open} aria-label={t('folders.toggle', { name: entry.name })}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="icon-spacer" aria-hidden="true" />
        )}
        <label className="folder-label">
          <input type="checkbox" checked={included} disabled={inherited} data-folder={entry.path} onChange={(e) => toggle(entry.path, e.target.checked)} />
          <span>{entry.name}</span>
        </label>
      </div>
      {open && error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {open && children && children.length > 0 && (
        <ul>
          {children.map((c) => (
            <FolderNode key={c.path} entry={c} load={load} value={value} toggle={toggle} inherited={included} />
          ))}
        </ul>
      )}
    </li>
  );
}

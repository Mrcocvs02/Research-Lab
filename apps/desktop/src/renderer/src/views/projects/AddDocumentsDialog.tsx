import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT_LIMITS } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { useSearch } from '../library/useSearch';

/**
 * "Add documents…" of a project (4.13): the library's own search in a dialog, tick the documents, "Add N". Documents already
 * in the project are shown ticked and cannot be picked twice. Lazy: it loads when the first project asks for it.
 */
export default function AddDocumentsDialog({ projectId, name, memberIds, onClose, onAdded }: { projectId: string; name: string; memberIds: ReadonlySet<string>; onClose(): void; onAdded(): void }) {
  const { t } = useTranslation();
  const { info, reportError } = useNotify();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const search = useSearch({ text, filters: {}, sort: text.trim() ? 'relevance' : 'title' }, true, '');
  const hits = search.results?.hits ?? [];
  const tooMany = memberIds.size + picked.size > PROJECT_LIMITS.members;

  const toggle = (docId: string, on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(docId);
      else next.delete(docId);
      return next;
    });

  const add = async () => {
    setBusy(true);
    try {
      await rl.invoke('projects:addMembers', { projectId, docIds: [...picked] });
      info(t('projects.addedDocs', { count: picked.size, name: safeText(name) }));
      onAdded();
      onClose();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('projects.addDocsTitle', { name: safeText(name) })} onClose={onClose} testId="add-documents">
      <div className="field">
        <label htmlFor="adddocs-search">{t('projects.addDocsSearch')}</label>
        <input id="adddocs-search" type="search" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} data-testid="adddocs-search" />
      </div>
      {search.error ? <ErrorNote>{errorMessage(search.error, t)}</ErrorNote> : null}
      {tooMany && <ErrorNote testId="add-too-many">{t('projects.addTooMany', { limit: PROJECT_LIMITS.members, n: memberIds.size + picked.size })}</ErrorNote>}
      {search.results && hits.length === 0 && <p className="hint">{t('projects.addDocsNone')}</p>}
      <ul className="adddocs-list" aria-label={t('projects.addDocsList')}>
        {hits.map((h) => {
          const already = memberIds.has(h.docId);
          const label = safeText(h.title ?? h.path);
          return (
            <li key={h.docId} className={already ? 'adddocs-row is-member' : 'adddocs-row'} data-testid="adddocs-row" data-doc-id={h.docId}>
              <label>
                <input type="checkbox" checked={already || picked.has(h.docId)} disabled={already || busy} onChange={(e) => toggle(h.docId, e.target.checked)} aria-label={t('projects.pickOne', { title: label })} />
                <span className="adddocs-title">{label}</span>
                <span className="adddocs-meta">{[safeText(h.authors.slice(0, 2).join(', ')), h.year ?? ''].filter((x) => x !== '').join(' · ')}</span>
                {already && <span className="adddocs-meta">{t('projects.alreadyIn')}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {search.hasMore && (
        <button type="button" className="link" onClick={search.loadMore} disabled={search.loading} data-testid="adddocs-more">
          {t('projects.addDocsMore')}
        </button>
      )}
      <div className="actions">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={picked.size === 0 || tooMany || busy} busy={busy} onClick={() => void add()} data-testid="adddocs-confirm">
          {t('projects.addN', { count: picked.size })}
        </Button>
      </div>
    </Dialog>
  );
}

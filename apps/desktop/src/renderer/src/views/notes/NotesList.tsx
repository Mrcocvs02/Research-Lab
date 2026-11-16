import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';
import { ErrorNote } from '../../components/ui';
import { safeText } from '../library/safeText';

type Item = ResponseOf<Channels, 'notes:list'>['items'][number];

/** Every note of a document (the file note first, then the page notes); each entry goes to its page or to the file note. */
export function NotesList({ docId, onOpen }: { docId: string; onOpen(page: number | null): void }) {
  const { t } = useTranslation();
  const version = useChangeVersion('notes');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    rl.invoke('notes:list', { docId }).then(
      (r) => {
        if (!alive) return;
        setItems(r.items);
        setError(null);
      },
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [docId, version]);

  if (error) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (items === null) return <p className="hint">{t('common.loading')}</p>;
  if (items.length === 0) {
    return (
      <p className="hint" data-testid="notes-list-empty">
        {t('reader.notesList.empty')}
      </p>
    );
  }
  return (
    <ul className="notes-list" data-testid="notes-list">
      {items.map((n) => (
        <li key={n.page ?? 'file'}>
          <button type="button" className="notes-list-item" onClick={() => onOpen(n.page)} data-testid="notes-list-item" data-page={n.page ?? ''}>
            <span className="notes-list-title">{n.page === null ? t('reader.notesList.file') : t('reader.notesList.page', { page: n.page })}</span>
            <span className="notes-list-excerpt">{safeText(n.excerpt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

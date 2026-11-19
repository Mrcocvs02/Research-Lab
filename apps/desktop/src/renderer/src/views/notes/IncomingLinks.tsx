import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { useChangeVersion } from '../../lib/events';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import './notes.css';

type Item = ResponseOf<Channels, 'links:incoming'>['items'][number];

/**
 * "Incoming links" (feature 38): the notes that point to this document with `[[Title|lab://doc/<id>]]`, one lazy chunk (D-426).
 * Nothing is shown when there are none, so a document nobody links to takes no room.
 */
export function IncomingLinks({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const version = useChangeVersion('notes');
  const { openReader } = useReader();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let alive = true;
    rl.invoke('links:incoming', { docId }).then((r) => alive && setItems(r.items), () => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [docId, version]);
  if (items.length === 0) return null;
  return (
    <section className="incoming-links" aria-label={t('notes.incoming.title', { count: items.length })} data-testid="incoming-links">
      <h4>{t('notes.incoming.title', { count: items.length })}</h4>
      <ul>
        {items.map((i) => (
          <li key={`${i.docId}:${i.page ?? 'file'}`}>
            <button type="button" className="note-link" onClick={() => openReader(i.docId, i.page ?? undefined, { panel: i.page === null ? 'fileNote' : 'pageNote' })} data-testid="incoming-link">
              {safeText(i.page === null ? i.title : t('notes.incoming.page', { title: i.title, page: i.page }))}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

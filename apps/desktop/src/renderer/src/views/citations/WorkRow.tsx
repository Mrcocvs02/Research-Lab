import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { openWork, shortAuthors, workLink, type WorkIds } from '../../lib/workLinks';
import { safeText } from '../library/safeText';
import './citations.css';

export interface WorkRowProps {
  /** Prefix of the `data-testid`s: `<testId>` on the row, `<testId>-open` and `<testId>-external` on the actions. */
  testId: string;
  title?: string | null | undefined;
  authors?: readonly string[] | undefined;
  year?: number | null | undefined;
  venue?: string | null | undefined;
  ids: WorkIds;
  /** The library document this work is. */
  matched?: { docId: string; title: string | null } | null | undefined;
  children?: ReactNode;
}

const TARGET = { doi: 'citations.openDoi', arxiv: 'citations.openArxiv', openalex: 'citations.openOpenAlex' } as const;

/**
 * One work of a remote source, as safe text. Metadata comes from online sources and from synced files, so it is only
 * ever rendered as text nodes (never HTML). A work that is in the library gets a chip that opens the document; for
 * the others, a link to its DOI / arXiv / OpenAlex page opens in the system browser through the main process.
 */
export function WorkRow({ testId, title, authors = [], year, venue, ids, matched, children }: WorkRowProps) {
  const { t } = useTranslation();
  const { openReader } = useReader();
  const { reportError } = useNotify();
  const shownTitle = safeText(title?.trim() || t('citations.untitled'));
  const link = workLink(ids);
  const meta = [shortAuthors(authors.map(safeText), (names) => t('citations.authorsMore', { names })), year ? String(year) : '', venue ? safeText(venue) : ''].filter((s) => s !== '').join(' · ');
  return (
    <li className="work-row" data-testid={testId} data-in-library={matched ? 'true' : 'false'}>
      <span className="work-title">{shownTitle}</span>
      {meta !== '' && <span className="work-meta">{meta}</span>}
      <div className="work-actions">
        {matched ? (
          <button type="button" className="chip-button" onClick={() => openReader(matched.docId)} aria-label={t('citations.openDoc', { title: safeText(matched.title?.trim() || shownTitle) })} data-testid={`${testId}-open`}>
            {t('citations.inLibrary')}
          </button>
        ) : (
          link && (
            <button
              type="button"
              className="link"
              onClick={() => void openWork(link).catch(reportError)}
              aria-label={t('citations.openExternal', { target: t(TARGET[link.kind]), title: shownTitle })}
              data-testid={`${testId}-external`}
              data-kind={link.kind}
            >
              {t(TARGET[link.kind])}
            </button>
          )
        )}
        {children}
      </div>
    </li>
  );
}

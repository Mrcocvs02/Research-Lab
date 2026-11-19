import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '../../../components/Chip';
import { useCitationJob } from '../../../lib/citationJobs';
import { useReader } from '../../../lib/reader';
import { rl } from '../../../lib/rl';
import { CitationsPanel, type CitedByExtra } from '../../citations/CitationsPanel';
import { safeText } from '../safeText';

type Ctx = Map<string, Array<{ page: number; text: string }>>;

/**
 * The "Citations" section of the card (feature 11, §17.4.18): the references and "cited by" of the panel, and under each citing
 * paper that is in the library the sentence in which it cites this document, with its page. The "With the context" chip keeps
 * only the works that have one. Read on this machine from the text of the citing papers (no network, no Claude).
 */
export function CitationsSection({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const { openReader } = useReader();
  const { version } = useCitationJob();
  const [ctx, setCtx] = useState<Ctx>(new Map());
  const [only, setOnly] = useState(false);

  useEffect(() => {
    let live = true;
    setCtx(new Map());
    rl.invoke('citectx:get', { docId }).then(
      (r) => live && setCtx(new Map(r.items.map((i) => [i.docId, i.sentences]))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [docId, version]);

  const extra = useMemo<CitedByExtra>(
    () => ({
      toolbar: (
        <span data-testid="citations-ctx-filter">
          <Chip selected={only} onClick={() => setOnly(!only)} disabled={ctx.size === 0}>
            {t('citations.ctx.filter')}
          </Chip>
        </span>
      ),
      keep: (l) => !only || (l.matched ? ctx.has(l.matched.docId) : false),
      render: (l) => {
        const sentences = l.matched ? ctx.get(l.matched.docId) : undefined;
        if (!sentences || !l.matched) return null;
        const citing = l.matched.docId;
        return (
          <ul className="work-ctx" data-testid="citation-context">
            {sentences.map((s, i) => (
              <li key={i}>
                <q>{safeText(s.text)}</q>{' '}
                <button type="button" className="link" onClick={() => openReader(citing, s.page)} aria-label={t('citations.ctx.open', { page: s.page })}>
                  {t('citations.ctx.page', { page: s.page })}
                </button>
              </li>
            ))}
          </ul>
        );
      },
    }),
    [ctx, only, t, openReader],
  );
  return (
    <>
      <CitationsPanel docId={docId} citedByExtra={extra} />
      {only && ctx.size === 0 && (
        <p className="hint" data-testid="citations-ctx-empty">
          {t('citations.ctx.empty')}
        </p>
      )}
    </>
  );
}

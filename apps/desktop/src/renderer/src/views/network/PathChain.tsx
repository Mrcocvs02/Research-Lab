import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf, ResponseOf } from '@rl/core';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { useDocTitle } from '../chat/useLabels';
import { safeText } from '../library/safeText';
import { chainOf } from './vicinityModel';

export type Strictness = RequestOf<Channels, 'graph:path'>['strictness'];
type Step = ResponseOf<Channels, 'graph:path'>['steps'][number];

interface Props {
  a: string;
  b: string;
  strictness: Strictness;
  onStrictness(s: Strictness): void;
  onOpenDoc(docId: string): void;
  onBridge(a: string, b: string): void;
  onClose(): void;
}

function Name({ docId, onOpen }: { docId: string; onOpen(docId: string): void }) {
  const title = safeText(useDocTitle(docId) ?? '…');
  return (
    <button type="button" className="path-node" onClick={() => onOpen(docId)} title={title} data-testid="path-node" data-doc-id={docId}>
      {title}
    </button>
  );
}

/** The evidence of one step: "cites", "linked by you", "similar 0.42" (the kinds that hold, in that order). */
function stepText(t: TFunction, s: Step): string {
  return s.kinds.map((k) => (k === 'similar' ? t('vicinity.why.similar', { value: (s.w ?? s.e).toFixed(2) }) : t(`vicinity.why.${k}`))).join(' · ');
}

/**
 * The path between two papers (section 19.2.5), a chain from left to right with the evidence of each step; "no path" offers a wider
 * threshold and the search for a bridge outside the library. The path is asked of the main process (`graph:path`, Dijkstra there).
 */
export function PathChain({ a, b, strictness, onStrictness, onOpenDoc, onBridge, onClose }: Props) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    setSteps(null);
    setError(null);
    rl.invoke('graph:path', { a, b, strictness }).then(
      (r) => live && setSteps(r.steps),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [a, b, strictness]);
  const chain = steps && steps.length > 0 ? chainOf(a, steps) : [];
  return (
    <section className="path-strip" aria-label={t('vicinity.path.title')} data-testid="path-strip">
      {error ? (
        <span role="alert">{errorMessage(error, t)}</span>
      ) : steps === null ? (
        <span className="hint">{t('common.loading')}</span>
      ) : chain.length === 0 ? (
        <span className="path-none" data-testid="path-none">
          {t('vicinity.path.none')}
          {strictness !== 'wide' && (
            <>
              {' · '}
              <button type="button" className="link" onClick={() => onStrictness('wide')} data-testid="path-wide">
                {t('vicinity.path.wide')}
              </button>
            </>
          )}
          {' · '}
          <button type="button" className="link" onClick={() => onBridge(a, b)} data-testid="path-bridge">
            {t('vicinity.path.bridge')}
          </button>
        </span>
      ) : (
        <ol className="path-chain" data-testid="path-chain" data-steps={steps.length}>
          {chain.map((id, i) => (
            <li key={`${id}-${i}`}>
              {i > 0 && (
                <span className="path-evidence hint" data-testid="path-evidence">
                  {stepText(t, steps[i - 1]!)}
                </span>
              )}
              <Name docId={id} onOpen={onOpenDoc} />
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="icon-button path-close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} data-testid="path-close">
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, Claim, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { formatTokens, formatUsd } from '../chat/format';
import { safeText } from '../library/safeText';
import { ModelPick, SendPreview } from './SendPreview';

type Preview = ResponseOf<Channels, 'project:evidencePreview'>;
type Item = ResponseOf<Channels, 'project:evidenceRun'>['items'][number];

/**
 * "✦ Cerca prove" for one claim (§17.4.15): the best passages are found in the local index (nothing leaves), the exact text is
 * shown, and only after the user confirms does Claude sort them into supports or contradicts. Each result stays a proposal
 * until the user accepts it; accepting adds it to the claim like "Usa come prova".
 */
export default function EvidenceDialog({ projectId, claim, onClose, onAccepted }: { projectId: string; claim: Claim; onClose(): void; onAccepted(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const [model, setModel] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const modelReq = model ? { model } : {};
  useEffect(() => {
    let live = true;
    setPreview(null);
    rl.invoke('project:evidencePreview', { projectId, claimId: claim.id, ...modelReq }).then((p) => live && setPreview(p), reportError);
    return () => {
      live = false;
    };
  }, [projectId, claim.id, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true);
    try {
      setItems((await rl.invoke('project:evidenceRun', { projectId, claimId: claim.id, ...modelReq, confirmed: true })).items);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const accept = async (i: number, it: Item) => {
    try {
      await rl.invoke('project:addEvidence', { projectId, claimId: claim.id, evidence: { docId: it.docId, page: it.page, stance: it.stance, excerpt: it.excerpt } });
      setDone((d) => new Set(d).add(i));
      info(t('schema.findEvidence.accepted'));
      onAccepted();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Dialog title={t('schema.findEvidence.title')} onClose={onClose} testId="evidence-dialog">
      <div className="dlg-scroll">
        <p className="schema-claim__text">«{safeText(claim.text)}»</p>
        {items === null ? (
          <>
            <ModelPick value={model} onChange={setModel} preferHaiku />
            {preview && preview.candidates === 0 && <p className="empty" data-testid="evidence-none-found">{t('schema.findEvidence.noCandidates')}</p>}
            {preview && preview.candidates > 0 && (
              <SendPreview text={preview.text} what={t('schema.findEvidence.what', { count: preview.candidates })} facts={`${t('schema.tokens', { tokens: formatTokens(preview.approxTokens) })} · ${preview.estimatedUsd === null ? t('schema.noPrice') : t('schema.usd', { usd: formatUsd(preview.estimatedUsd) })}`} blocked={preview.overDailyCap ? t('schema.capReached') : null} testId="evidence-preview" />
            )}
          </>
        ) : items.length === 0 ? (
          <p className="empty" data-testid="evidence-none">{t('schema.findEvidence.none')}</p>
        ) : (
          <ul className="schema-evidence" data-testid="evidence-proposals">
            {items.map((it, i) => (
              <li key={`${it.docId}-${it.page}`} data-testid="evidence-proposal" data-stance={it.stance}>
                <span className="hint">
                  <span aria-hidden="true">✦ </span>
                  {t(`schema.${it.stance}`)}:
                </span>{' '}
                {safeText(it.title)} p. {it.page}
                <q className="hint">{safeText(it.excerpt)}</q>
                <Button size="sm" disabled={done.has(i)} onClick={() => void accept(i, it)} data-testid="evidence-accept">
                  {t('schema.findEvidence.accept')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="actions">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {items === null && (
          <Button variant="primary" disabled={busy || !preview || preview.candidates === 0 || preview.overDailyCap} onClick={() => void send()} data-testid="evidence-send">
            {t('schema.send')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

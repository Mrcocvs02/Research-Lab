import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, Manuscript, ResponseOf } from '@rl/core';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { useNotify } from '../../../lib/notify';
import { rl } from '../../../lib/rl';
import { formatTokens, formatUsd } from '../../chat/format';
import { safeText } from '../../library/safeText';
import { ModelPick, SendPreview } from '../SendPreview';

type Preview = ResponseOf<Channels, 'project:previewAssignSuggest'>;
type Item = ResponseOf<Channels, 'project:assignSuggest'>['items'][number];

/**
 * "✦ Propose the assignments" (§18.1, Z1c): only the section titles and the title and abstract of the papers in enabled folders
 * are sent, after the exact text and the cost are shown. Each proposal stays a proposal until the user accepts it (origin `ai`).
 */
export default function AssignSuggestDialog({ projectId, sections, titles, onClose, onDone }: { projectId: string; sections: ReadonlyMap<string, string>; titles: ReadonlyMap<string, string>; onClose(): void; onDone(m: Manuscript): void }) {
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
    rl.invoke('project:previewAssignSuggest', { projectId, ...modelReq }).then((p) => live && setPreview(p), reportError);
    return () => {
      live = false;
    };
  }, [projectId, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true);
    try {
      setItems((await rl.invoke('project:assignSuggest', { projectId, ...modelReq, confirmed: true })).items);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const accept = async (idx: number[]) => {
    if (!items) return;
    setBusy(true);
    try {
      let last: Manuscript | null = null;
      for (const i of idx) {
        const it = items[i]!;
        last = (await rl.invoke('project:assign', { projectId, sectionId: it.sectionId, refs: [{ kind: 'doc', docId: it.docId }], on: true, origin: 'ai' })).manuscript;
        setDone((d) => new Set(d).add(i));
      }
      if (last) {
        info(t('ms.suggest.accepted'));
        onDone(last);
      }
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const open = items ? items.map((_, i) => i).filter((i) => !done.has(i)) : [];
  return (
    <Dialog title={t('ms.suggest.title')} onClose={onClose} testId="ms-suggest-dialog">
      <div className="dlg-scroll">
        {items === null ? (
          <>
            <ModelPick value={model} onChange={setModel} preferHaiku />
            {preview && preview.candidates === 0 && (
              <p className="empty" data-testid="ms-suggest-nothing">
                {t('ms.suggest.nothing')}
              </p>
            )}
            {preview && preview.candidates > 0 && (
              <SendPreview text={preview.text} what={t('ms.suggest.what', { count: preview.candidates })} facts={`${t('schema.tokens', { tokens: formatTokens(preview.approxTokens) })} · ${preview.estimatedUsd === null ? t('schema.noPrice') : t('schema.usd', { usd: formatUsd(preview.estimatedUsd) })}`} blocked={preview.overDailyCap ? t('schema.capReached') : null} testId="ms-suggest-preview" />
            )}
          </>
        ) : items.length === 0 ? (
          <p className="empty" data-testid="ms-suggest-none">
            {t('ms.suggest.none')}
          </p>
        ) : (
          <ul className="schema-evidence" data-testid="ms-suggest-proposals">
            {items.map((it, i) => (
              <li key={`${it.sectionId}-${it.docId}`} data-testid="ms-suggest-proposal" data-section-id={it.sectionId}>
                <span aria-hidden="true">✦ </span>
                {safeText(sections.get(it.sectionId) ?? it.sectionId)} ← {safeText(titles.get(it.docId) ?? it.docId)}{' '}
                <Button size="sm" disabled={busy || done.has(i)} onClick={() => void accept([i])} data-testid="ms-suggest-accept">
                  {t('ms.suggest.accept')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="actions">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {items !== null && open.length > 1 && (
          <Button disabled={busy} onClick={() => void accept(open)} data-testid="ms-suggest-accept-all">
            {t('ms.suggest.acceptAll', { count: open.length })}
          </Button>
        )}
        {items === null && (
          <Button variant="primary" disabled={busy || !preview || preview.candidates === 0 || preview.overDailyCap} onClick={() => void send()} data-testid="ms-suggest-send">
            {t('schema.send')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

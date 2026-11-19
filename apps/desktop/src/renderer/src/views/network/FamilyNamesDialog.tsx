import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { formatTokens, formatUsd } from '../chat/format';
import { safeText } from '../library/safeText';
import { ModelPick, SendPreview } from '../projects/SendPreview';
import { bumpFamilyNames } from './grouping';

type Scope = RequestOf<Channels, 'graph:nameFamily'>['scope'];
type Preview = ResponseOf<Channels, 'graph:previewFamilyNames'>;
type Item = ResponseOf<Channels, 'graph:nameFamily'>['items'][number];

/**
 * "✦ Dai un nome con Claude" (D-489): same pattern as the manuscript proposals (D-416). Only the top tags and the titles of papers in
 * enabled folders are sent, after the exact text, the model and the cost are shown; each name stays a proposal until the user accepts
 * it, and accepted names are kept locally as labels of the automatic family.
 */
export default function FamilyNamesDialog({ scope, onClose }: { scope: Scope; onClose(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const [model, setModel] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const req = { ...(scope ? { scope } : {}), ...(model ? { model } : {}) };
  useEffect(() => {
    let live = true;
    setPreview(null);
    rl.invoke('graph:previewFamilyNames', req).then((p) => live && setPreview(p), reportError);
    return () => {
      live = false;
    };
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true);
    try {
      setItems((await rl.invoke('graph:nameFamily', { ...req, confirmed: true })).items);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const accept = async (list: Item[]) => {
    setBusy(true);
    try {
      for (const it of list) {
        await rl.invoke('graph:acceptFamilyName', { cluster: it.cluster, name: it.name, ...(scope ? { scope } : {}) });
        setDone((d) => new Set(d).add(it.cluster));
      }
      bumpFamilyNames();
      info(t('network.group.named'));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const open = (items ?? []).filter((i) => !done.has(i.cluster));
  return (
    <Dialog title={t('network.group.nameTitle')} onClose={onClose} testId="family-names-dialog">
      <div className="dlg-scroll">
        {items === null ? (
          <>
            <ModelPick value={model} onChange={setModel} preferHaiku />
            {preview && preview.candidates === 0 && (
              <p className="empty" data-testid="family-names-nothing">
                {t('network.group.nameNothing')}
              </p>
            )}
            {preview && preview.candidates > 0 && (
              <SendPreview text={preview.text} what={t('network.group.nameWhat', { count: preview.candidates })} facts={`${t('schema.tokens', { tokens: formatTokens(preview.approxTokens) })} · ${preview.estimatedUsd === null ? t('schema.noPrice') : t('schema.usd', { usd: formatUsd(preview.estimatedUsd) })}`} blocked={preview.overDailyCap ? t('schema.capReached') : null} testId="family-names-preview" />
            )}
          </>
        ) : items.length === 0 ? (
          <p className="empty" data-testid="family-names-none">
            {t('network.group.nameNone')}
          </p>
        ) : (
          <ul className="schema-evidence" data-testid="family-names-proposals">
            {items.map((it) => (
              <li key={it.cluster} data-testid="family-names-proposal" data-cluster={it.cluster}>
                <span aria-hidden="true">✦ </span>
                {safeText(it.current)} → <strong>{safeText(it.name)}</strong>{' '}
                <Button size="sm" disabled={busy || done.has(it.cluster)} onClick={() => void accept([it])} data-testid="family-names-accept">
                  {t('network.group.nameAccept')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="actions">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {items !== null && open.length > 1 && (
          <Button disabled={busy} onClick={() => void accept(open)} data-testid="family-names-accept-all">
            {t('network.group.nameAcceptAll', { count: open.length })}
          </Button>
        )}
        {items === null && (
          <Button variant="primary" disabled={busy || !preview || preview.candidates === 0 || preview.overDailyCap} onClick={() => void send()} data-testid="family-names-send">
            {t('schema.send')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';

type Item = ResponseOf<Channels, 'annotations:externalList'>['items'][number];

/**
 * The highlights and underlines that other programs wrote into the PDF (J5, §8.3.14): read and listed, nothing changes until the user
 * chooses "Import into the app" (then they become annotations of the app, like those made in the reader; the PDF is not touched).
 * Lazy: loaded when the user opens the list.
 */
export default function ExternalAnnotations({ docId, onClose }: { docId: string; onClose(): void }) {
  const { t } = useTranslation();
  const { info, reportError } = useNotify();
  const [data, setData] = useState<{ items: Item[]; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    rl.invoke('annotations:externalList', { docId }).then(
      (r) => {
        if (!alive) return;
        setData(r);
        setPicked(new Set(r.items.filter((i) => !i.inApp).map((i) => i.key)));
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [docId]);

  const toggle = (key: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      const r = await rl.invoke('annotations:externalImport', { docId, keys: [...picked] });
      info(t('reader.pdf.externalImported', { count: r.imported }));
      onClose();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  return (
    <Dialog title={t('reader.pdf.externalTitle')} onClose={onClose} testId="pdf-external-dialog">
      <div className="pdf-dialog">
        <p>{t('reader.pdf.externalBody')}</p>
        {failed && <p data-testid="pdf-external-failed">{t('reader.pdf.externalFailed')}</p>}
        {data && items.length === 0 && <p data-testid="pdf-external-empty">{t('reader.pdf.externalNone')}</p>}
        {items.length > 0 && (
          <ul className="pdf-external-list" data-testid="pdf-external-list">
            {items.map((i) => (
              <li key={i.key} data-testid="pdf-external-item" data-kind={i.kind} data-page={i.page} data-in-app={i.inApp}>
                <label>
                  <input type="checkbox" checked={picked.has(i.key)} disabled={i.inApp || busy} onChange={() => toggle(i.key)} />{' '}
                  {t('reader.pdf.externalRow', { kind: t(`reader.pdf.kind_${i.kind}`), page: i.page })}
                  {i.author ? ` · ${i.author}` : ''}
                  {i.inApp ? ` · ${t('reader.pdf.externalInApp')}` : ''}
                </label>
                {i.comment && <div className="hint">{i.comment}</div>}
              </li>
            ))}
          </ul>
        )}
        {data?.truncated && <p className="hint">{t('reader.pdf.externalTruncated')}</p>}
        <div className="pdf-dialog__actions">
          <Button onClick={onClose}>{t('reader.pdf.cancel')}</Button>
          <Button variant="primary" disabled={busy || picked.size === 0} onClick={() => void run()} data-testid="pdf-external-import">
            {t('reader.pdf.externalImport', { count: picked.size })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

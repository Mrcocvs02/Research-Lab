import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Lazy, lazyView } from '../../components/Lazy';
import { useChangeVersion } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import type { RGroup, RItem } from './ReaderMenu';

// The list of the annotations made by other programs and their import (J5): loaded when the user opens it.
const ExternalAnnotations = lazyView(() => import('./ExternalAnnotations'), ['reader']);

export type PdfState = ResponseOf<Channels, 'annotations:pdfState'>;
type Ask = null | 'consent' | 'remove' | 'restore' | 'external';

/**
 * The PDF group of the Study menu and what hangs from it (§8.3.7, §8.3.8, D-410): the state of the document's PDF, the writes the
 * user asks for, the consent and the two ways back. The main process decides everything (`study/pdf-sync.ts`); this keeps the state
 * fresh (the library events, the progress event of this document) and writes what is pending when the reader closes (D-349).
 * Without an answer from the main process (writing off in this build) the state is `null` and the group says "Only in the app".
 */
export function usePdfWrite(docId: string, onError: (e: unknown) => void) {
  const version = useChangeVersion('annotations');
  const [st, setSt] = useState<PdfState | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [lost, setLost] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const { info, fail: notifyFail } = useNotify();
  const stRef = useRef(st);
  stRef.current = st;
  const edited = useRef(false);
  const fail = useRef(onError);
  fail.current = onError;

  const read = useCallback(() => rl.invoke('annotations:pdfState', { docId }).then(setSt, () => setSt(null)), [docId]);
  useEffect(() => {
    let alive = true;
    rl.invoke('annotations:pdfState', { docId }).then(
      (s) => alive && setSt(s),
      () => alive && setSt(null),
    );
    return () => {
      alive = false;
    };
  }, [docId, version]);
  useEffect(() => {
    if (version > 0) edited.current = true;
  }, [version]);
  useEffect(() => rl.on('annotations:pdfProgress', (e) => e.docId === docId && void read()), [docId, read]);
  // The document closes (or the reader switches document): what is pending is written now (D-349).
  useEffect(
    () => () => {
      const s = stRef.current;
      if (s && s.mode === 'write' && !s.needsConsent && s.state !== 'none' && s.state !== 'refused' && (edited.current || s.state === 'pending')) void rl.invoke('annotations:writeNow', { docId }).catch(() => {});
    },
    [docId],
  );

  const run = useCallback(
    async (f: () => Promise<PdfState | void>) => {
      setBusy(true);
      try {
        const s = await f();
        if (s) setSt(s);
        else await read();
      } catch (e) {
        fail.current(e);
        await read();
      } finally {
        setBusy(false);
      }
    },
    [read],
  );

  return {
    state: st,
    busy,
    ask,
    lost,
    setAsk,
    /** The consent question is open and the document has annotations: the banner shows, and closing the reader asks once. */
    consentOpen: (annotations: number) => st !== null && st.needsConsent && annotations > 0,
    choose: (choice: 'pdf' | 'app-only') => {
      setAsk(null);
      void run(async () => {
        await rl.invoke('annotations:confirmPdfWrite', { choice });
      });
    },
    writeNow: () => run(() => rl.invoke('annotations:writeNow', { docId })),
    setMode: (mode: 'write' | 'app-only') => run(() => rl.invoke('annotations:setPdfMode', { docId, mode })),
    removeFromPdf: () => run(() => rl.invoke('annotations:removeFromPdf', { docId })),
    restore: () =>
      run(async () => {
        await rl.invoke('annotations:restoreOriginal', { docId });
      }),
    /** "Export an annotated copy" (§8.3.14): the folder is picked in the main process; the original is never touched. */
    exportCopy: async () => {
      setBusy(true);
      try {
        const picked = await rl.invoke('dialog:chooseFolder', { purpose: 'export-destination', title: t('reader.pdf.exportFolderTitle') });
        if (!picked) return;
        const r = await rl.invoke('annotations:exportCopy', { docId, destination: picked.path });
        info(t('reader.pdf.exported', { file: r.file, count: r.annotations }));
      } catch (e) {
        const reason = RlError.from(e).details?.['reason'];
        const known = typeof reason === 'string' && ['encrypted', 'permission', 'signed', 'xfa', 'damaged', 'too-large', 'verify-failed', 'changed', 'inside-library', 'no-annotations', 'unavailable'].includes(reason);
        if (known) notifyFail(t(`reader.pdf.exportReasons.${reason}`));
        else fail.current(e);
      } finally {
        setBusy(false);
      }
    },
    resolveMissing: (choice: 'rewrite' | 'delete') => run(() => rl.invoke('annotations:resolveMissing', { docId, choice })),
    openRestore: () => {
      setLost(undefined);
      setAsk('restore');
      void rl.invoke('annotations:pdfState', { docId, inspect: true }).then(
        (s) => setLost(s.droppedOnRestore),
        () => {},
      );
    },
  };
}
export type PdfWrite = ReturnType<typeof usePdfWrite>;

/** The line that states where the annotations are: the heading of the PDF group and the "In the PDF" row of the Info panel. */
export function usePdfStatusText(): (st: PdfState | null) => string {
  const { t, i18n } = useTranslation();
  return (st) => {
    if (!st || st.mode === 'off') return t('reader.pdfOnlyApp');
    if (st.needsConsent) return t('reader.pdf.needsConsent');
    if (st.mode === 'app-only') return t('reader.pdf.appOnlyDoc');
    if (st.state === 'writing') return t('reader.pdf.writing');
    if (st.state === 'refused') return t('reader.pdf.refused', { reason: t(`reader.pdf.reasons.${st.reason ?? 'damaged'}`) });
    if (st.state === 'pending') return st.reason ? t('reader.pdf.refused', { reason: t(`reader.pdf.reasons.${st.reason}`) }) : t('reader.pdf.pending');
    if (st.state === 'synced' && st.lastWrittenAt) return t('reader.pdf.inPdfAt', { time: new Date(st.lastWrittenAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) });
    return st.state === 'synced' ? t('reader.pdf.inPdf') : t('reader.pdfOnlyApp');
  };
}

/** The PDF group of the Study menu: at most three entries (the menu keeps to seven, D-402). */
export function usePdfGroup(pdf: PdfWrite): RGroup {
  const { t } = useTranslation();
  const text = usePdfStatusText();
  const st = pdf.state;
  const off = !st || st.mode === 'off' ? t('reader.pdfOff') : undefined;
  const writing = st?.mode === 'write' && !st.needsConsent;
  const items: RItem[] = [
    {
      id: 'save',
      label: t('reader.pdfSave'),
      testId: 'reader-pdf-save',
      checked: writing,
      ...(off ? { disabled: off } : {}),
      onSelect: () => (st?.needsConsent ? pdf.setAsk('consent') : void pdf.setMode(writing ? 'app-only' : 'write')),
    },
  ];
  if (writing && st && (st.state === 'pending' || st.state === 'refused')) items.push({ id: 'now', label: t('reader.pdf.writeNow'), testId: 'reader-pdf-write-now', onSelect: () => void pdf.writeNow() });
  items.push({ id: 'remove', label: t('reader.pdfRemove'), testId: 'reader-pdf-remove', ...(off ? { disabled: off } : {}), onSelect: () => pdf.setAsk('remove') });
  // The annotated copy is exported from the More menu of the bar (one place, one state), not from here.
  return { id: 'pdf', heading: text(st), headingId: 'reader-pdf-status', items };
}

/** The "In the PDF" row of the Info panel: the state, what waits, the annotations of other programs, and the way back. */
export function PdfInfoRow({ pdf }: { pdf: PdfWrite }) {
  const { t } = useTranslation();
  const text = usePdfStatusText();
  const st = pdf.state;
  return (
    <>
      <span data-testid="reader-info-pdf">{text(st)}</span>
      {st && st.mode !== 'off' && (
        <span className="hint" data-testid="reader-info-pdf-detail">
          {st.appOnly > 0 && st.mode === 'write' && ` · ${t('reader.pdf.appOnlyCount', { count: st.appOnly })}`}
          {st.needsRepair > 0 && ` · ${t('reader.pdf.needsRepair', { count: st.needsRepair })}`}
          {st.external > 0 && ` · ${t('reader.pdf.external', { count: st.external })}`}
        </span>
      )}
      {st && st.missing > 0 && (
        <div data-testid="reader-pdf-missing">
          <div className="hint">{t('reader.pdf.missing', { count: st.missing })}</div>
          <div className="pdf-info-actions">
            <Button size="sm" onClick={() => void pdf.resolveMissing('rewrite')} data-testid="reader-pdf-rewrite">
              {t('reader.pdf.rewrite')}
            </Button>
            <Button size="sm" onClick={() => void pdf.resolveMissing('delete')} data-testid="reader-pdf-delete-here">
              {t('reader.pdf.deleteHere')}
            </Button>
          </div>
        </div>
      )}
      <div className="pdf-info-actions">
        <Button size="sm" onClick={() => pdf.setAsk('external')} data-testid="reader-pdf-external">
          {t('reader.pdf.externalOpen')}
        </Button>
        <Button size="sm" disabled={pdf.busy} onClick={() => void pdf.exportCopy()} data-testid="reader-pdf-export-info">
          {t('reader.pdf.exportCopy')}
        </Button>
      </div>
      {st?.canRestore && (
        <div className="pdf-info-actions">
          <Button size="sm" onClick={pdf.openRestore} data-testid="reader-pdf-restore">
            {t('reader.pdf.restore')}
          </Button>
        </div>
      )}
    </>
  );
}

/** The two confirmations: take the highlights out of the PDF, and put the file back byte for byte. */
export function PdfConfirmDialogs({ pdf, docId }: { pdf: PdfWrite; docId: string }) {
  const { t } = useTranslation();
  const close = () => pdf.setAsk(null);
  if (pdf.ask === 'external')
    return (
      <Lazy>
        <ExternalAnnotations docId={docId} onClose={close} />
      </Lazy>
    );
  if (pdf.ask === 'remove') {
    return (
      <Dialog title={t('reader.pdf.removeTitle')} onClose={close} testId="pdf-remove-dialog">
        <div className="pdf-dialog">
          <p>{t('reader.pdf.removeBody')}</p>
          <div className="pdf-dialog__actions">
            <Button onClick={close}>{t('reader.pdf.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                void pdf.removeFromPdf();
              }}
              data-testid="pdf-remove-confirm"
            >
              {t('reader.pdf.removeConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }
  if (pdf.ask === 'restore') {
    return (
      <Dialog title={t('reader.pdf.restoreTitle')} onClose={close} testId="pdf-restore-dialog">
        <div className="pdf-dialog">
          <p>{t('reader.pdf.restoreBody')}</p>
          {pdf.lost !== undefined && pdf.lost > 0 && (
            <p>
              <strong data-testid="pdf-restore-lost">{t('reader.pdf.restoreLost', { count: pdf.lost })}</strong>
            </p>
          )}
          <div className="pdf-dialog__actions">
            <Button onClick={close}>{t('reader.pdf.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                close();
                void pdf.restore();
              }}
              data-testid="pdf-restore-confirm"
            >
              {t('reader.pdf.restoreConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }
  return null;
}

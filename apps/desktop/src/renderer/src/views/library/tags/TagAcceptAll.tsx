import { useTranslation } from 'react-i18next';
import { Dialog } from '../../../components/Dialog';

/** Confirmation of "Accept all" (D-512): how many of each kind, and that one Undo takes everything back. */
export function TagAcceptAll({ sure, likely, busy, onClose, onConfirm }: { sure: number; likely: number; busy: boolean; onClose(): void; onConfirm(): void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('tax.acceptAll.title')} onClose={onClose} testId="tag-accept-all-dialog">
      <div className="dlg-scroll">
        <p>{t('tax.acceptAll.what', { sure, likely })}</p>
        <p className="hint">{t('tax.acceptAll.undo')}</p>
      </div>
      <div className="actions dlg-foot">
        <button type="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={onConfirm} data-testid="tag-accept-all-confirm">
          {t('tax.acceptAll.confirm', { count: sure + likely })}
        </button>
      </div>
    </Dialog>
  );
}

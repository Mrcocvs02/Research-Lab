import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';

/**
 * The library's consent to write highlights into the PDFs (D-348, D-374). Two faces of the same question, with the same two answers:
 * a banner that does not steal the focus, shown at the first annotation of the library, and a dialog shown once, when the reader
 * closes and the question is still open. "Yes" sets `writeToPdfConfirmedAt`, "Only in the app" turns `writeToPdf` off; closing the
 * dialog without choosing answers nothing (nothing is written, the banner returns at the next annotation).
 */
export interface ConsentProps {
  onChoose(choice: 'pdf' | 'app-only'): void;
}

export function PdfConsentBanner({ onChoose }: ConsentProps) {
  const { t } = useTranslation();
  const slot = document.querySelector<HTMLElement>('[data-testid="banner-slot"]');
  const banner = (
    <div data-testid="pdf-consent-banner">
      <Banner tone="info">
        <strong>{t('reader.pdf.consentTitle')}</strong> {t('reader.pdf.consentBody')}
        <span className="pdf-info-actions">
          <Button size="sm" onClick={() => onChoose('app-only')} data-testid="pdf-consent-app-only">
            {t('reader.pdf.consentAppOnly')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => onChoose('pdf')} data-testid="pdf-consent-pdf">
            {t('reader.pdf.consentPdf')}
          </Button>
        </span>
      </Banner>
    </div>
  );
  return slot ? createPortal(banner, slot) : banner;
}

export function PdfConsentDialog({ onChoose, onClose }: ConsentProps & { onClose(): void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('reader.pdf.consentTitle')} onClose={onClose} testId="pdf-consent-dialog">
      <div className="pdf-dialog">
        <p>{t('reader.pdf.consentBody')}</p>
        <div className="pdf-dialog__actions">
          <Button onClick={onClose} data-testid="pdf-consent-later">
            {t('reader.pdf.consentLater')}
          </Button>
          <Button onClick={() => onChoose('app-only')} data-testid="pdf-consent-dialog-app-only">
            {t('reader.pdf.consentAppOnly')}
          </Button>
          <Button variant="primary" onClick={() => onChoose('pdf')} data-testid="pdf-consent-dialog-pdf">
            {t('reader.pdf.consentPdf')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

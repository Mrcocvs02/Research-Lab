import { useTranslation } from 'react-i18next';
import { Banner } from '../components/Banner';
import { safeText } from '../views/library/safeText';

/** The one banner of Resume (17.4.5): shown once, after the reader was left open by an unclean close. */
export default function ResumeBanner({ title, page, onResume, onClose }: { title: string | null; page: number | null; onResume(): void; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <div data-testid="resume-banner">
      <Banner tone="info" action={{ label: t('resume.action'), onClick: onResume }} onClose={onClose}>
        {t('resume.banner', { title: safeText(title ?? t('resume.untitled')), where: page ? t('resume.page', { page }) : '' })}
      </Banner>
    </div>
  );
}

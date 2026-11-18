import { useTranslation } from 'react-i18next';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import type { BibStatus } from './useBibStatus';

/** The linked .bib file cannot be rewritten as it is (D-421): changed outside the app, gone, or a write error. */
export function BibBanner({ projectId, status }: { projectId: string; status: BibStatus | null }) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  if (!status?.linked || status.state === 'ok') return null;
  const act = (op: 'overwrite' | 'unlink') => () => void rl.invoke('bib:link', { projectId, op }).catch(reportError);
  return (
    <div data-testid="bib-banner" data-state={status.state}>
      <Banner tone={status.state === 'error' ? 'error' : 'warning'} action={{ label: status.state === 'changed-outside' ? t('projects.bib.overwrite') : status.state === 'missing' ? t('projects.bib.recreate') : t('projects.bib.retry'), onClick: act('overwrite') }}>
        {t(`projects.bib.state.${status.state}`, { file: status.file })}{' '}
        <Button size="sm" variant="ghost" onClick={act('unlink')} data-testid="bib-unlink">
          {t('projects.bib.unlink')}
        </Button>
      </Banner>
    </div>
  );
}

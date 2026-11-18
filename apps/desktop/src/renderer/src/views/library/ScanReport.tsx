import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScanReport as Report } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { rl } from '../../lib/rl';
import { baseName } from './fileName';
import { safeText } from './safeText';

type Group = 'added' | 'changed' | 'moved' | 'missing' | 'failed';
const GROUPS: Group[] = ['added', 'changed', 'moved', 'missing', 'failed'];
/** How many documents of a group are named: the rest is a count ("and N more"). */
export const SHOWN = 8;

/** The title of a document for the report: its title, else the file name; a document that is gone from the index keeps its id. */
async function titleOf(docId: string): Promise<string> {
  try {
    const d = await rl.invoke('documents:get', { docId });
    return safeText(d.title?.trim() || baseName(d.path));
  } catch {
    return docId;
  }
}

function GroupRow({ group, ids, total }: { group: Group; ids: readonly string[]; total: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [titles, setTitles] = useState<string[] | null>(null);
  useEffect(() => {
    if (!open || titles !== null) return;
    let alive = true;
    void Promise.all(ids.slice(0, SHOWN).map(titleOf)).then((x) => alive && setTitles(x));
    return () => {
      alive = false;
    };
  }, [open, titles, ids]);
  const n = Math.max(total, ids.length);
  return (
    <li className="scan-report__row" data-testid={`scan-report-${group}`} data-count={n}>
      <button type="button" className="scan-report__head" aria-expanded={open} disabled={ids.length === 0} onClick={() => setOpen(!open)}>
        <span className="scan-report__label">{t(`library.scanReport.${group}`)}</span>
        <b className="scan-report__count">{n}</b>
      </button>
      {group === 'failed' && n > 0 && <p className="hint">{t('library.scanReport.failedHint')}</p>}
      {open && (
        <ul className="scan-report__docs">
          {(titles ?? []).map((x, i) => (
            <li key={ids[i]}>{x}</li>
          ))}
          {ids.length > SHOWN && <li className="hint">{t('library.scanReport.more', { count: ids.length - SHOWN })}</li>}
        </ul>
      )}
    </li>
  );
}

/** The outcome of the last finished scan (9, 4.9): how many new, changed, moved, missing and unreadable files, each group open on demand. */
export function ScanReport({ onClose }: { onClose(): void }) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    rl.invoke('scan:report', {}).then(
      (r) => alive && setReport(r),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);
  const finished = report?.finishedAt ? new Date(report.finishedAt) : null;
  const when = finished && !Number.isNaN(finished.getTime()) ? finished.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const s = report?.summary;
  const count = (g: Group): number => (!s ? 0 : g === 'added' ? s.added : g === 'changed' ? s.changed : g === 'moved' ? s.moved : g === 'missing' ? s.missing : s.failed);
  return (
    <Dialog title={t('library.scanReport.title')} onClose={onClose} testId="scan-report">
      <div className="scan-report">
        {failed && <p className="hint">{t('library.scanReport.failed')}</p>}
        {report && !when && <p className="hint">{t('library.scanReport.none')}</p>}
        {report && when && (
          <>
            <p className="scan-report__when">{t('library.scanReport.when', { when })}</p>
            {report.firstScan && <p className="hint">{t('library.scanReport.first')}</p>}
            <ul className="scan-report__list">
              {GROUPS.map((g) => (
                <GroupRow key={g} group={g} ids={report[g]} total={count(g)} />
              ))}
            </ul>
            {report.truncated && <p className="hint">{t('library.scanReport.truncated')}</p>}
          </>
        )}
        <div className="actions">
          <Button variant="primary" onClick={onClose} data-testid="scan-report-close">
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REPORT_AUDIENCES, REPORT_PARTS, type Channels, type ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { formatTokens, formatUsd } from '../chat/format';
import { SendPreview } from './SendPreview';

type Preview = ResponseOf<Channels, 'project:reportPreview'>;
type Audience = (typeof REPORT_AUDIENCES)[number];
type Part = (typeof REPORT_PARTS)[number];

/** "✦ Resoconto del periodo…" (§17.4.14, D-400): period, audience and parts, then the exact text that goes, then the draft (editable, marked ✦). */
export default function ReportDialog({ projectId, open, onClose, onSaved }: { projectId: string; /** The date of a saved report to open and edit. */ open?: string; onClose(): void; onSaved(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const [days, setDays] = useState(14);
  const [audience, setAudience] = useState<Audience>('advisor');
  const [parts, setParts] = useState<Part[]>([...REPORT_PARTS]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ date: string; body: string } | null>(null);
  const req = { projectId, days, audience, parts };
  useEffect(() => {
    if (open) void rl.invoke('project:reportGet', { projectId, date: open }).then((r) => setDraft({ date: open, body: r.body }), reportError);
  }, [open, projectId, reportError]);
  // Any change of the options makes the preview stale: it is made again on demand.
  useEffect(() => setPreview(null), [days, audience, parts]);
  const togglePart = (p: Part) => setParts((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const show = async () => {
    setBusy(true);
    try {
      setPreview(await rl.invoke('project:reportPreview', req));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      setDraft(await rl.invoke('project:reportRun', { ...req, confirmed: true }));
      onSaved();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('schema.report.title')} onClose={onClose} testId="report-dialog">
      <div className="dlg-scroll">
        {draft ? (
          <div className="field">
            <label htmlFor="report-body">
              <span aria-hidden="true">✦ </span>
              {t('schema.report.ready', { date: draft.date })}
            </label>
            <textarea id="report-body" rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} data-testid="report-body" />
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="report-days">{t('schema.report.period')}</label>
              <select id="report-days" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="report-days">
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {t('schema.report.lastDays', { count: d })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="report-audience">{t('schema.report.audience')}</label>
              <select id="report-audience" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} data-testid="report-audience">
                {REPORT_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`schema.report.aud_${a}`)}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="schema-parts">
              <legend>{t('schema.report.parts')}</legend>
              {REPORT_PARTS.map((p) => (
                <label key={p}>
                  <input type="checkbox" checked={parts.includes(p)} onChange={() => togglePart(p)} data-testid={`report-part-${p}`} /> {t(`schema.report.part_${p}`)}
                </label>
              ))}
            </fieldset>
            {preview && (
              <SendPreview text={preview.text} what={t('schema.report.what')} facts={`${t('schema.tokens', { tokens: formatTokens(preview.approxTokens) })} · ${preview.estimatedUsd === null ? t('schema.noPrice') : t('schema.usd', { usd: formatUsd(preview.estimatedUsd) })}`} blocked={preview.overDailyCap ? t('schema.capReached') : null} testId="report-preview" />
            )}
          </>
        )}
      </div>
      <div className="actions">
        {draft ? (
          <>
            <Button onClick={() => void navigator.clipboard.writeText(draft.body).then(() => info(t('schema.report.copied')))} data-testid="report-copy">
              {t('schema.report.copy')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void rl.invoke('project:reportSave', { projectId, date: draft.date, body: draft.body }).then(() => (onSaved(), onClose()), reportError)}
              data-testid="report-save"
            >
              {t('common.save')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            {preview?.ready ? (
              <Button variant="primary" disabled={busy || preview.overDailyCap} onClick={() => void send()} data-testid="report-send">
                {t('schema.send')}
              </Button>
            ) : (
              <Button variant="primary" disabled={busy || parts.length === 0} onClick={() => void show()} data-testid="report-preview-button">
                {t('schema.preview')}
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

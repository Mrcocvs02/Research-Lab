import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { CheckField, ErrorNote, SelectField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { defaultChoices, reasonKey, type Analysis, type CollectionsChoice, type ImportChoices, type ImportResult } from './importModel';
import '../chat/dialogs.css';
import './import.css';

type Step = 'file' | 'match' | 'summary' | 'done';

/**
 * "Add > From Zotero or BibTeX…" (17.4.2): three steps — the file, the match with the PDFs, the summary — then the result.
 * The file is only read; documents already in the library get the missing data, PDFs found elsewhere go through the inbox.
 */
export default function ImportDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { invalidateAll } = useLibraryEvents();
  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [choices, setChoices] = useState<ImportChoices | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [undone, setUndone] = useState(false);

  const fail = (e: unknown) => setError(errorMessage(e, t));

  const choose = async () => {
    setError(null);
    setBusy(true);
    try {
      const f = await rl.invoke('dialog:chooseFile', { purpose: 'bib-source', title: t('import.chooseTitle') });
      if (!f) return;
      const a = await rl.invoke('bib:analyze', { path: f.path });
      setAnalysis(a);
      setChoices(defaultChoices(a));
      setStep('match');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!analysis || !choices) return;
    setError(null);
    setBusy(true);
    try {
      setResult(await rl.invoke('bib:import', { previewId: analysis.previewId, ...choices }));
      setStep('done');
      invalidateAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!result?.changeId) return;
    setBusy(true);
    try {
      await rl.invoke('history:undo', { changeId: result.changeId });
      setUndone(true);
      invalidateAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<ImportChoices>) => setChoices((c) => (c ? { ...c, ...patch } : c));

  return (
    <Dialog title={t('import.title')} onClose={onClose} testId="import-dialog">
      <div className="dlg-scroll import-dialog">
        <ol className="import-steps" aria-label={t('import.steps')}>
          {(['file', 'match', 'summary'] as const).map((s, i) => (
            <li key={s} aria-current={step === s ? 'step' : undefined} className={step === s ? 'is-current' : undefined}>
              {i + 1}. {t(`import.step.${s}`)}
            </li>
          ))}
        </ol>
        {error && <ErrorNote testId="import-error">{error}</ErrorNote>}

        {step === 'file' && (
          <div className="group">
            <p className="hint">{t('import.fileHint')}</p>
            <Button variant="primary" busy={busy} onClick={() => void choose()} data-testid="import-choose">
              {t('import.choose')}
            </Button>
          </div>
        )}

        {step === 'match' && analysis && (
          <div className="group" data-testid="import-match">
            <p data-testid="import-counts">{t('import.counts', { withFile: analysis.withFile, noFile: analysis.noFile, inLibrary: analysis.inLibrary })}</p>
            <p className="hint">{t('import.matchHint', { count: analysis.entries })}</p>
          </div>
        )}

        {step === 'summary' && analysis && choices && (
          <div className="group" data-testid="import-summary">
            {analysis.tags > 0 && <CheckField label={t('import.optTags', { count: analysis.tags })} checked={choices.tags} onChange={(e) => set({ tags: e.target.checked })} data-testid="import-opt-tags" />}
            {analysis.collections.length > 0 && (
              <SelectField label={t('import.optCollections', { count: analysis.collections.length })} value={choices.collections} onChange={(e) => set({ collections: e.target.value as CollectionsChoice })} data-testid="import-opt-collections">
                <option value="projects">{t('import.colProjects')}</option>
                <option value="tags">{t('import.colTags')}</option>
                <option value="ignore">{t('import.colIgnore')}</option>
              </SelectField>
            )}
            {analysis.notes > 0 && <CheckField label={t('import.optNotes', { count: analysis.notes })} checked={choices.notes} onChange={(e) => set({ notes: e.target.checked })} data-testid="import-opt-notes" />}
            {analysis.withFile > 0 && <CheckField label={t('import.optQueue', { count: analysis.withFile })} hint={t('import.optQueueHint')} checked={choices.queueFiles} onChange={(e) => set({ queueFiles: e.target.checked })} data-testid="import-opt-queue" />}
            <p className="hint">{t('import.originals')}</p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="group" data-testid="import-result">
            <p role="status">{undone ? t('import.undone') : t('import.result', { updated: result.updated, tagged: result.tagged, projects: result.projects, notes: result.notes, queued: result.queued })}</p>
            {result.notImported.length > 0 && (
              <details open data-testid="import-not-imported">
                <summary>{t('import.notImported', { count: result.notImported.length })}</summary>
                <ul className="import-skipped">
                  {result.notImported.map((r, i) => (
                    <li key={i}>
                      {safeText(r.label)} <span className="hint">({t(`import.reason.${reasonKey(r.reason)}`)})</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
      <div className="actions dlg-foot">
        {step === 'done' ? (
          <>
            {result?.changeId && !undone && (
              <Button busy={busy} onClick={() => void undo()} data-testid="import-undo">
                {t('import.undo')}
              </Button>
            )}
            <Button variant="primary" onClick={onClose} data-testid="import-close">
              {t('common.close')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            {step === 'match' && (
              <Button variant="primary" onClick={() => setStep('summary')} data-testid="import-next">
                {t('import.next')}
              </Button>
            )}
            {step === 'summary' && (
              <Button variant="primary" busy={busy} onClick={() => void run()} data-testid="import-run">
                {t('import.run')}
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

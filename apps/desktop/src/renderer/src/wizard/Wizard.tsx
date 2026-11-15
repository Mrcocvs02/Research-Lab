import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_DATA_DIR_NAME, dataDirNameSchema, userProfileSchema, type ImportJobStatus, type Language } from '@rl/core';
import { CheckField, ErrorNote, LanguageSelect, ProgressBar, TextAreaField, TextField } from '../components/ui';
import { FolderTree, type FolderEntry } from '../components/FolderTree';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { splitLines, validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';

type StepId = 'language' | 'profile' | 'folder' | 'details' | 'legacy' | 'taxonomy' | 'aiFolders' | 'summary';
type Taxonomy = 'empty' | 'file' | 'claude';
type Phase = 'form' | 'creating' | 'importing';

interface Picked {
  path: string;
  name: string;
}
interface LegacyProbe {
  found: boolean;
  documents: number;
  taxonomyNodes: number;
}

interface Props {
  /** Called when the wizard ends (library created, import finished or skipped). */
  onFinished(libraryId: string): void;
  /** Present only when closing is allowed (at least one library exists). */
  onCancel?: (() => void) | undefined;
}

/** Guided creation of a library; also the first-run experience. */
export function Wizard({ onFinished, onCancel }: Props) {
  const { t } = useTranslation();
  const app = useApp();
  const includeUserSteps = !(app.settings?.firstRunDone ?? false);

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<unknown>(null);

  // Step data
  const [uiLanguage, setUiLanguage] = useState<Language>(app.settings?.uiLanguage ?? 'it');
  const [profile, setProfile] = useState({ name: '', variants: '', email: '', orcid: '', openAlexId: '' });
  const [root, setRoot] = useState<Picked | null>(null);
  const [libName, setLibName] = useState('');
  const [docLanguage, setDocLanguage] = useState<Language>(app.settings?.uiLanguage ?? 'it');
  const [dataDirName, setDataDirName] = useState(DEFAULT_DATA_DIR_NAME);
  const [legacy, setLegacy] = useState<LegacyProbe | null>(null);
  const [importLegacy, setImportLegacy] = useState(false);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>('empty');
  const [taxonomyFile, setTaxonomyFile] = useState<Picked | null>(null);
  const [aiFolders, setAiFolders] = useState<string[]>([]);
  const [aiConfirmed, setAiConfirmed] = useState(false);

  // Import progress
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ImportJobStatus>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [importError, setImportError] = useState<unknown>(null);

  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = [];
    if (includeUserSteps) s.push('language', 'profile');
    s.push('folder', 'details');
    if (legacy?.found) s.push('legacy');
    s.push('taxonomy', 'aiFolders', 'summary');
    return s;
  }, [includeUserSteps, legacy?.found]);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step, phase]);

  useEffect(() => rl.on('import:progress', (s) => setStatuses((prev) => ({ ...prev, [s.jobId]: s }))), []);

  const profileValue = useMemo(
    () => ({
      name: profile.name,
      authorVariants: splitLines(profile.variants),
      email: profile.email.trim(),
      orcid: profile.orcid.trim(),
      openAlexId: profile.openAlexId.trim(),
    }),
    [profile],
  );
  const profileCheck = useMemo(() => validateWith(userProfileSchema, profileValue), [profileValue]);
  const dirCheck = useMemo(() => validateWith(dataDirNameSchema, dataDirName.trim()), [dataDirName]);
  const nameValid = libName.trim().length > 0 && libName.trim().length <= 120;
  const fieldError = (errors: Record<string, string>, key: string) => (errors[key] ? t(validationKey(key)) : undefined);

  const canNext = (() => {
    switch (step) {
      case 'language':
        return true;
      case 'profile':
        return profileCheck.data !== null;
      case 'folder':
        return root !== null;
      case 'details':
        return nameValid && dirCheck.data !== null;
      case 'legacy':
        return true;
      case 'taxonomy':
        return taxonomy !== 'claude' && (taxonomy !== 'file' || taxonomyFile !== null);
      case 'aiFolders':
        return aiConfirmed;
      case 'summary':
        return false;
    }
  })();

  const loadFolders = useCallback(
    async (parent: string): Promise<FolderEntry[]> => {
      if (!root) return [];
      const r = await rl.invoke('library:listFolders', { rootPath: root.path, ...(parent ? { parent } : {}) });
      return r.folders;
    },
    [root],
  );

  const chooseRoot = async () => {
    setError(null);
    try {
      const picked = await rl.invoke('dialog:chooseFolder', { purpose: 'library-root', title: t('wizard.folder.dialogTitle') });
      if (!picked) return;
      setRoot(picked);
      setLibName((cur) => (cur.trim() ? cur : picked.name));
      setAiFolders([]);
      setAiConfirmed(false);
      setImportLegacy(false);
      const probe = await rl.invoke('import:probeLegacy', { rootPath: picked.path }).catch(() => null);
      setLegacy(probe);
      if (probe?.found) {
        setImportLegacy(true);
        setTaxonomy('empty');
      }
    } catch (e) {
      setError(e);
    }
  };

  const chooseTaxonomyFile = async () => {
    setError(null);
    try {
      const picked = await rl.invoke('dialog:chooseFile', { purpose: 'taxonomy-file', title: t('wizard.taxonomy.dialogTitle') });
      if (picked) setTaxonomyFile(picked);
    } catch (e) {
      setError(e);
    }
  };

  const changeUiLanguage = async (next: Language) => {
    setUiLanguage(next);
    setDocLanguage(next);
    try {
      await app.setUiLanguage(next);
    } catch (e) {
      setError(e);
    }
  };

  const startImport = async (libraryId: string, sourcePath: string) => {
    setPhase('importing');
    setImportError(null);
    try {
      const { jobId: id } = await rl.invoke('import:startLegacy', { libraryId, sourcePath });
      setJobId(id);
    } catch (e) {
      setImportError(e);
    }
  };

  const create = async () => {
    if (!root || phase !== 'form') return;
    setPhase('creating');
    setError(null);
    try {
      if (includeUserSteps && profileCheck.data) {
        await rl.invoke('settings:set', { uiLanguage, user: profileCheck.data });
      }
      const profileRecord = await rl.invoke('library:create', {
        name: libName.trim(),
        rootPath: root.path,
        language: docLanguage,
        dataDirName: dataDirName.trim(),
        aiEnabledFolders: aiFolders,
        ...(taxonomy === 'file' && taxonomyFile && !importLegacy ? { taxonomyFilePath: taxonomyFile.path } : {}),
      });
      await rl.invoke('library:setActive', { libraryId: profileRecord.id });
      await rl.invoke('settings:set', { firstRunDone: true });
      setCreatedId(profileRecord.id);
      if (importLegacy && legacy?.found) {
        await startImport(profileRecord.id, root.path);
      } else {
        onFinished(profileRecord.id);
      }
    } catch (e) {
      setError(e);
      setPhase('form');
    }
  };

  const status = jobId ? statuses[jobId] : undefined;

  /* ---------------------------------------------------------------- */

  if (phase === 'importing') {
    return (
      <WizardFrame title={t('wizard.import.runningTitle')} headingRef={headingRef}>
        {!importError && (!status || status.state === 'running') && (
          <div data-testid="import-progress">
            <p>{t('wizard.import.running')}</p>
            <ProgressBar value={status?.processed ?? 0} max={status?.total} label={t('wizard.import.progressLabel')} />
            <p className="hint" aria-live="polite">
              {status?.total !== undefined
                ? t('wizard.import.counts', { done: status.processed, total: status.total })
                : t('wizard.import.countsUnknown', { done: status?.processed ?? 0 })}
            </p>
          </div>
        )}
        {(importError || status?.state === 'failed' || status?.state === 'cancelled') && (
          <div data-testid="import-failed">
            <ErrorNote>{importError ? errorMessage(importError, t) : errorMessage(status?.error ?? { code: 'INTERNAL', message: '' }, t)}</ErrorNote>
            <p className="hint">{t('wizard.import.failedHint')}</p>
            <div className="actions">
              <button type="button" className="primary" onClick={() => createdId && onFinished(createdId)} data-testid="import-continue">
                {t('wizard.import.continueWithout')}
              </button>
            </div>
          </div>
        )}
        {status?.state === 'done' && (
          <div data-testid="import-done">
            <p>{t('wizard.import.done', { documents: status.report?.documents ?? 0, nodes: status.report?.taxonomyNodes ?? 0 })}</p>
            {status.report && status.report.warnings.length > 0 && <p className="hint">{t('wizard.import.warnings', { count: status.report.warnings.length })}</p>}
            <div className="actions">
              <button type="button" className="primary" onClick={() => createdId && onFinished(createdId)} data-testid="import-open">
                {t('wizard.import.open')}
              </button>
            </div>
          </div>
        )}
      </WizardFrame>
    );
  }

  const isLast = step === 'summary';
  const back = () => setStepIndex((i) => Math.max(0, i - 1));
  const next = () => setStepIndex((i) => Math.min(steps.length - 1, i + 1));

  return (
    <WizardFrame
      title={t(`wizard.steps.${step}`)}
      headingRef={headingRef}
      progress={{ current: stepIndex + 1, total: steps.length }}
      onCancel={onCancel}
      footer={
        <div className="actions">
          <button type="button" onClick={back} disabled={stepIndex === 0 || phase === 'creating'} data-testid="wizard-back">
            {t('wizard.back')}
          </button>
          {isLast ? (
            <button type="button" className="primary" onClick={() => void create()} disabled={phase === 'creating'} data-testid="wizard-create">
              {phase === 'creating' ? t('wizard.creating') : t('wizard.create')}
            </button>
          ) : (
            <button type="button" className="primary" onClick={next} disabled={!canNext} data-testid="wizard-next">
              {t('wizard.next')}
            </button>
          )}
        </div>
      }
    >
      {step === 'language' && (
        <>
          <p>{t('wizard.language.intro')}</p>
          <LanguageSelect label={t('wizard.language.label')} value={uiLanguage} onChange={(v) => void changeUiLanguage(v)} testId="wizard-ui-language" />
        </>
      )}

      {step === 'profile' && (
        <>
          <p>{t('wizard.profile.intro')}</p>
          <TextField label={t('profile.name')} placeholder={t('profile.namePlaceholder')} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} data-testid="wizard-profile-name" />
          <TextAreaField
            label={t('profile.variants')}
            hint={t('profile.variantsHint')}
            placeholder={t('profile.variantsPlaceholder')}
            rows={3}
            value={profile.variants}
            onChange={(e) => setProfile({ ...profile, variants: e.target.value })}
            data-testid="wizard-profile-variants"
          />
          <TextField label={t('profile.email')} type="email" placeholder="name@example.org" value={profile.email} error={fieldError(profileCheck.errors, 'email')} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          <TextField label={t('profile.orcid')} placeholder="0000-0000-0000-0000" value={profile.orcid} error={fieldError(profileCheck.errors, 'orcid')} onChange={(e) => setProfile({ ...profile, orcid: e.target.value })} />
          <TextField label={t('profile.openAlexId')} placeholder="A1234567890" value={profile.openAlexId} error={fieldError(profileCheck.errors, 'openAlexId')} onChange={(e) => setProfile({ ...profile, openAlexId: e.target.value })} />
          <p className="hint">{t('wizard.profile.optional')}</p>
        </>
      )}

      {step === 'folder' && (
        <>
          <p>{t('wizard.folder.intro')}</p>
          <div className="actions start">
            <button type="button" className="primary" onClick={() => void chooseRoot()} data-testid="wizard-choose-folder">
              {root ? t('wizard.folder.change') : t('wizard.folder.choose')}
            </button>
          </div>
          {root && (
            <p className="chosen" data-testid="wizard-folder-chosen">
              <strong>{root.name}</strong>
              <span className="path">{root.path}</span>
            </p>
          )}
          <p className="hint">{t('wizard.folder.safe')}</p>
        </>
      )}

      {step === 'details' && (
        <>
          <TextField label={t('library.name')} value={libName} maxLength={120} onChange={(e) => setLibName(e.target.value)} data-testid="wizard-lib-name" />
          <LanguageSelect label={t('library.language')} hint={t('library.languageHint')} value={docLanguage} onChange={setDocLanguage} testId="wizard-doc-language" />
          <TextField
            label={t('library.dataDirName')}
            hint={t('library.dataDirNameHint')}
            value={dataDirName}
            error={dirCheck.data === null ? t('validation.dataDirName') : undefined}
            onChange={(e) => setDataDirName(e.target.value)}
            data-testid="wizard-data-dir"
          />
        </>
      )}

      {step === 'legacy' && legacy && (
        <>
          <p>{t('wizard.legacy.intro')}</p>
          <ul className="facts" data-testid="legacy-preview">
            <li>{t('wizard.legacy.documents', { count: legacy.documents })}</li>
            <li>{t('wizard.legacy.taxonomy', { count: legacy.taxonomyNodes })}</li>
          </ul>
          <CheckField label={t('wizard.legacy.import')} checked={importLegacy} onChange={(e) => setImportLegacy(e.target.checked)} hint={t('wizard.legacy.readOnly')} data-testid="wizard-import-legacy" />
        </>
      )}

      {step === 'taxonomy' && (
        <>
          <p>{t('wizard.taxonomy.intro')}</p>
          {importLegacy && <p className="hint">{t('wizard.taxonomy.fromImport')}</p>}
          <fieldset disabled={importLegacy}>
            <legend>{t('wizard.taxonomy.legend')}</legend>
            <div className="radio">
              <input type="radio" id="tax-empty" name="taxonomy" checked={taxonomy === 'empty'} onChange={() => setTaxonomy('empty')} data-testid="wizard-taxonomy-empty" />
              <label htmlFor="tax-empty">{t('wizard.taxonomy.empty')}</label>
            </div>
            <div className="radio">
              <input type="radio" id="tax-file" name="taxonomy" checked={taxonomy === 'file'} onChange={() => setTaxonomy('file')} data-testid="wizard-taxonomy-file" />
              <label htmlFor="tax-file">{t('wizard.taxonomy.file')}</label>
            </div>
            {taxonomy === 'file' && (
              <div className="indent">
                <button type="button" onClick={() => void chooseTaxonomyFile()} data-testid="wizard-choose-taxonomy">
                  {taxonomyFile ? t('wizard.taxonomy.changeFile') : t('wizard.taxonomy.chooseFile')}
                </button>
                {taxonomyFile && <span className="path">{taxonomyFile.name}</span>}
              </div>
            )}
            <div className="radio">
              <input type="radio" id="tax-claude" name="taxonomy" disabled checked={taxonomy === 'claude'} readOnly />
              <label htmlFor="tax-claude">{t('wizard.taxonomy.claude')}</label>
              <p className="hint">{t('wizard.taxonomy.claudeNote')}</p>
            </div>
          </fieldset>
        </>
      )}

      {step === 'aiFolders' && (
        <>
          <p>{t('wizard.ai.intro')}</p>
          <p className="callout">{t('wizard.ai.why')}</p>
          <FolderTree load={loadFolders} value={aiFolders} onChange={(v) => { setAiFolders(v); setAiConfirmed(false); }} ariaLabel={t('wizard.ai.treeLabel')} testId="wizard-ai-tree" />
          <p className="hint">{aiFolders.length === 0 ? t('wizard.ai.noneSelected') : t('wizard.ai.selected', { count: aiFolders.length })}</p>
          <CheckField
            label={aiFolders.length === 0 ? t('wizard.ai.confirmNone') : t('wizard.ai.confirmSome', { count: aiFolders.length })}
            checked={aiConfirmed}
            onChange={(e) => setAiConfirmed(e.target.checked)}
            data-testid="wizard-ai-confirm"
          />
        </>
      )}

      {step === 'summary' && (
        <>
          <p>{t('wizard.summary.intro')}</p>
          <dl className="summary" data-testid="wizard-summary">
            <dt>{t('library.name')}</dt>
            <dd>{libName.trim()}</dd>
            <dt>{t('wizard.summary.folder')}</dt>
            <dd className="path">{root?.path}</dd>
            <dt>{t('library.language')}</dt>
            <dd>{t(`languages.${docLanguage}`)}</dd>
            <dt>{t('library.dataDirName')}</dt>
            <dd>{dataDirName.trim()}</dd>
            <dt>{t('wizard.summary.import')}</dt>
            <dd>{importLegacy ? t('wizard.summary.importYes', { count: legacy?.documents ?? 0 }) : t('common.no')}</dd>
            <dt>{t('wizard.summary.taxonomy')}</dt>
            <dd>{importLegacy ? t('wizard.summary.taxonomyImport') : taxonomy === 'file' ? (taxonomyFile?.name ?? '') : t('wizard.taxonomy.empty')}</dd>
            <dt>{t('wizard.summary.ai')}</dt>
            <dd>{aiFolders.length === 0 ? t('wizard.summary.aiNone') : aiFolders.join(', ')}</dd>
          </dl>
        </>
      )}

      {error ? <ErrorNote testId="wizard-error">{errorMessage(error, t)}</ErrorNote> : null}
    </WizardFrame>
  );
}

function WizardFrame({
  title,
  headingRef,
  progress,
  onCancel,
  footer,
  children,
}: {
  title: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  progress?: { current: number; total: number };
  onCancel?: (() => void) | undefined;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="wizard-backdrop">
      <section className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" data-testid="wizard">
        <header>
          <p className="eyebrow">{t('wizard.title')}</p>
          <h1 id="wizard-title" ref={headingRef} tabIndex={-1} data-testid="wizard-step-title">
            {title}
          </h1>
          {progress && (
            <p className="hint" data-testid="wizard-progress">
              {t('wizard.progress', { current: progress.current, total: progress.total })}
            </p>
          )}
        </header>
        <div className="wizard-body">{children}</div>
        <footer>
          {footer}
          {onCancel && (
            <button type="button" className="link" onClick={onCancel} data-testid="wizard-cancel">
              {t('wizard.cancel')}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

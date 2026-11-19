import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_DATA_DIR_NAME, dataDirNameSchema, userProfileSchema, type ImportJobStatus, type Language, type ScanStatus } from '@rl/core';
import { Button } from '../components/Button';
import { Switch } from '../components/Switch';
import { CheckField, ErrorNote, LanguageSelect, ProgressBar, TextField } from '../components/ui';
import { FolderTree, type FolderEntry } from '../components/FolderTree';
import { flushAll } from '../lib/dirtyEditors';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';
import './wizard.css';

type StepId = 'language' | 'folder' | 'details' | 'legacy' | 'taxonomy' | 'aiFolders' | 'summary';
type Taxonomy = 'empty' | 'file' | 'claude';
type Phase = 'form' | 'creating' | 'importing' | 'scanning';

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
  const [userName, setUserName] = useState('');
  const [root, setRoot] = useState<Picked | null>(null);
  const [libName, setLibName] = useState('');
  const [docLanguage, setDocLanguage] = useState<Language>(app.settings?.uiLanguage ?? 'it');
  const [dataDirName, setDataDirName] = useState(DEFAULT_DATA_DIR_NAME);
  const [legacy, setLegacy] = useState<LegacyProbe | null>(null);
  const [importLegacy, setImportLegacy] = useState(false);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>('empty');
  const [taxonomyFile, setTaxonomyFile] = useState<Picked | null>(null);
  const [aiFolders, setAiFolders] = useState<string[]>([]);
  // D-348: completing the wizard with the switch on is the library's consent to write highlights into the PDFs (`library:create` stores it).
  const [writeToPdf, setWriteToPdf] = useState(true);
  const [scan, setScan] = useState<ScanStatus | null>(null);

  // Import progress
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ImportJobStatus>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [importError, setImportError] = useState<unknown>(null);

  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = [];
    if (includeUserSteps) s.push('language');
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
  useEffect(() => {
    if (phase !== 'scanning' || !createdId) return;
    return rl.on('scan:progress', (s) => {
      if (s.libraryId === createdId) setScan(s);
    });
  }, [phase, createdId]);

  const profileValue = useMemo(() => ({ name: userName, authorVariants: [] as string[], email: '', orcid: '', openAlexId: '' }), [userName]);
  const profileCheck = useMemo(() => validateWith(userProfileSchema, profileValue), [profileValue]);
  const dirCheck = useMemo(() => validateWith(dataDirNameSchema, dataDirName.trim()), [dataDirName]);
  const nameValid = libName.trim().length > 0 && libName.trim().length <= 120;
  const nameError = profileCheck.errors['name'] ? t(validationKey('name')) : undefined;

  const canNext = (() => {
    switch (step) {
      case 'language':
        return true;
      case 'folder':
        return root !== null && dirCheck.data !== null;
      case 'details':
        return nameValid && dirCheck.data !== null && (!includeUserSteps || profileCheck.data !== null);
      case 'legacy':
        return true;
      case 'taxonomy':
        return taxonomy !== 'claude' && (taxonomy !== 'file' || taxonomyFile !== null);
      case 'aiFolders':
        return true;
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
        writeToPdf,
        ...(taxonomy === 'file' && taxonomyFile && !importLegacy ? { taxonomyFilePath: taxonomyFile.path } : {}),
      });
      await flushAll(); // unsaved notes belong to the library that is active until now
      await rl.invoke('library:setActive', { libraryId: profileRecord.id });
      await rl.invoke('settings:set', { firstRunDone: true });
      setCreatedId(profileRecord.id);
      if (importLegacy && legacy?.found) {
        await startImport(profileRecord.id, root.path);
      } else {
        // The last step (4.9): the first scan runs here and is seen, not waited for.
        setScan(null);
        setPhase('scanning');
        void rl.invoke('scan:start', {}).then((st) => setScan((cur) => cur ?? st), () => {});
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

  if (phase === 'scanning') {
    return (
      <WizardFrame
        title={t('wizard.steps.scan')}
        headingRef={headingRef}
        progress={{ current: steps.length + 1, total: steps.length + 1 }}
        footer={
          <div className="wizard-foot">
            <span className="wizard-foot__spacer" />
            {!scanEnded(scan) && (
              <Button onClick={() => createdId && onFinished(createdId)} data-testid="wizard-scan-background">
                {t('wizard.scan.continue')}
              </Button>
            )}
            <Button variant="primary" onClick={() => createdId && onFinished(createdId)} disabled={!scanEnded(scan)} disabledReason={t('wizard.scan.wait')} data-testid="wizard-scan-open">
              {t('wizard.scan.open')}
            </Button>
          </div>
        }
      >
        <FirstScan status={scan} />
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
      progress={{ current: stepIndex + 1, total: steps.length + 1 }}
      footer={
        <div className="wizard-foot">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={phase === 'creating'} data-testid="wizard-cancel">
              {t('wizard.cancel')}
            </Button>
          )}
          <span className="wizard-foot__spacer" />
          {step === 'taxonomy' && !importLegacy && (
            <Button
              variant="ghost"
              onClick={() => {
                setTaxonomy('empty');
                setTaxonomyFile(null);
                next();
              }}
              data-testid="wizard-skip"
            >
              {t('wizard.skip')}
            </Button>
          )}
          {stepIndex > 0 && (
            <Button onClick={back} disabled={phase === 'creating'} data-testid="wizard-back">
              {t('wizard.back')}
            </Button>
          )}
          {isLast ? (
            <Button variant="primary" onClick={() => void create()} disabled={phase === 'creating'} busy={phase === 'creating'} data-testid="wizard-create">
              {phase === 'creating' ? t('wizard.creating') : t('wizard.create')}
            </Button>
          ) : (
            <Button variant="primary" onClick={next} disabled={!canNext} data-testid="wizard-next">
              {t('wizard.next')}
            </Button>
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

      {step === 'folder' && (
        <>
          <p>{t('wizard.folder.intro')}</p>
          <div className="wizard-folder">
            {root ? (
              <p className="chosen" data-testid="wizard-folder-chosen" title={root.path}>
                <strong>{root.name}</strong>
                <span className="path">{abbreviatePath(root.path)}</span>
              </p>
            ) : null}
            <Button variant={root ? 'secondary' : 'primary'} onClick={() => void chooseRoot()} data-testid="wizard-choose-folder">
              {root ? t('wizard.folder.change') : t('wizard.folder.choose')}
            </Button>
          </div>
          <p className="hint">{t('wizard.folder.safe')}</p>
          <details className="wizard-advanced" data-testid="wizard-advanced">
            <summary>{t('wizard.folder.advanced')}</summary>
            <TextField
              label={t('library.dataDirName')}
              hint={t('library.dataDirNameHint')}
              value={dataDirName}
              error={dirCheck.data === null ? t('validation.dataDirName') : undefined}
              onChange={(e) => setDataDirName(e.target.value)}
              data-testid="wizard-data-dir"
            />
          </details>
        </>
      )}

      {step === 'details' && (
        <>
          <TextField label={t('library.name')} value={libName} maxLength={120} onChange={(e) => setLibName(e.target.value)} data-testid="wizard-lib-name" />
          <LanguageSelect label={t('library.language')} hint={t('library.languageHint')} value={docLanguage} onChange={setDocLanguage} testId="wizard-doc-language" />
          {includeUserSteps && <TextField label={t('wizard.details.yourName')} hint={t('wizard.details.yourNameHint')} placeholder={t('profile.namePlaceholder')} value={userName} error={nameError} onChange={(e) => setUserName(e.target.value)} data-testid="wizard-profile-name" />}
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
            <div className="rl-radio">
              <input type="radio" id="tax-empty" name="taxonomy" checked={taxonomy === 'empty'} onChange={() => setTaxonomy('empty')} data-testid="wizard-taxonomy-empty" />
              <label htmlFor="tax-empty">{t('wizard.taxonomy.empty')}</label>
            </div>
            <div className="rl-radio">
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
            <div className="rl-radio">
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
          <FolderTree load={loadFolders} value={aiFolders} onChange={setAiFolders} ariaLabel={t('wizard.ai.treeLabel')} testId="wizard-ai-tree" />
          <p className="hint" data-testid="wizard-ai-note">
            {aiFolders.length === 0 ? t('wizard.ai.noneSelected') : t('wizard.ai.selected', { count: aiFolders.length })}
          </p>
          <p className="hint">{t('wizard.ai.why')}</p>
        </>
      )}

      {step === 'summary' && (
        <>
          <p>{t('wizard.summary.intro')}</p>
          <dl className="summary" data-testid="wizard-summary">
            <dt>{t('library.name')}</dt>
            <dd>{libName.trim()}</dd>
            <dt>{t('wizard.summary.folder')}</dt>
            <dd className="path" title={root?.path}>
              {root ? abbreviatePath(root.path) : ''}
            </dd>
            <dt>{t('library.language')}</dt>
            <dd>{t(`languages.${docLanguage}`)}</dd>
            <dt>{t('wizard.summary.import')}</dt>
            <dd>{importLegacy ? t('wizard.summary.importYes', { count: legacy?.documents ?? 0 }) : t('common.no')}</dd>
            <dt>{t('wizard.summary.taxonomy')}</dt>
            <dd>{importLegacy ? t('wizard.summary.taxonomyImport') : taxonomy === 'file' ? (taxonomyFile?.name ?? '') : t('wizard.taxonomy.empty')}</dd>
            <dt>{t('wizard.summary.ai')}</dt>
            <dd>{aiFolders.length === 0 ? t('wizard.summary.aiNone') : aiFolders.join(', ')}</dd>
          </dl>
          <div className="wizard-consent" data-testid="wizard-consent">
            <Switch checked={writeToPdf} onChange={setWriteToPdf} label={t('wizard.summary.writeToPdf')} data-testid="wizard-write-to-pdf" />
            <p className="hint">{t('wizard.summary.writeToPdfHint')}</p>
          </div>
          {/* The consent hint above already says what the PDFs get; only the "off" case needs its own line. */}
          {!writeToPdf && (
            <p className="wizard-createnote" data-testid="wizard-create-note">
              {t('wizard.summary.appOnly')}
            </p>
          )}
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
  footer,
  children,
}: {
  title: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  progress?: { current: number; total: number };
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="wizard-backdrop">
      <section className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" data-testid="wizard">
        <header>
          <p className="eyebrow" data-testid="wizard-progress">
            {progress ? t('wizard.progress', { current: progress.current, total: progress.total }) : t('wizard.title')}
          </p>
          <h1 id="wizard-title" ref={headingRef} tabIndex={-1} data-testid="wizard-step-title">
            {title}
          </h1>
        </header>
        <div className="wizard-body">{children}</div>
        <footer>{footer}</footer>
      </section>
    </div>
  );
}

/** A path for the screen: the drive or first folder, an ellipsis and the last two folders (the full path stays in the tooltip). */
export function abbreviatePath(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 4) return p;
  const lead = /^[A-Za-z]:$/.test(parts[0] ?? '') ? `${parts[0]}\\` : `/${parts[0] ?? ''}/`;
  return `${lead}…/${parts.slice(-2).join('/')}`;
}

const scanEnded = (status: ScanStatus | null): boolean => status !== null && (status.state === 'done' || status.state === 'failed' || status.state === 'cancelled');

const SCAN_PHASES = ['walking', 'hashing', 'extracting', 'indexing'] as const;

/** The last step: the first scan with what it is doing, and the two ways out (4.9). */
function FirstScan({ status }: { status: ScanStatus | null }) {
  const { t } = useTranslation();
  const ended = scanEnded(status);
  const current = status?.state === 'running' && status.phase ? SCAN_PHASES.indexOf(status.phase) : ended ? SCAN_PHASES.length : 0;
  const count = (p: (typeof SCAN_PHASES)[number]): string => {
    if (!status) return '';
    if (p === 'walking') {
      // While the next step shows "180 / 220", this one shows the same total, not the count so far.
      const n = status.phase === 'hashing' ? (status.total ?? status.seen) : status.seen;
      return n > 0 ? t('wizard.scan.files', { count: n }) : '';
    }
    if (p === 'hashing') return status.phase === 'hashing' && status.total !== undefined ? `${status.seen} / ${status.total}` : '';
    if (p === 'extracting') return status.phase === 'extracting' && status.total !== undefined ? `${status.processed} / ${status.total}` : '';
    return '';
  };
  const failed = status?.summary?.failed ?? 0;
  return (
    <div data-testid="wizard-scan" data-state={status?.state ?? 'starting'}>
      <p>{t('wizard.scan.intro')}</p>
      <ul className="wizard-scan__steps">
        {SCAN_PHASES.map((p, i) => {
          const state = i < current ? 'done' : i === current ? 'now' : 'next';
          return (
            <li key={p} className="wizard-scan__step" data-state={state} data-phase={p}>
              <span className="wizard-scan__mark" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'now' ? '⟳' : '○'}
              </span>
              <span className="wizard-scan__name">{t(`wizard.scan.phase_${p}`)}</span>
              <span className="wizard-scan__count">{count(p)}</span>
            </li>
          );
        })}
      </ul>
      {status?.state === 'running' && status.phase === 'extracting' && status.total ? <ProgressBar value={status.processed} max={status.total} label={t('scan.label')} /> : null}
      {status?.state === 'done' && (
        <p data-testid="wizard-scan-result" aria-live="polite">
          {failed > 0 ? t('wizard.scan.resultFailed', { count: status.indexed, failed }) : t('wizard.scan.result', { count: status.indexed })}
        </p>
      )}
      {status?.state === 'failed' && <ErrorNote testId="wizard-scan-failed">{t('scan.failed')}</ErrorNote>}
      <p className="hint">{t('wizard.scan.background')}</p>
    </div>
  );
}

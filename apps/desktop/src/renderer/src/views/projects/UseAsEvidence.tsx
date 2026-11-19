import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';

type Projects = ResponseOf<Channels, 'projects:list'>['items'];
type Info = ResponseOf<Channels, 'project:schema'>;

const NEW = '';
type Sections = NonNullable<ResponseOf<Channels, 'project:manuscript'>['manuscript']>['sections'];

/**
 * "Usa come prova" (§17.4.15), from the popover of a highlight in the reader: asks in which project (the document need not be in it:
 * it is offered to add it), under which claim (or a new one, written from the highlighted text) and whether the highlight supports or contradicts it.
 * The highlight is saved as a link `lab://doc/<id>?page=N&ann=<annId>`; nothing is sent anywhere.
 */
export default function UseAsEvidence({ docId, annId, page, text, onClose }: { docId: string; annId: string; page: number; text: string; onClose(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const { invalidate } = useLibraryEvents();
  const [projects, setProjects] = useState<Projects | null>(null);
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<Info | null>(null);
  const [isMember, setIsMember] = useState(true);
  const [addIt, setAddIt] = useState(true);
  const [claimId, setClaimId] = useState(NEW);
  const [claimText, setClaimText] = useState(text.replace(/\s+/g, ' ').trim().slice(0, 300));
  const [questionId, setQuestionId] = useState('');
  const [stance, setStance] = useState<'supports' | 'contradicts'>('supports');
  const [busy, setBusy] = useState(false);
  /** The sections of the manuscript of the project, when there is one (§18.1): the highlight can also go under one of them. */
  const [sections, setSections] = useState<Sections>([]);
  const [sectionId, setSectionId] = useState('');

  useEffect(() => {
    rl.invoke('projects:list', { kind: 'project' }).then((r) => {
      setProjects(r.items);
      if (r.items.length === 1) setProjectId(r.items[0]!.id);
    }, reportError);
  }, [reportError]);
  useEffect(() => {
    setData(null);
    setClaimId(NEW);
    setSections([]);
    setSectionId('');
    if (!projectId) return;
    let alive = true;
    void Promise.all([rl.invoke('project:schema', { projectId }), rl.invoke('projects:get', { id: projectId })]).then(([s, d]) => {
      if (!alive) return;
      setData(s);
      setIsMember(d.members.some((m) => m.docId === docId));
      setQuestionId(s.outline?.questions[0]?.id ?? '');
    }, reportError);
    void rl.invoke('project:manuscript', { projectId }).then((r) => alive && setSections((r.manuscript?.sections ?? []).filter((x) => !x.gone).sort((a, b) => a.order - b.order)), () => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, docId, reportError]);

  const save = async () => {
    setBusy(true);
    try {
      if (!isMember && addIt) await rl.invoke('projects:addMembers', { projectId, docIds: [docId] });
      await rl.invoke('project:addEvidence', {
        projectId,
        ...(claimId === NEW ? { newClaim: { text: claimText, questionId: questionId || null } } : { claimId }),
        evidence: { docId, page, annId, stance, excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 500) },
      });
      if (sectionId) await rl.invoke('project:assign', { projectId, sectionId, refs: [{ kind: 'ann', docId, annId, page }], on: true });
      invalidate('projects');
      info(t('schema.evidence.saved'));
      onClose();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };
  const claims = data?.claims ?? [];
  return (
    <Dialog title={t('schema.evidence.title')} onClose={onClose} testId="evidence-dialog">
      <div className="dlg-scroll">
        {projects && projects.length === 0 && <p data-testid="evidence-no-project">{t('schema.evidence.noProject')}</p>}
        {projects && projects.length > 0 && (
          <div className="field">
            <label htmlFor="evidence-project">{t('schema.evidence.project')}</label>
            <select id="evidence-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="evidence-project">
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {safeText(p.name)}
                </option>
              ))}
            </select>
          </div>
        )}
        {data && (
          <>
            {!isMember && (
              <label className="schema-parts">
                <input type="checkbox" checked={addIt} onChange={(e) => setAddIt(e.target.checked)} data-testid="evidence-add-member" /> {t('schema.evidence.addMember')}
              </label>
            )}
            <div className="field">
              <label htmlFor="evidence-claim">{t('schema.evidence.claim')}</label>
              <select id="evidence-claim" value={claimId} onChange={(e) => setClaimId(e.target.value)} data-testid="evidence-claim">
                <option value={NEW}>{t('schema.evidence.newClaim')}</option>
                {claims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {safeText(c.text).slice(0, 80)}
                  </option>
                ))}
              </select>
            </div>
            {claimId === NEW && (
              <>
                <div className="field">
                  <label htmlFor="evidence-text">{t('schema.claimText')}</label>
                  <input id="evidence-text" type="text" value={claimText} maxLength={600} onChange={(e) => setClaimText(e.target.value)} data-testid="evidence-text" />
                </div>
                {(data.outline?.questions.length ?? 0) > 0 && (
                  <div className="field">
                    <label htmlFor="evidence-question">{t('schema.claimQuestion')}</label>
                    <select id="evidence-question" value={questionId} onChange={(e) => setQuestionId(e.target.value)} data-testid="evidence-question">
                      <option value="">{t('schema.noQuestion')}</option>
                      {data.outline?.questions.map((q, i) => (
                        <option key={q.id} value={q.id}>
                          {t('schema.question', { n: i + 1 })}: {safeText(q.text).slice(0, 60)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
            {sections.length > 0 && (
              <div className="field">
                <label htmlFor="evidence-section">{t('ms.evidenceSection')}</label>
                <select id="evidence-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="evidence-section">
                  <option value="">{t('ms.noSection')}</option>
                  {sections.map((x) => (
                    <option key={x.id} value={x.id}>
                      {`${'– '.repeat(x.level - 1)}${safeText(x.title)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="schema-parts" role="radiogroup" aria-label={t('schema.evidence.stance')}>
              {(['supports', 'contradicts'] as const).map((s) => (
                <label key={s}>
                  <input type="radio" name="evidence-stance" checked={stance === s} onChange={() => setStance(s)} data-testid={`evidence-stance-${s}`} /> {t(`schema.${s}`)}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="actions">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={busy || !data || (claimId === NEW && claimText.trim() === '')} onClick={() => void save()} data-testid="evidence-save">
          {t('common.save')}
        </Button>
      </div>
    </Dialog>
  );
}

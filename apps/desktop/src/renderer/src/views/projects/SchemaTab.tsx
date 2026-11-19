import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, Claim, Outline, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Lazy, lazyView } from '../../components/Lazy';
import { EmptyState } from '../../components/EmptyState';
import { IconProject } from '../../components/icons-shell';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { claimsByQuestion, claimState, draftToOutline, outlineToDraft, visibleClaims, type OutlineDraft } from './schemaModel';

const EvidenceDialog = lazyView(() => import('./EvidenceDialog'), ['projects']);

export type SchemaInfo = ResponseOf<Channels, 'project:schema'>;

const lines = (v: string) => v.split('\n');

/** The outline as four boxes (one question or hypothesis per line): saved on demand; a question that is only reworded keeps its claims (schemaModel). */
function OutlineEditor({ outline, onSave, onCancel }: { outline: Outline | null; onSave(o: Outline): void; onCancel?: (() => void) | undefined }) {
  const { t } = useTranslation();
  const [d, setD] = useState<OutlineDraft>(() => outlineToDraft(outline));
  const field = (key: keyof OutlineDraft, label: string, rows: number) => (
    <div className="field">
      <label htmlFor={`schema-${key}`}>{label}</label>
      <textarea id={`schema-${key}`} rows={rows} value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} data-testid={`schema-input-${key}`} />
    </div>
  );
  return (
    <form
      className="schema-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draftToOutline(d, outline));
      }}
      data-testid="schema-editor"
    >
      {field('idea', t('schema.ideaLabel'), 3)}
      {field('questions', t('schema.questionsLabel'), 4)}
      {field('hypotheses', t('schema.hypothesesLabel'), 3)}
      {field('plan', t('schema.planLabel'), 3)}
      <div className="actions">
        {onCancel && <Button onClick={onCancel}>{t('common.cancel')}</Button>}
        <Button type="submit" variant="primary" disabled={d.idea.trim() === '' && d.questions.trim() === ''} data-testid="schema-save">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function ClaimCard({ claim, titles, onChange, onRemove, onFind }: { claim: Claim; titles: ReadonlyMap<string, string>; onChange(c: Claim): void; onRemove(): void; onFind(): void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const state = claimState(claim);
  return (
    <li className="schema-claim" data-testid="schema-claim" data-state={state}>
      <div className="schema-claim__head">
        <span className="schema-claim__text">«{safeText(claim.text)}»</span>
        {state === 'none' && <Chip kind="status" tone="warning">{t('schema.noEvidence')}</Chip>}
        {state === 'disputed' && <Chip kind="status" tone="warning">{t('schema.disputed')}</Chip>}
        <Button variant="ghost" size="sm" onClick={onFind} data-testid="schema-find-evidence">
          {t('schema.findEvidence.button')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} data-testid="schema-claim-remove">
          {t('schema.removeClaim')}
        </Button>
      </div>
      <ul className="schema-evidence">
        {claim.evidence.map((e, i) => {
          const other = e.stance === 'supports' ? 'contradicts' : 'supports';
          return (
            <li key={`${e.docId}-${e.page}-${e.annId ?? i}`} data-testid="schema-evidence" data-stance={e.stance}>
              <span className="hint">{t(`schema.${e.stance}`)}:</span>
              <button type="button" className="link" onClick={() => nav.navigate({ view: 'reader', docId: e.docId, page: e.page })} title={e.excerpt ? safeText(e.excerpt) : undefined}>
                {safeText(titles.get(e.docId) ?? e.docId)} p. {e.page}
              </button>
              <button type="button" className="link" onClick={() => onChange({ ...claim, evidence: claim.evidence.map((x, j) => (j === i ? { ...x, stance: other } : x)) })} data-testid="schema-evidence-flip">
                {t('schema.flip', { stance: t(`schema.${other}`) })}
              </button>
              <button type="button" className="link" onClick={() => onChange({ ...claim, evidence: claim.evidence.filter((_, j) => j !== i) })} aria-label={t('schema.removeEvidence')} data-testid="schema-evidence-remove">
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** The "Schema" tab (§17.4.13-§17.4.15): the research outline with the claims and their evidence under each question; "Only evidence" is a filter, not a tab. */
export default function SchemaTab({ projectId, info, titles, onChanged }: { projectId: string; info: SchemaInfo; titles: ReadonlyMap<string, string>; onChanged(): void }) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const [only, setOnly] = useState(false);
  const [editing, setEditing] = useState(info.outline === null);
  const [adding, setAdding] = useState(false);
  const [claimText, setClaimText] = useState('');
  const [claimQuestion, setClaimQuestion] = useState('');
  const [finding, setFinding] = useState<string | null>(null);
  const { outline, claims } = info;
  const run = async (op: () => Promise<unknown>) => {
    try {
      await op();
      onChanged();
      return true;
    } catch (e) {
      reportError(e);
      return false;
    }
  };
  const saveClaim = (c: Omit<Claim, 'id'> & { id?: string }) => run(() => rl.invoke('project:saveClaim', { projectId, claim: c }));
  const groups = claimsByQuestion(outline, visibleClaims(claims, only), only);
  const noEvidenceAnywhere = claims.every((c) => c.evidence.length === 0);

  return (
    <div className="schema" data-testid="project-schema">
      <div className="schema-bar">
        <label className="schema-only">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} data-testid="schema-only-evidence" /> {t('schema.onlyEvidence')}
        </label>
        <span className="spacer" />
        {!editing && (
          <>
            <Button size="sm" onClick={() => setAdding(!adding)} data-testid="schema-add-claim">
              {t('schema.addClaim')}
            </Button>
            <Button size="sm" onClick={() => setEditing(true)} data-testid="schema-edit">
              {t('schema.edit')}
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <OutlineEditor
          outline={outline}
          onCancel={outline ? () => setEditing(false) : undefined}
          onSave={(o) => void run(() => rl.invoke('project:saveOutline', { projectId, outline: o })).then((ok) => ok && setEditing(false))}
        />
      ) : (
        <>
          {adding && (
            <form
              className="schema-add"
              onSubmit={(e) => {
                e.preventDefault();
                void saveClaim({ text: claimText, questionId: claimQuestion || null, evidence: [] }).then((ok) => ok && (setClaimText(''), setAdding(false)));
              }}
              data-testid="schema-claim-form"
            >
              <input type="text" value={claimText} maxLength={600} placeholder={t('schema.claimText')} aria-label={t('schema.claimText')} onChange={(e) => setClaimText(e.target.value)} data-testid="schema-claim-text" />
              <select value={claimQuestion} aria-label={t('schema.claimQuestion')} onChange={(e) => setClaimQuestion(e.target.value)} data-testid="schema-claim-question">
                <option value="">{t('schema.noQuestion')}</option>
                {(outline?.questions ?? []).map((q, i) => (
                  <option key={q.id} value={q.id}>
                    {t('schema.question', { n: i + 1 })}: {safeText(q.text).slice(0, 60)}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="primary" size="sm" disabled={claimText.trim() === ''} data-testid="schema-claim-save">
                {t('common.save')}
              </Button>
            </form>
          )}
          {!only && outline && (
            <dl className="schema-outline">
              <dt>{t('schema.idea')}</dt>
              <dd data-testid="schema-idea">{outline.idea.trim() ? safeText(outline.idea) : <span className="hint">{t('schema.emptyIdea')}</span>}</dd>
            </dl>
          )}
          {only && noEvidenceAnywhere && (
            <EmptyState icon={<IconProject size={24} />} title={t('schema.emptyEvidenceTitle')}>
              <span data-testid="schema-evidence-empty">{t('schema.emptyEvidence')}</span>
            </EmptyState>
          )}
          {groups.map((g) => (
            <section key={g.id ?? 'none'} className="schema-question" data-testid="schema-question" data-question-id={g.id ?? ''}>
              <h3>{g.index === null ? t('schema.noQuestionGroup') : `${t('schema.question', { n: g.index + 1 })}: ${safeText(g.text)}`}</h3>
              {g.claims.length === 0 ? (
                <p className="hint" data-testid="schema-no-claims">
                  {t('schema.noClaims')}
                </p>
              ) : (
                <ul className="schema-claims">
                  {g.claims.map((c) => (
                    <ClaimCard key={c.id} claim={c} titles={titles} onChange={(next) => void saveClaim(next)} onRemove={() => void run(() => rl.invoke('project:removeClaim', { projectId, id: c.id }))} onFind={() => setFinding(c.id)} />
                  ))}
                </ul>
              )}
            </section>
          ))}
          {!only && outline && (
            <dl className="schema-outline">
              <dt>{t('schema.hypotheses', { count: outline.hypotheses.length })}</dt>
              <dd>{outline.hypotheses.length === 0 ? <span className="hint">{t('schema.emptyHyp')}</span> : lines(outline.hypotheses.join('\n')).map((h) => <p key={h}>{safeText(h)}</p>)}</dd>
              <dt>{t('schema.plan')}</dt>
              <dd>{outline.plan.trim() ? safeText(outline.plan) : <span className="hint">{t('schema.emptyPlan')}</span>}</dd>
            </dl>
          )}
        </>
      )}
      {finding !== null && claims.some((c) => c.id === finding) && (
        <Lazy>
          <EvidenceDialog projectId={projectId} claim={claims.find((c) => c.id === finding)!} onClose={() => setFinding(null)} onAccepted={onChanged} />
        </Lazy>
      )}
    </div>
  );
}

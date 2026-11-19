import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, Outline, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { formatTokens, formatUsd } from '../chat/format';
import { safeText } from '../library/safeText';
import { SendPreview } from './SendPreview';
import { citeSnippet, noteParagraphs } from './schemaModel';

type Preview = ResponseOf<Channels, 'project:citePreview'>;
type Items = ResponseOf<Channels, 'project:citeRun'>['items'];

/**
 * "✦ Suggerisci citazioni…" (§17.4.16, D-423): ONE paragraph of the project's notes at a time. The paragraphs of the user are not
 * covered by the consent of the folders: the first use asks for the consent of this project (revocable here), and every send
 * shows the exact text that leaves. Up to three candidates, with the reason and the page; the key can be copied or the paper
 * assigned to a question.
 */
export default function CiteDialog({ projectId, notes, outline, onClose, onAssigned }: { projectId: string; notes: string; outline: Outline | null; onClose(): void; onAssigned(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const paragraphs = useMemo(() => noteParagraphs(notes), [notes]);
  const [pick, setPick] = useState(() => paragraphs.find((p) => !p.cited)?.index ?? paragraphs[0]?.index ?? 0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [items, setItems] = useState<Items | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState(outline?.questions[0]?.id ?? '');
  const paragraph = paragraphs.find((p) => p.index === pick);
  const guard = async <T,>(op: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await op();
    } catch (e) {
      reportError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const show = async () => {
    if (paragraph) setPreview((await guard(() => rl.invoke('project:citePreview', { projectId, text: paragraph.text }))) ?? null);
  };
  const consent = async (granted: boolean) => {
    await guard(() => rl.invoke('project:consent', { projectId, granted }));
    await show();
  };
  const send = async () => {
    if (paragraph) setItems((await guard(() => rl.invoke('project:citeRun', { projectId, text: paragraph.text, confirmed: true })))?.items ?? null);
  };
  const copy = (key: string, style: 'latex' | 'pandoc') => void navigator.clipboard.writeText(citeSnippet(key, style)).then(() => info(t('schema.cite.copied')));
  const assign = async (docId: string) => {
    if (await guard(() => rl.invoke('project:assignCitation', { projectId, questionId: question, docId }))) {
      info(t('schema.cite.assigned'));
      onAssigned();
    }
  };
  const facts = (p: Preview) => `${t('schema.tokens', { tokens: formatTokens(p.approxTokens) })} · ${p.estimatedUsd === null ? t('schema.noPrice') : t('schema.usd', { usd: formatUsd(p.estimatedUsd) })}`;
  return (
    <Dialog title={t('schema.cite.title')} onClose={onClose} testId="cite-dialog">
      <div className="dlg-scroll">
        {items ? (
          items.length === 0 ? (
            <p data-testid="cite-none">{t('schema.cite.none')}</p>
          ) : (
            <ul className="schema-cites">
              {items.map((c) => (
                <li key={c.docId} data-testid="cite-item">
                  <b>{safeText(c.title)}</b>{' '}
                  <span className="hint">
                    {safeText(c.authors.join(', '))}
                    {c.year ? ` · ${c.year}` : ''}
                    {c.page ? ` · p. ${c.page}` : ''}
                  </span>
                  <p>{safeText(c.reason)}</p>
                  <div className="schema-cites__row">
                    <Button size="sm" onClick={() => copy(c.key, 'latex')} data-testid="cite-copy-latex">
                      {`\\cite{${c.key}}`}
                    </Button>
                    <Button size="sm" onClick={() => copy(c.key, 'pandoc')} data-testid="cite-copy-pandoc">
                      {`[@${c.key}]`}
                    </Button>
                    {outline && outline.questions.length > 0 && (
                      <>
                        <select value={question} aria-label={t('schema.claimQuestion')} onChange={(e) => setQuestion(e.target.value)} data-testid="cite-question">
                          {outline.questions.map((q, i) => (
                            <option key={q.id} value={q.id}>
                              {t('schema.question', { n: i + 1 })}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" disabled={busy} onClick={() => void assign(c.docId)} data-testid="cite-assign">
                          {t('schema.cite.assign')}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : paragraphs.length === 0 ? (
          <p data-testid="cite-no-paragraph">{t('schema.cite.noParagraph')}</p>
        ) : (
          <>
            <fieldset className="schema-paragraphs">
              <legend>{t('schema.cite.pick')}</legend>
              {paragraphs.map((p) => (
                <label key={p.index}>
                  <input type="radio" name="cite-paragraph" checked={pick === p.index} onChange={() => (setPick(p.index), setPreview(null))} data-testid="cite-paragraph" />
                  <span>
                    {safeText(p.text.slice(0, 160))}
                    {p.cited && <span className="hint"> · {t('schema.cite.cited')}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
            {preview && !preview.consent && (
              <div className="callout" data-testid="cite-consent">
                <p>{t('schema.cite.consentText')}</p>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void consent(true)} data-testid="cite-consent-give">
                  {t('schema.cite.consentGive')}
                </Button>
              </div>
            )}
            {preview && preview.consent && preview.candidates === 0 && <p data-testid="cite-no-candidates">{t('schema.cite.noCandidates')}</p>}
            {preview && preview.consent && preview.candidates > 0 && (
              <>
                <SendPreview text={preview.text} what={t('schema.cite.what', { count: preview.candidates })} facts={facts(preview)} blocked={preview.overDailyCap ? t('schema.capReached') : null} testId="cite-preview" />
                <button type="button" className="link" onClick={() => void consent(false)} data-testid="cite-consent-revoke">
                  {t('schema.cite.consentRevoke')}
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div className="actions">
        <Button onClick={onClose}>{items ? t('common.close') : t('common.cancel')}</Button>
        {!items &&
          paragraphs.length > 0 &&
          (preview?.consent && preview.candidates > 0 ? (
            <Button variant="primary" disabled={busy || preview.overDailyCap} onClick={() => void send()} data-testid="cite-send">
              {t('schema.send')}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || !paragraph} onClick={() => void show()} data-testid="cite-preview-button">
              {t('schema.preview')}
            </Button>
          ))}
      </div>
    </Dialog>
  );
}

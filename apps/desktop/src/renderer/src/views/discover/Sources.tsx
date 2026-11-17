import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import type { WatchSource } from './DiscoverView';
import { sourceName } from './sourceName';

type Kind = WatchSource['kind'];
const KINDS: Kind[] = ['author', 'topic', 'venue', 'own-preprint'];

interface Draft {
  id?: string;
  kind: Kind;
  query: string;
  label: string;
  enabled: boolean;
}
const EMPTY: Draft = { kind: 'author', query: '', label: '', enabled: true };

function SourceForm({ initial, onDone, onSaved }: { initial: Draft; onDone(): void; onSaved(): void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const needsQuery = draft.kind !== 'own-preprint';

  const save = async () => {
    if (needsQuery && draft.query.trim() === '') {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rl.invoke('watch:saveSource', { ...(draft.id ? { id: draft.id } : {}), kind: draft.kind, query: needsQuery ? draft.query.trim() : '', label: draft.label.trim(), enabled: draft.enabled });
      onSaved();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="source-form card"
      aria-label={t(draft.id ? 'discover.sources.edit' : 'discover.sources.add')}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="watch-source-form"
    >
      <div className="field">
        <label htmlFor={`${base}-kind`}>{t('discover.sources.kind')}</label>
        <select id={`${base}-kind`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })} data-testid="watch-source-kind">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`discover.sources.kind_${k}`)}
            </option>
          ))}
        </select>
      </div>
      {needsQuery ? (
        <div className="field">
          <label htmlFor={`${base}-query`}>{t('discover.sources.query')}</label>
          <input id={`${base}-query`} value={draft.query} maxLength={2000} onChange={(e) => { setDraft({ ...draft, query: e.target.value }); setInvalid(false); }} aria-describedby={`${base}-qh`} aria-invalid={invalid || undefined} data-testid="watch-source-query" />
          <p className="hint" id={`${base}-qh`}>
            {t(`discover.sources.queryHint_${draft.kind}`)}
          </p>
          {invalid && (
            <p className="field-error" role="alert" data-testid="watch-source-invalid">
              {t('discover.sources.queryRequired')}
            </p>
          )}
        </div>
      ) : (
        <p className="hint">{t('discover.sources.queryHint_own-preprint')}</p>
      )}
      <div className="field">
        <label htmlFor={`${base}-label`}>{t('discover.sources.label')}</label>
        <input id={`${base}-label`} value={draft.label} maxLength={200} onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-describedby={`${base}-lh`} data-testid="watch-source-label" />
        <p className="hint" id={`${base}-lh`}>
          {t('discover.sources.labelHint')}
        </p>
      </div>
      <div className="check">
        <input id={`${base}-en`} type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} data-testid="watch-source-form-enabled" />
        <label htmlFor={`${base}-en`}>{t('discover.sources.enabled')}</label>
      </div>
      {error !== null && <ErrorNote testId="watch-source-error">{errorMessage(error, t)}</ErrorNote>}
      <div className="actions start">
        <button type="submit" className="primary" disabled={busy} data-testid="watch-source-save">
          {t('discover.sources.save')}
        </button>
        <button type="button" onClick={onDone} data-testid="watch-source-cancel">
          {t('discover.sources.cancel')}
        </button>
      </div>
    </form>
  );
}

/** "Sources": what the user follows (author, topic, venue, own preprints), with add, edit, enable and remove. */
export function Sources({ sources, onChanged }: { sources: WatchSource[] | null; onChanged(): void }) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  // `null`: no form; `EMPTY` or a source: the form for a new or an existing source.
  const [form, setForm] = useState<{ key: string; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const toggle = async (s: WatchSource) => {
    try {
      await rl.invoke('watch:saveSource', { id: s.id, kind: s.kind, query: s.query, label: s.label, enabled: !s.enabled });
      onChanged();
    } catch (e) {
      reportError(e);
    }
  };
  const remove = async (s: WatchSource) => {
    setRemoving(null);
    try {
      await rl.invoke('watch:removeSource', { id: s.id });
      onChanged();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div data-testid="discover-sources">
      <p className="hint">{t('discover.sources.intro')}</p>
      <div className="actions start">
        <button type="button" onClick={() => setForm({ key: 'new', draft: EMPTY })} disabled={form?.key === 'new'} data-testid="watch-source-add">
          {t('discover.sources.add')}
        </button>
      </div>
      {form?.key === 'new' && <SourceForm initial={form.draft} onDone={() => setForm(null)} onSaved={onChanged} />}
      {sources === null && <p className="hint">{t('discover.sources.loading')}</p>}
      {sources && sources.length === 0 && (
        <p className="empty" data-testid="watch-source-empty">
          {t('discover.sources.empty')}
        </p>
      )}
      <ul className="work-list">
        {(sources ?? []).map((s) => {
          const name = safeText(sourceName(s, t(`discover.sources.kind_${s.kind}`)));
          return (
            <li key={s.id} className="work-row" data-testid="watch-source-item" data-source-id={s.id} data-enabled={s.enabled ? 'true' : 'false'}>
              {form?.key === s.id ? (
                <SourceForm initial={form.draft} onDone={() => setForm(null)} onSaved={onChanged} />
              ) : (
                <>
                  <span className="work-title" data-testid="watch-source-name">
                    {name}
                    {!s.enabled && <span className="badge">{t('discover.sources.disabled')}</span>}
                  </span>
                  <span className="work-meta">
                    {t(`discover.sources.kind_${s.kind}`)}
                    {s.kind !== 'own-preprint' && s.label.trim() !== '' && ` · ${safeText(s.query)}`}
                    {' · '}
                    {s.lastCheckedAt ? t('discover.sources.lastChecked', { date: s.lastCheckedAt.slice(0, 10) }) : t('discover.sources.neverChecked')}
                    {' · '}
                    <span data-testid="watch-source-new">{t('discover.sources.newCount', { count: s.newCount })}</span>
                  </span>
                  <div className="work-actions">
                    <div className="check">
                      <input id={`en-${s.id}`} type="checkbox" checked={s.enabled} onChange={() => void toggle(s)} aria-label={`${t('discover.sources.enabled')}: ${name}`} data-testid="watch-source-enabled" />
                      <label htmlFor={`en-${s.id}`}>{t('discover.sources.enabled')}</label>
                    </div>
                    <button type="button" className="link" onClick={() => setForm({ key: s.id, draft: { id: s.id, kind: s.kind, query: s.query, label: s.label, enabled: s.enabled } })} aria-label={`${t('discover.sources.edit')}: ${name}`} data-testid="watch-source-edit">
                      {t('discover.sources.edit')}
                    </button>
                    {removing === s.id ? (
                      <span className="confirm-inline">
                        <button type="button" className="danger" onClick={() => void remove(s)} aria-label={t('discover.sources.removeConfirm', { name })} data-testid="watch-source-remove-confirm">
                          {t('discover.sources.removeYes')}
                        </button>
                        <button type="button" onClick={() => setRemoving(null)}>
                          {t('discover.sources.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="link" onClick={() => setRemoving(s.id)} aria-label={`${t('discover.sources.remove')}: ${name}`} data-testid="watch-source-remove">
                        {t('discover.sources.remove')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

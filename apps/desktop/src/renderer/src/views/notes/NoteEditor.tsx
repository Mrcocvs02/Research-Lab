import { useCallback, useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STUDY_LIMITS } from '@rl/core';
import { Lazy, lazyRetry } from '../../components/Lazy';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';

// The Markdown renderer is loaded when the preview is first shown.
const Markdown = lazyRetry(() => import('../../lib/markdown').then((m) => ({ default: m.Markdown })));

interface Props {
  docId: string;
  /** No page: the note of the whole file. */
  page?: number;
  /** Prefix of the test ids (`<base>-input`, `<base>-save`, ...). */
  testId: string;
}

/**
 * The Markdown note of a file or of one page: a text box with a safe preview, saved on demand and when the box loses
 * the focus or the editor goes away. When the note changed elsewhere (CONFLICT) the text of the user is kept and the
 * user chooses between the other version and their own. A blank text removes the note.
 */
export function NoteEditor({ docId, page, testId }: Props) {
  const { t } = useTranslation();
  const version = useChangeVersion('notes');
  const { invalidate } = useLibraryEvents();
  const { reportError } = useNotify();
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [saved, setSavedState] = useState('');
  const [conflict, setConflict] = useState(false);
  const [layout, setLayout] = useState<'edit' | 'preview'>('edit');
  const preview = useDeferredValue(text);

  // What the latest save and the latest unmount read: the state of the render that scheduled them may be old.
  const textRef = useRef('');
  const savedRef = useRef('');
  const baseRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const savingRef = useRef(false);
  const pageArg = page === undefined ? {} : { page };

  const setBaseline = useCallback((body: string, base: string | null) => {
    savedRef.current = body;
    baseRef.current = base;
    setSavedState(body);
  }, []);
  const setConflictBoth = useCallback((v: boolean) => {
    conflictRef.current = v;
    setConflict(v);
  }, []);
  const changeText = (v: string) => {
    textRef.current = v;
    setText(v);
  };

  // Read the note on opening and whenever notes change: untouched text follows the stored note, typed text stays.
  useEffect(() => {
    let alive = true;
    rl.invoke('notes:get', { docId, ...pageArg }).then(
      ({ note }) => {
        if (!alive) return;
        const body = note?.body ?? '';
        const clean = textRef.current === savedRef.current;
        if (clean) {
          setBaseline(body, note?.updatedAt ?? null);
          changeText(body);
        } else if (!savingRef.current && (note?.updatedAt ?? null) !== baseRef.current) {
          setConflictBoth(true);
        }
        setLoaded(true);
      },
      (e: unknown) => {
        if (!alive) return;
        setLoaded(true);
        reportError(e);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, page, version]);

  const write = useCallback(
    async (body: string, expected: string | null) => rl.invoke('notes:save', { docId, ...pageArg, body, expectedUpdatedAt: expected }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, page],
  );

  const save = useCallback(async () => {
    if (savingRef.current || conflictRef.current || textRef.current === savedRef.current) return;
    const body = textRef.current;
    savingRef.current = true;
    try {
      const r = await write(body, baseRef.current);
      setBaseline(body, r.note?.updatedAt ?? null);
      invalidate('notes');
    } catch (e) {
      if (RlError.from(e).code === 'CONFLICT') setConflictBoth(true);
      else reportError(e);
    } finally {
      savingRef.current = false;
    }
  }, [write, invalidate, reportError, setBaseline, setConflictBoth]);

  // Leaving (another page, the reader closing): unsaved typing is saved, not lost.
  const latest = useRef({ write, invalidate, reportError });
  latest.current = { write, invalidate, reportError };
  useEffect(
    () => () => {
      if (textRef.current === savedRef.current || conflictRef.current || savingRef.current) return;
      const { write: w, invalidate: inv, reportError: report } = latest.current;
      void w(textRef.current, baseRef.current).then(
        () => inv('notes'),
        (e: unknown) => report(e),
      );
    },
    [],
  );

  const reloadTheirs = async () => {
    try {
      const { note } = await rl.invoke('notes:get', { docId, ...pageArg });
      setBaseline(note?.body ?? '', note?.updatedAt ?? null);
      changeText(note?.body ?? '');
      setConflictBoth(false);
    } catch (e) {
      reportError(e);
    }
  };
  const keepMine = async () => {
    try {
      const { note } = await rl.invoke('notes:get', { docId, ...pageArg });
      baseRef.current = note?.updatedAt ?? null;
      setConflictBoth(false);
      await save();
    } catch (e) {
      reportError(e);
    }
  };

  const dirty = text !== saved;
  if (!loaded) return <p className="hint">{t('common.loading')}</p>;
  return (
    <div className="note-editor" data-testid={testId} aria-label={page === undefined ? t('notes.fileTitle') : t('notes.pageTitle', { page })}>
      <div className="notes-bar">
        <div className="radio-row" role="radiogroup" aria-label={t('notes.layout')}>
          {(['edit', 'preview'] as const).map((l) => (
            <label key={l} className="radio-chip">
              <input type="radio" name={`${id}-layout`} checked={layout === l} onChange={() => setLayout(l)} data-testid={`${testId}-layout-${l}`} />
              <span>{t(`notes.layout_${l}`)}</span>
            </label>
          ))}
        </div>
        <span className="spacer" />
        <span className="hint" role="status" data-testid={`${testId}-state`}>
          {dirty ? t('notes.unsaved') : t('notes.saved')}
        </span>
        <button type="button" className="primary" onClick={() => void save()} disabled={!dirty || conflict} data-testid={`${testId}-save`}>
          {t('common.save')}
        </button>
      </div>
      {conflict && (
        <div className="callout notes-conflict" role="alert" data-testid={`${testId}-conflict`}>
          <p>{t('notes.conflict')}</p>
          <div className="notes-conflict-actions">
            <button type="button" onClick={() => void reloadTheirs()} data-testid={`${testId}-reload-theirs`}>
              {t('notes.reloadTheirs')}
            </button>
            <button type="button" className="primary" onClick={() => void keepMine()} data-testid={`${testId}-keep-mine`}>
              {t('notes.keepMine')}
            </button>
          </div>
        </div>
      )}
      {layout === 'edit' ? (
        <div className="field notes-edit">
          <label htmlFor={id}>{page === undefined ? t('notes.fileLabel') : t('notes.pageLabel', { page })}</label>
          <textarea id={id} value={text} maxLength={STUDY_LIMITS.noteBody} onChange={(e) => changeText(e.target.value)} onBlur={() => void save()} spellCheck data-testid={`${testId}-input`} />
          <p className="hint">{t('notes.markdownHint')}</p>
        </div>
      ) : (
        <div className="notes-preview" aria-label={t('notes.preview')} data-testid={`${testId}-preview`}>
          {preview.trim() === '' ? (
            <p className="hint">{t('notes.empty')}</p>
          ) : (
            <Lazy>
              <Markdown source={preview} />
            </Lazy>
          )}
        </div>
      )}
    </div>
  );
}

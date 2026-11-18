import { useCallback, useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STUDY_LIMITS } from '@rl/core';
import { Lazy, lazyRetry } from '../../components/Lazy';
import { draftKey, keepDraft, registerEditor, takeDraft } from '../../lib/dirtyEditors';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import './notes.css';

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
 *
 * Saves are chained: a save (blur, button, unmount, `flushAll`) waits for the one in flight and then saves the latest
 * text, so typing during a save is never dropped. The editor is registered in `lib/dirtyEditors`, so the app can wait
 * for it before a library switch, before the reader closes and before the window closes (D-197). A failed save keeps
 * the text and shows an error in the editor.
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
  const [saveError, setSaveError] = useState(false);
  const [restored, setRestored] = useState(false);
  const [layout, setLayout] = useState<'edit' | 'preview'>('edit');
  const preview = useDeferredValue(text);

  // What the latest save and the latest unmount read: the state of the render that scheduled them may be old.
  const textRef = useRef('');
  const savedRef = useRef('');
  const baseRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const pageArg = page === undefined ? {} : { page };
  // The library the editor was opened in: a draft left by a failed save belongs to it (D-201).
  const { activeLibraryId } = useApp();
  const keyRef = useRef(draftKey(activeLibraryId, docId, page));

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
        const draft = clean ? takeDraft(keyRef.current) : undefined;
        if (draft !== undefined && draft.text !== body) {
          // Text typed before a failed save: back in the box, unsaved, on the version it was typed on.
          setBaseline(body, note?.updatedAt ?? null);
          baseRef.current = draft.base;
          changeText(draft.text);
          setRestored(true);
        } else if (clean) {
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
  // What the chained saves and the unmount read: the closures of the render that scheduled them may be old.
  const latest = useRef({ write, invalidate, reportError });
  latest.current = { write, invalidate, reportError };

  /** One save of the text as it is now. true: nothing unsaved is left. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (textRef.current === savedRef.current) return true;
    if (conflictRef.current) return false;
    const body = textRef.current;
    savingRef.current = true;
    try {
      const r = await latest.current.write(body, baseRef.current);
      setBaseline(body, r.note?.updatedAt ?? null);
      setSaveError(false);
      setRestored(false);
      latest.current.invalidate('notes');
      return true;
    } catch (e) {
      if (RlError.from(e).code === 'CONFLICT') {
        setConflictBoth(true);
        // The editor is gone: the toast is the only place left to say that the text was not saved.
        if (!mountedRef.current) latest.current.reportError(e);
      } else {
        setSaveError(true);
        latest.current.reportError(e);
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [setBaseline, setConflictBoth]);

  /** Chains behind the save in flight, then saves the latest text. */
  const save = useCallback((): Promise<boolean> => {
    const next = chainRef.current.then(saveNow, saveNow);
    chainRef.current = next;
    return next;
  }, [saveNow]);
  const flush = useCallback(async () => {
    await save();
    return textRef.current === savedRef.current;
  }, [save]);

  // Registered while mounted. Leaving (another page, the reader closing) saves what is unsaved; the registration stays
  // until that save is over, so a `flushAll` started meanwhile still waits for it.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mountedRef.current = true;
    const unregister = registerEditor({
      flush: () => flushRef.current(),
      isDirty: () => textRef.current !== savedRef.current || savingRef.current,
    });
    return () => {
      mountedRef.current = false;
      if (textRef.current === savedRef.current && !savingRef.current) return unregister();
      if (conflictRef.current) latest.current.reportError(new RlError('CONFLICT', 'The note was changed somewhere else'));
      const base = baseRef.current;
      void flushRef.current()
        .then((ok) => {
          if (!ok) keepDraft(keyRef.current, { text: textRef.current, base });
        })
        .finally(unregister);
    };
  }, []);

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
      {saveError && (
        <p className="callout error" role="alert" data-testid={`${testId}-save-error`}>
          {t('notes.saveFailed')}
        </p>
      )}
      {restored && (
        <p className="callout" role="status" data-testid={`${testId}-restored`}>
          {t('notes.draftRestored')}
        </p>
      )}
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

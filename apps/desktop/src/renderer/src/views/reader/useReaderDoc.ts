import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channels, ResponseOf, StudyState } from '@rl/core';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { rl } from '../../lib/rl';

export type ReaderDoc = ResponseOf<Channels, 'documents:get'>;
export type Underlined = { value: boolean; origin: 'annotations' | 'manual' };

/**
 * The document record the reader shows (title, study state, the "underlined" flag): read when the reader opens and
 * when documents change, changed through `documents:update` (so it is undoable like every other edit of the card).
 * Each change patches one field, so it does not depend on a revision that annotation writes may have moved.
 */
export function useReaderDoc(docId: string, onError: (e: unknown) => void) {
  const version = useChangeVersion('documents');
  const { invalidate } = useLibraryEvents();
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const fail = useRef(onError);
  fail.current = onError;

  useEffect(() => {
    let alive = true;
    rl.invoke('documents:get', { docId }).then(
      (d) => alive && setDoc(d),
      (e: unknown) => alive && fail.current(e),
    );
    return () => {
      alive = false;
    };
  }, [docId, version]);

  const update = useCallback(
    (patch: { studyState: StudyState } | { underlined: boolean }) => {
      queue.current = queue.current.then(async () => {
        try {
          const r = await rl.invoke('documents:update', { docId, patch });
          setDoc(r.document);
          invalidate('documents');
        } catch (e) {
          fail.current(e);
        }
      });
    },
    [docId, invalidate],
  );

  /** The flag an annotation write reported: shown at once. */
  const applyUnderlined = useCallback((u: Underlined) => setDoc((d) => (d ? { ...d, study: { ...d.study, underlined: u } } : d)), []);

  return { doc, setStudyState: (s: StudyState) => update({ studyState: s }), setUnderlined: (v: boolean) => update({ underlined: v }), applyUnderlined };
}

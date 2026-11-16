import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationInput } from '@rl/core';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';

type Underlined = { value: boolean; origin: 'annotations' | 'manual' };

/**
 * The highlights and underlines of a document: loaded when the reader opens, again when they change elsewhere
 * (`library:changed` kind `annotations`), updated at once from the answers of our own writes. `onUnderlined` receives
 * the "underlined" flag every write reports, so the reader shows it without another read.
 */
export function useAnnotations(docId: string, onUnderlined: (u: Underlined) => void, onError: (e: unknown) => void) {
  const version = useChangeVersion('annotations');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const cb = useRef({ onUnderlined, onError });
  cb.current = { onUnderlined, onError };

  useEffect(() => {
    let alive = true;
    rl.invoke('annotations:list', { docId }).then(
      (r) => {
        if (!alive) return;
        setAnnotations(r.annotations);
        setStale(r.stale);
        setLoaded(true);
      },
      (e: unknown) => {
        if (!alive) return;
        setLoaded(true);
        cb.current.onError(e);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, version]);

  const save = useCallback(
    async (annotation: AnnotationInput): Promise<Annotation | null> => {
      try {
        const r = await rl.invoke('annotations:save', { docId, annotation });
        setAnnotations((cur) => (cur.some((a) => a.id === r.annotation.id) ? cur.map((a) => (a.id === r.annotation.id ? r.annotation : a)) : [...cur, r.annotation]));
        cb.current.onUnderlined(r.underlined);
        return r.annotation;
      } catch (e) {
        cb.current.onError(e);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const r = await rl.invoke('annotations:remove', { docId, id });
        setAnnotations((cur) => cur.filter((a) => a.id !== id));
        cb.current.onUnderlined(r.underlined);
        return r.removed;
      } catch (e) {
        cb.current.onError(e);
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  );

  return { annotations, stale, loaded, save, remove };
}

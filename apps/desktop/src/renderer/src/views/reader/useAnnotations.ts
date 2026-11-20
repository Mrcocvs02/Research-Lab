import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationInput } from '@rl/core';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';
import { AnnotationJournal, toInput } from './annotationJournal';

type Underlined = { value: boolean; origin: 'annotations' | 'manual' };

/**
 * The highlights and underlines of a document: loaded when the reader opens, again when they change elsewhere
 * (`library:changed` kind `annotations`), updated at once from the answers of our own writes. `onUnderlined` receives
 * the "underlined" flag every write reports, so the reader shows it without another read.
 */
export function useAnnotations(docId: string, onUnderlined: (u: Underlined) => void, onError: (e: unknown) => void) {
  const version = useChangeVersion('annotations');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /** Annotations made on another version of the file (their own hash differs); saving one again re-confirms it. */
  const [staleIds, setStaleIds] = useState<ReadonlySet<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const cb = useRef({ onUnderlined, onError });
  const current = useRef<readonly Annotation[]>([]);
  current.current = annotations;
  // Ctrl+Z in the reader: the changes of this document's annotations, in the order the user made them (crops have their own Undo).
  const journal = useRef(new AnnotationJournal());
  const [, bump] = useState(0);
  useEffect(() => {
    journal.current.clear();
    bump((n) => n + 1);
  }, [docId]);
  cb.current = { onUnderlined, onError };

  useEffect(() => {
    let alive = true;
    rl.invoke('annotations:list', { docId }).then(
      (r) => {
        if (!alive) return;
        setAnnotations(r.annotations);
        setStaleIds(new Set(r.staleIds ?? []));
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
    async (annotation: AnnotationInput, opts?: { quiet?: boolean }): Promise<Annotation | null> => {
      const before = annotation.id ? (current.current.find((a) => a.id === annotation.id) ?? null) : null;
      try {
        const r = await rl.invoke('annotations:save', { docId, annotation });
        // Saved on the file as it is now: no longer in doubt.
        setStaleIds((cur) => {
          if (!cur.has(r.annotation.id)) return cur;
          const next = new Set(cur);
          next.delete(r.annotation.id);
          return next;
        });
        setAnnotations((cur) => (cur.some((a) => a.id === r.annotation.id) ? cur.map((a) => (a.id === r.annotation.id ? r.annotation : a)) : [...cur, r.annotation]));
        cb.current.onUnderlined(r.underlined);
        if (!opts?.quiet && r.annotation.kind !== 'area') {
          journal.current.record({ before, after: r.annotation });
          bump((n) => n + 1);
        }
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
    async (id: string, opts?: { quiet?: boolean }): Promise<boolean> => {
      const before = current.current.find((a) => a.id === id) ?? null;
      try {
        const r = await rl.invoke('annotations:remove', { docId, id });
        setAnnotations((cur) => cur.filter((a) => a.id !== id));
        setStaleIds((cur) => {
          if (!cur.has(id)) return cur;
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
        cb.current.onUnderlined(r.underlined);
        if (!opts?.quiet && r.removed && before && before.kind !== 'area') {
          journal.current.record({ before, after: null });
          bump((n) => n + 1);
        }
        return r.removed;
      } catch (e) {
        cb.current.onError(e);
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  );

  const step = useCallback(
    async (dir: 'undo' | 'redo'): Promise<boolean> => {
      const done = await journal.current.step(dir, async (target, cur) => {
        if (!target) return { ok: cur ? await remove(cur.id, { quiet: true }) : true, saved: null };
        // Still there: write it over; gone (deleted elsewhere): a new one.
        const exists = cur && current.current.some((a) => a.id === cur.id);
        const saved = await save(toInput(target, !!exists), { quiet: true });
        return { ok: saved !== null, saved };
      });
      bump((n) => n + 1);
      return done;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [save, remove],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  return { annotations, canUndo: journal.current.canUndo, canRedo: journal.current.canRedo, undo, redo, stale: staleIds.size > 0, staleIds, loaded, save, remove };
}

import { describe, expect, it } from 'vitest';
import type { Annotation } from '@rl/core';
import { AnnotationJournal, toInput } from './annotationJournal';

const ann = (id: string, over: Partial<Annotation> = {}): Annotation =>
  ({ id, kind: 'highlight', page: 1, rects: [{ x: 0, y: 0, w: 1, h: 1 }], text: 't', color: 'yellow', createdAt: '', updatedAt: '', ...over }) as Annotation;

/** A fake store that behaves like annotations:save / remove (a save without id makes a new id). */
function store(initial: Annotation[]) {
  const items = new Map(initial.map((a) => [a.id, a]));
  let n = 100;
  return {
    items,
    apply: async (target: Annotation | null, current: Annotation | null) => {
      if (!target) {
        if (current) items.delete(current.id);
        return { ok: true, saved: null };
      }
      const exists = current && items.has(current.id);
      const saved = { ...target, id: exists ? current.id : `n${n++}` };
      items.set(saved.id, saved);
      return { ok: true, saved };
    },
  };
}

describe('AnnotationJournal', () => {
  it('undoes and redoes a creation', async () => {
    const j = new AnnotationJournal();
    const a = ann('a');
    const s = store([a]);
    j.record({ before: null, after: a });
    expect(j.canUndo).toBe(true);
    await j.step('undo', s.apply);
    expect(s.items.size).toBe(0);
    expect(j.canRedo).toBe(true);
    await j.step('redo', s.apply);
    expect(s.items.size).toBe(1);
  });

  it('brings a deleted annotation back and keeps following it by its new id', async () => {
    const j = new AnnotationJournal();
    const a = ann('a');
    const edited = ann('a', { color: 'green' });
    const s = store([edited]);
    j.record({ before: a, after: edited });
    j.record({ before: edited, after: null });
    s.items.delete('a');
    await j.step('undo', s.apply);
    const [back] = [...s.items.values()];
    expect(back!.id).not.toBe('a');
    expect(back!.color).toBe('green');
    await j.step('undo', s.apply);
    expect(s.items.get(back!.id)!.color).toBe('yellow');
    await j.step('redo', s.apply);
    expect(s.items.get(back!.id)!.color).toBe('green');
  });

  it('a new change clears redo, ignores no-ops and keeps the entry when the write fails', async () => {
    const j = new AnnotationJournal();
    const a = ann('a');
    j.record({ before: a, after: a });
    expect(j.canUndo).toBe(false);
    j.record({ before: null, after: a });
    expect(await j.step('undo', async () => ({ ok: false, saved: null }))).toBe(false);
    expect(j.canUndo).toBe(true);
    await j.step('undo', async () => ({ ok: true, saved: null }));
    j.record({ before: null, after: ann('b') });
    expect(j.canRedo).toBe(false);
    expect(await new AnnotationJournal().step('undo', store([]).apply)).toBe(false);
  });

  it('toInput carries the id only when asked', () => {
    expect(toInput(ann('a', { comment: 'c' }), true)).toMatchObject({ id: 'a', comment: 'c' });
    expect(toInput(ann('a'), false)).not.toHaveProperty('id');
  });
});

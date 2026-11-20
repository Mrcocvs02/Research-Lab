import type { Annotation, AnnotationInput } from '@rl/core';

/** One change of one annotation: `before` null = created, `after` null = deleted, both set = edited (colour, kind, comment…). */
export interface JournalEntry {
  before: Annotation | null;
  after: Annotation | null;
}

const LIMIT = 100;

/** The input that writes `a` again (with its id when it must replace the current one). */
export function toInput(a: Annotation, withId: boolean): AnnotationInput {
  return {
    ...(withId ? { id: a.id } : {}),
    kind: a.kind,
    page: a.page,
    rects: a.rects,
    text: a.text,
    color: a.color,
    ...(a.geom === 2 ? { geom: 2 as const } : {}),
    ...(a.comment !== undefined ? { comment: a.comment } : {}),
    ...(a.crop ? { crop: a.crop } : {}),
  } as AnnotationInput;
}

/**
 * The undo and redo stacks of the annotations of one open document (highlights, underlines and the other marks of the
 * reader). Pure: the caller does the writes (through the usual save and remove, so the PDF write-back works as always).
 * An annotation brought back by undo gets a new id; the entries that mention the old one follow it.
 */
export class AnnotationJournal {
  private undoStack: JournalEntry[] = [];
  private redoStack: JournalEntry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** A new user change; the redo stack no longer applies. Changes that did nothing are ignored. */
  record(entry: JournalEntry): void {
    if (!entry.before && !entry.after) return;
    if (entry.before && entry.after && JSON.stringify(entry.before) === JSON.stringify(entry.after)) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Undoes (or redoes) the newest entry. `apply(target, current)` writes the state `target` (null = delete `current`)
   * and returns the annotation as saved (null when the write failed or the target was null). On failure the entry stays.
   */
  async step(dir: 'undo' | 'redo', apply: (target: Annotation | null, current: Annotation | null) => Promise<{ ok: boolean; saved: Annotation | null }>): Promise<boolean> {
    const from = dir === 'undo' ? this.undoStack : this.redoStack;
    const to = dir === 'undo' ? this.redoStack : this.undoStack;
    const entry = from[from.length - 1];
    if (!entry) return false;
    const target = dir === 'undo' ? entry.before : entry.after;
    const current = dir === 'undo' ? entry.after : entry.before;
    const r = await apply(target, current);
    if (!r.ok) return false;
    from.pop();
    // A brought-back annotation has a new id: every entry that mentions the old one follows it.
    if (target && r.saved && r.saved.id !== target.id) {
      const old = target.id;
      const next = r.saved.id;
      for (const e of [...this.undoStack, ...this.redoStack, entry]) {
        if (e.before?.id === old) e.before = { ...e.before, id: next };
        if (e.after?.id === old) e.after = { ...e.after, id: next };
      }
    }
    to.push(entry);
    return true;
  }
}

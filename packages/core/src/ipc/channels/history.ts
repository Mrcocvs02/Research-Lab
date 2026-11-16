import { z } from 'zod';
import { isoDateSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

export const historyItemSchema = z.object({
  changeId: z.string(),
  at: isoDateSchema,
  deviceId: z.string(),
  actor: z.enum(['user', 'ai', 'import', 'system']),
  /** `change` = an operation; `undo` / `redo` = the reversal of another one. */
  kind: z.enum(['change', 'undo', 'redo']),
  /** Machine-readable action (`tags.update`, `taxonomy.update`, `document.fields`, `project.update`...). */
  action: z.string(),
  /** One readable line (English); the interface may translate from `action` + `counts`. */
  summary: z.string(),
  counts: z.object({ documents: z.number().int().nonnegative(), taxonomy: z.number().int().nonnegative(), projects: z.number().int().nonnegative() }),
  /** True when `history:undo` can be tried on it (not undone already, and every entry carries its before/after). */
  undoable: z.boolean(),
  /** True when a later undo reverted it (`history:redo` can re-apply it). */
  undone: z.boolean(),
  /** Written by this device. */
  mine: z.boolean(),
});

export const historyResultSchema = z.object({
  /** The change that was undone or redone. */
  target: z.string(),
  /** The change written by this undo/redo (itself undoable: undo of an undo is a redo). */
  changeId: z.string(),
  summary: z.string(),
  documentsChanged: z.number().int().nonnegative(),
});

const target = z.object({ changeId: z.string().min(1).max(64).optional() });

export const historyChannels = defineChannels('history', {
  /** Recent changes, newest first. */
  list: { request: z.object({ limit: z.number().int().min(1).max(500).optional() }), response: z.object({
      items: z.array(historyItemSchema),
      /** Whether `history:undo` without an id would find a change to undo (computed here, same rule). */
      canUndo: z.boolean().optional(),
      /** Whether `history:redo` without an id would find one to redo. */
      canRedo: z.boolean().optional(),
    }),
  },
  /**
   * Applies the recorded inverse of a change (default: the latest undoable change of this device).
   * CONFLICT (`details.conflict` = `changed`) when one of the items has changed again since; nothing is applied then.
   * NOT_FOUND when there is nothing to undo.
   */
  undo: { request: target, response: historyResultSchema },
  /** Re-applies a change that was undone (default: the latest undone one of this device, as long as nothing newer was done). */
  redo: { request: target, response: historyResultSchema },
});

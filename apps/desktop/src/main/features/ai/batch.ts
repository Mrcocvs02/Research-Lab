import { createHash } from 'node:crypto';

/**
 * The fixed interface of the Claude functions of the next waves (D-404, D-416): requests in blocks of up to 10 items, a cache
 * key from content + model + prompt version, and one decision about the dialog and the cap of the day. Pure; loaded on demand
 * by the function that uses it (never part of the start of the app).
 */
export const BATCH_SIZE = 10;

/** Splits `items` into blocks of at most `size` (one request each). */
export function chunk<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Cache key: `hash(content) + model + prompt version` (any parts, in order). The same request always gives the same key. */
export const cacheHash = (parts: readonly unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export interface CostInput {
  approxTokens: number;
  /** The answer is in the cache: nothing is sent. */
  cached: boolean;
  /** The folder never received document text before. */
  firstFolderSend: boolean;
  /** Dialog threshold in tokens (default 5 000). */
  thresholdTokens: number;
  todayTokens: number;
  dailyCap: number | null;
  /** Output tokens assumed on top of the input. */
  outTokens?: number;
}
export interface CostDecision {
  /** Over the threshold, or the first send for the folder (a cached request never asks). */
  needsDialog: boolean;
  /** The send, with the tokens of today, would pass the cap of the day: it is refused. */
  overDailyCap: boolean;
  /** Whole percent of the day's cap used with this send; null without a cap. */
  todayPct: number | null;
}

/** The one rule of cost (D-416). */
export function costDecision(i: CostInput): CostDecision {
  const total = i.todayTokens + (i.cached ? 0 : i.approxTokens + (i.outTokens ?? 0));
  return {
    needsDialog: !i.cached && (i.approxTokens > i.thresholdTokens || i.firstFolderSend),
    overDailyCap: i.dailyCap !== null && !i.cached && total > i.dailyCap,
    todayPct: i.dailyCap === null ? null : Math.round((total / i.dailyCap) * 100),
  };
}

export interface BatchPlan<T> {
  /** Blocks still to send, each up to `size`. */
  blocks: T[][];
  /** Items already in the cache: not sent again. */
  cached: number;
  toSend: number;
}

/** Cached items drop out; what is left goes in blocks. */
export function planBatch<T>(items: readonly T[], isCached: (item: T) => boolean, size = BATCH_SIZE): BatchPlan<T> {
  const todo = items.filter((x) => !isCached(x));
  return { blocks: chunk(todo, size), cached: items.length - todo.length, toSend: todo.length };
}

import type { AiSendEntry, LogEntry } from '@rl/core';

/** Log purpose of a read made by an agent tool (`chat:tool:<name>`): sizes of what the model saw, no cost of its own. */
export const isToolPurpose = (purpose: string): boolean => purpose.includes(':tool:');

/** `YYYY-MM` (UTC, like the log files) of a date. */
export const monthOf = (d: Date | string): string => (typeof d === 'string' ? d : d.toISOString()).slice(0, 7);

export const aiSends = (entries: readonly LogEntry[]): AiSendEntry[] => entries.filter((e): e is AiSendEntry => e.type === 'ai-send');

export interface UsageSummary {
  month: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  sends: number;
  byModel: Array<{ model: string; usd: number; sends: number }>;
}

/**
 * Spending of a month from the AI-send log. Tool reads (`:tool:` purposes) are left out: they are part of the turn that
 * made them, which carries the tokens and the cost of the whole turn (counting both would count twice).
 */
export function summariseUsage(entries: readonly LogEntry[], month: string): UsageSummary {
  const by = new Map<string, { usd: number; sends: number }>();
  let usd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sends = 0;
  for (const e of aiSends(entries)) {
    if (!e.at.startsWith(month) || isToolPurpose(e.purpose)) continue;
    sends++;
    usd += e.estimatedCostUsd ?? 0;
    inputTokens += e.approxInputTokens;
    outputTokens += e.approxOutputTokens ?? 0;
    const m = by.get(e.model) ?? { usd: 0, sends: 0 };
    m.usd += e.estimatedCostUsd ?? 0;
    m.sends++;
    by.set(e.model, m);
  }
  return { month, usd, inputTokens, outputTokens, sends, byModel: [...by].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model)) };
}

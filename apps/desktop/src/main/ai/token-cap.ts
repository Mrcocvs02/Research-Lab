import { AppError, type AiTokenUsage } from '@rl/core';
import { stat } from 'node:fs/promises';
import { createLibraryStore } from '@rl/data';
import type { MainServices } from '../ipc/handlers/services.js';
import { isToolPurpose, monthOf, summariseUsage } from './usage.js';

/**
 * The monthly token cap of the app (D-442): tokens in + out of EVERY library this calendar month. The total is read from
 * the logs once per month and per run, then kept up to date by `noteSend` on each send (no log is re-read per request).
 */
interface Counter {
  month: string;
  total: number;
}
const counters = new WeakMap<MainServices, Counter>();
const loading = new WeakMap<MainServices, Promise<Counter>>();

async function loadAll(s: MainServices, month: string): Promise<number> {
  const { profiles } = await s.libraries.list();
  const { deviceId } = await s.settings.get();
  let total = 0;
  for (const p of profiles) {
    try {
      await stat(p.rootPath);
      const store = createLibraryStore({ rootPath: p.rootPath, dataDir: await s.libraries.dataDir(p.id), deviceId, logger: s.log });
      const u = summariseUsage(await store.readLog({ type: 'ai-send', since: `${month}-01T00:00:00.000Z` }), month);
      total += u.inputTokens + u.outputTokens;
    } catch {
      // An unreachable library cannot be counted; it is skipped, never an error.
    }
  }
  return total;
}

async function counter(s: MainServices): Promise<Counter> {
  const month = monthOf(new Date());
  const have = counters.get(s);
  if (have?.month === month) return have;
  let p = loading.get(s);
  if (!p) {
    p = loadAll(s, month)
      .then((total) => {
        const c = { month, total };
        counters.set(s, c);
        return c;
      })
      .finally(() => loading.delete(s));
    loading.set(s, p);
  }
  return p;
}

const pctOf = (tokens: number, cap: number | null): number | null => (cap === null ? null : Math.round((tokens / cap) * 100));

export async function tokenUsage(s: MainServices): Promise<AiTokenUsage> {
  const [c, cfg] = await Promise.all([counter(s), s.settings.get()]);
  const cap = cfg.ai.tokenCap.monthlyTokens;
  return { month: c.month, monthTokens: c.total, tokenCap: cap, pct: pctOf(c.total, cap), warnAtPct: cfg.ai.tokenCap.warnAtPct };
}

/** Refuses a send before it starts when the month's tokens, plus the estimate of this send, would pass the cap. */
export async function assertTokenCap(s: MainServices, estimatedTokens = 0): Promise<void> {
  const cap = (await s.settings.get()).ai.tokenCap.monthlyTokens;
  if (cap === null) return;
  const { total } = await counter(s);
  if (total >= cap || total + estimatedTokens > cap) throw new AppError('AI_TOKEN_CAP_REACHED', 'The monthly token cap is reached', { monthTokens: total, tokenCap: cap, estimatedTokens });
}

/** A send was logged: adds its tokens (tool reads are part of their turn and are not counted twice) and tells the UI. */
export async function noteSend(s: MainServices, purpose: string, inputTokens: number, outputTokens = 0): Promise<void> {
  if (isToolPurpose(purpose)) return;
  const c = await counter(s).catch(() => null);
  if (!c) return;
  const before = c.total;
  c.total += inputTokens + outputTokens;
  const u = await tokenUsage(s);
  const warnAt = u.tokenCap === null ? null : (u.tokenCap * u.warnAtPct) / 100;
  s.emit('ai:usageChanged', { ...u, crossedWarn: warnAt !== null && before < warnAt && c.total >= warnAt });
}

export async function setTokenCap(s: MainServices, monthlyTokens: number | null): Promise<AiTokenUsage> {
  await s.settings.update((cur) => {
    cur.ai.tokenCap.monthlyTokens = monthlyTokens;
  });
  const u = await tokenUsage(s);
  s.emit('ai:usageChanged', { ...u, crossedWarn: false });
  return u;
}

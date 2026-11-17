import { AppError, type UserProfile } from '@rl/core';
import { buildOwnedIndex, createCitationService, createCitationSources, createNet, createWatchFetcher, type CitationServiceX, type CitationSourceX, type OwnedIndex, type WatchQuery, type WatchResult } from '@rl/citations';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { MainServices } from '../ipc/handlers/services.js';

/** Sources, throttle state and the email choice of one app session (one per `MainServices`, so rate limits are shared by every caller). */
interface Net {
  sources: CitationSourceX[];
  service: CitationServiceX;
  watch: (q: WatchQuery, signal?: AbortSignal) => Promise<WatchResult>;
  email: { value: string | null };
}
const nets = new WeakMap<MainServices, Net>();

/** Tests replace the waiting of the throttle and of the retries (it is real time otherwise). */
export const netTuning: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; timeoutMs?: number } = {};

/**
 * The online sources, ready to use: refuses with NETWORK_ERROR (offline) when the machine has no connection, and reads
 * the email setting now (the profile's email goes out only while `network.openAlexEmail` is on). Returns the profile too.
 */
export async function online(s: MainServices): Promise<Net & { profile: UserProfile }> {
  if (s.isOnline && !s.isOnline()) throw new AppError('NETWORK_ERROR', 'There is no network connection', { reason: 'offline' });
  let n = nets.get(s);
  if (!n) {
    const email = { value: null as string | null };
    const net = createNet({ fetch: s.fetch ?? fetch, email: () => email.value, ...(netTuning.sleep ? { sleep: netTuning.sleep } : {}), ...(netTuning.timeoutMs ? { timeoutMs: netTuning.timeoutMs } : {}) });
    const sources = createCitationSources({ fetch: s.fetch ?? fetch, net });
    n = { sources, service: createCitationService(sources), watch: createWatchFetcher(net), email };
    nets.set(s, n);
  }
  const st = await s.settings.get();
  n.email.value = st.network.openAlexEmail && st.user.email ? st.user.email : null;
  return { ...n, profile: st.user };
}

/** Without an organizer to say when documents change (a runtime that cannot record changes), the index is reused this long. */
const INDEX_TTL_MS = 120_000;
const indexes = new WeakMap<LibraryRuntime, { key: string; at: number; index: OwnedIndex }>();

/** A key that moves whenever a document of the library may have changed (every document write goes through the organizer). */
export function documentsKey(rt: LibraryRuntime): string {
  try {
    return String(rt.organizer.generation);
  } catch {
    return `t${Math.floor(Date.now() / INDEX_TTL_MS)}`;
  }
}

/** What matching needs of the library's documents; rebuilt when the documents changed since (or when `fresh`). */
export async function ownedIndex(rt: LibraryRuntime, fresh = false): Promise<OwnedIndex> {
  const key = documentsKey(rt);
  const hit = indexes.get(rt);
  if (!fresh && hit && hit.key === key && Date.now() - hit.at < 30 * 60_000) return hit.index;
  const index = buildOwnedIndex(await rt.store.documents.list());
  indexes.set(rt, { key, at: Date.now(), index });
  return index;
}

/** Bumped when a citation file is written: the "read next" aggregate is rebuilt on its next use. */
const citationVersions = new WeakMap<LibraryRuntime, number>();
export const citationsVersion = (rt: LibraryRuntime): number => citationVersions.get(rt) ?? 0;
export const bumpCitations = (rt: LibraryRuntime): void => void citationVersions.set(rt, citationsVersion(rt) + 1);

/** Serialised read-modify-write of `watch.json` (sources, seen items and dismissed recommendations share the file). */
let watchChain: Promise<unknown> = Promise.resolve();
export function updateWatch<T>(rt: LibraryRuntime, fn: (w: Awaited<ReturnType<LibraryRuntime['store']['readWatch']>>) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const w = await rt.store.readWatch();
    const out = await fn(w);
    await rt.store.writeWatch(w);
    return out;
  };
  const next = watchChain.then(run, run);
  watchChain = next.catch(() => undefined);
  return next;
}

/** The promise a handler of the registry resolves to. */
export type Res<F extends (...a: never[]) => unknown> = Promise<Awaited<ReturnType<F>>>;

/** Sets a damaged `watch.json` aside (`watch.json.corrupt`) and starts with no sources. */
export function resetWatch(rt: LibraryRuntime): Promise<boolean> {
  const run = () => rt.store.resetWatch();
  const next = watchChain.then(run, run);
  watchChain = next.catch(() => undefined);
  return next;
}

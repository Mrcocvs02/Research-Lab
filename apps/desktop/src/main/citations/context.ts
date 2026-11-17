import { AppError, type UserProfile } from '@rl/core';
import { buildOwnedIndex, createCitationService, createCitationSources, createNet, createWatchFetcher, type CitationServiceX, type CitationSourceX, type OwnedIndex, type WatchHit, type WatchQuery } from '@rl/citations';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { MainServices } from '../ipc/handlers/services.js';

/** Sources, throttle state and the email choice of one app session (one per `MainServices`, so rate limits are shared by every caller). */
interface Net {
  sources: CitationSourceX[];
  service: CitationServiceX;
  watch: (q: WatchQuery, signal?: AbortSignal) => Promise<WatchHit[]>;
  email: { value: string | null };
}
const nets = new WeakMap<MainServices, Net>();

/** Tests replace the waiting of the throttle and of the retries (it is real time otherwise). */
export const netTuning: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {};

/**
 * The online sources, ready to use: refuses with NETWORK_ERROR (offline) when the machine has no connection, and reads
 * the email setting now (the profile's email goes out only while `network.openAlexEmail` is on). Returns the profile too.
 */
export async function online(s: MainServices): Promise<Net & { profile: UserProfile }> {
  if (s.isOnline && !s.isOnline()) throw new AppError('NETWORK_ERROR', 'There is no network connection', { reason: 'offline' });
  let n = nets.get(s);
  if (!n) {
    const email = { value: null as string | null };
    const net = createNet({ fetch: s.fetch ?? fetch, email: () => email.value, ...(netTuning.sleep ? { sleep: netTuning.sleep } : {}) });
    const sources = createCitationSources({ fetch: s.fetch ?? fetch, net });
    n = { sources, service: createCitationService(sources), watch: createWatchFetcher(net), email };
    nets.set(s, n);
  }
  const st = await s.settings.get();
  n.email.value = st.network.openAlexEmail && st.user.email ? st.user.email : null;
  return { ...n, profile: st.user };
}

const INDEX_TTL_MS = 120_000;
const indexes = new WeakMap<LibraryRuntime, { at: number; index: OwnedIndex }>();

/** What matching needs of the library's documents; reused for two minutes unless `fresh`. */
export async function ownedIndex(rt: LibraryRuntime, fresh = false): Promise<OwnedIndex> {
  const hit = indexes.get(rt);
  if (!fresh && hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.index;
  const index = buildOwnedIndex(await rt.store.documents.list());
  indexes.set(rt, { at: Date.now(), index });
  return index;
}

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

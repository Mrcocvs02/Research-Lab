import { AppError } from '@rl/core';
import { httpGet, WorkLookupError } from './metadata.js';

/** Minimum gap between two requests to a host (OpenAlex 5 per second, Semantic Scholar 1 per second). */
const GAP_MS: Record<string, number> = { 'api.openalex.org': 200, 'api.semanticscholar.org': 1000, 'export.arxiv.org': 1000 };
const RETRIES = 2;

export interface NetOptions {
  fetch: typeof fetch;
  /** The email sent with OpenAlex requests; called for each request so that the setting is read when it is used. Null: none. */
  email?: () => string | null | undefined;
  /**
   * The optional OpenAlex API key, read for each request (never stored here). Added as `api_key` to OpenAlex requests only;
   * the URL carrying it is only handed to `fetch`, never to an error or a log.
   */
  apiKey?: () => string | null | undefined;
  /** Injected in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

export interface Net {
  /** Text of a GET (null on 404), throttled per host, with retries on 429 and 5xx. Throws `AppError` NETWORK_ERROR / CANCELLED. */
  text(url: string, accept: string, signal?: AbortSignal, maxBytes?: number): Promise<string | null>;
  json(url: string, signal?: AbortSignal, maxBytes?: number): Promise<unknown>;
}

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new WorkLookupError('cancelled', 'cancelled'));
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(t);
      reject(new WorkLookupError('cancelled', 'cancelled'));
    }
    signal?.addEventListener('abort', stop, { once: true });
  });

export function networkError(e: unknown): unknown {
  if (!(e instanceof WorkLookupError)) return e;
  if (e.reason === 'cancelled') return new AppError('CANCELLED', 'Cancelled');
  // `offline`: the host could not be reached at all; `timeout`: it did not answer in time (one slow answer is not an outage).
  const reason = e.reason === 'rate-limited' ? 'rate-limited' : e.reason === 'network' ? 'offline' : e.reason === 'timeout' ? 'timeout' : 'http';
  const message = { offline: 'The online source cannot be reached', timeout: 'The online source did not answer in time', 'rate-limited': 'The online source asked to slow down', http: 'The online source answered with an error' }[reason];
  return new AppError('NETWORK_ERROR', message, { reason, ...(e.status ? { status: e.status } : {}) });
}

export function createNet(o: NetOptions): Net {
  const next = new Map<string, number>();
  const sleep = o.sleep ?? realSleep;
  const now = o.now ?? Date.now;

  const text: Net['text'] = async (url, accept, signal, maxBytes) => {
    const u = new URL(url);
    const email = u.host === 'api.openalex.org' ? o.email?.() : null;
    const key = u.host === 'api.openalex.org' ? o.apiKey?.()?.trim() : null;
    const extra = [email ? `mailto=${encodeURIComponent(email)}` : '', key ? `api_key=${encodeURIComponent(key)}` : ''].filter(Boolean).join('&');
    const full = extra ? `${url}${u.search ? '&' : '?'}${extra}` : url;
    for (let attempt = 0; ; attempt++) {
      // The slot is reserved before waiting: concurrent callers queue behind one another.
      const at = Math.max(now(), next.get(u.host) ?? 0);
      next.set(u.host, at + (GAP_MS[u.host] ?? 1000));
      try {
        if (at > now()) await sleep(at - now(), signal);
        return await httpGet(full, accept, { fetch: o.fetch, signal, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(maxBytes ? { maxBytes } : {}) });
      } catch (e) {
        const failure = e instanceof WorkLookupError ? e : null;
        // 429 and 5xx twice; a timeout once (a second one is counted by the caller, not retried again).
        const retry = failure !== null && !signal?.aborted && ((failure.reason !== 'timeout' && (failure.status === 429 || failure.status >= 500) && attempt < RETRIES) || (failure.reason === 'timeout' && attempt < 1));
        if (!retry) throw networkError(e);
        try {
          await sleep(failure!.retryAfterMs || 500 * 2 ** attempt, signal);
        } catch (c) {
          throw networkError(c);
        }
      }
    }
  };

  return {
    text,
    json: async (url, signal, maxBytes) => {
      const t = await text(url, 'application/json', signal, maxBytes);
      if (t === null) return null;
      try {
        return JSON.parse(t) as unknown;
      } catch {
        throw new AppError('NETWORK_ERROR', 'The online source sent an unreadable answer', { reason: 'http' });
      }
    },
  };
}

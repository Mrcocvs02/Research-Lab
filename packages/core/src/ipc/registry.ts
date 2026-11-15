import type { z } from 'zod';

/** A request/response pair, both validated at runtime. */
export interface ChannelDef<Req extends z.ZodType = z.ZodType, Res extends z.ZodType = z.ZodType> {
  request: Req;
  response: Res;
}

export type ChannelRegistry = Record<string, ChannelDef>;
export type EventRegistry = Record<string, z.ZodType>;

type Prefixed<D extends string, T> = { [K in keyof T & string as `${D}:${K}`]: T[K] };

/**
 * Declare the channels of one domain, in its own file. Keys become `<domain>:<name>`,
 * so domains cannot collide. Register the result in `channels/index.ts`.
 */
export function defineChannels<D extends string, const T extends Record<string, ChannelDef>>(domain: D, defs: T): Prefixed<D, T> {
  const out: Record<string, ChannelDef> = {};
  for (const [name, def] of Object.entries(defs)) out[`${domain}:${name}`] = def;
  return out as Prefixed<D, T>;
}

/** Declare the push events (main -> renderer) of one domain. Keys become `<domain>:<name>`. */
export function defineEvents<D extends string, const T extends EventRegistry>(domain: D, defs: T): Prefixed<D, T> {
  const out: Record<string, z.ZodType> = {};
  for (const [name, schema] of Object.entries(defs)) out[`${domain}:${name}`] = schema;
  return out as Prefixed<D, T>;
}

/** Merge several domain registries; throws on a duplicate key. */
export function mergeRegistries<T extends Record<string, unknown>[]>(...parts: T): UnionToIntersection<T[number]> {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      if (k in out) throw new Error(`Duplicate IPC registry key: ${k}`);
      out[k] = v;
    }
  }
  return out as UnionToIntersection<T[number]>;
}
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

/** Payload a caller passes (input side of the request schema: defaults not yet applied). */
export type RequestOf<R extends ChannelRegistry, K extends keyof R> = z.input<R[K]['request']>;
/** What the caller receives (output side of the response schema). */
export type ResponseOf<R extends ChannelRegistry, K extends keyof R> = z.output<R[K]['response']>;

/** Typed `invoke` exposed by the preload as `window.rl.invoke`. */
export type InvokeFn<R extends ChannelRegistry> = <K extends keyof R & string>(channel: K, payload: RequestOf<R, K>) => Promise<ResponseOf<R, K>>;

export type EventPayload<E extends EventRegistry, K extends keyof E> = z.output<E[K]>;
/** Subscribe to a push event; returns the unsubscribe function. */
export type OnEventFn<E extends EventRegistry> = <K extends keyof E & string>(event: K, listener: (payload: EventPayload<E, K>) => void) => () => void;

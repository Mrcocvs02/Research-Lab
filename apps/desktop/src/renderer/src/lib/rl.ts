import type { Channels, Events, InvokeFn, OnEventFn } from '@rl/core';
import { RlError } from './rl-error';

/**
 * Typed IPC client: `await rl.invoke('settings:get', {})`; rejects with an `RlError`. It is the renderer's own thin
 * version of `createRlApi` from `@rl/core`: that one validates every envelope and event with zod, which would put
 * zod (about a third of the bundle) in the first screen. Requests and responses are validated by the main process
 * (the authority, see ARCHITECTURE), so here only the shape of the envelope is checked.
 */
interface Bridge {
  invokeRaw(channel: string, payload: unknown): Promise<unknown>;
  subscribe(event: string, listener: (payload: unknown) => void): () => void;
}

const bridge = (): Bridge => (window as unknown as { rlBridge: Bridge }).rlBridge;

async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const env = (await bridge().invokeRaw(channel, payload)) as { ok?: unknown; data?: unknown; error?: unknown } | null;
  if (env === null || typeof env !== 'object' || typeof env.ok !== 'boolean') throw new RlError('INVALID_RESPONSE', 'Malformed IPC envelope');
  if (env.ok) return env.data;
  throw RlError.from(env.error);
}

export const rl: { invoke: InvokeFn<Channels>; on: OnEventFn<Events> } = {
  invoke: invoke as InvokeFn<Channels>,
  on: ((event: string, listener: (payload: unknown) => void) => bridge().subscribe(event, listener)) as OnEventFn<Events>,
};

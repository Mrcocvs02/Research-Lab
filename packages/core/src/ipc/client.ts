import { AppError } from '../errors.js';
import { events, type Events } from './channels/index.js';
import { unwrapEnvelope, type IpcEnvelope } from './dispatch.js';
import type { RlApi } from './index.js';

/**
 * Low-level surface the preload exposes on `window.rlBridge`. It deals in raw envelopes because
 * Electron's contextBridge drops custom Error properties; `createRlApi` rebuilds typed errors
 * on the renderer side.
 */
export interface RlBridge {
  invokeRaw(channel: string, payload: unknown): Promise<IpcEnvelope>;
  subscribe(event: string, listener: (payload: unknown) => void): () => void;
}

/** Builds the typed `invoke` / `on` API from a bridge. Validates event payloads. */
export function createRlApi(bridge: RlBridge): RlApi {
  return {
    invoke: (async (channel: string, payload: unknown) => unwrapEnvelope(await bridge.invokeRaw(channel, payload))) as RlApi['invoke'],
    on: ((event: keyof Events & string, listener: (payload: unknown) => void) => {
      const schema = events[event];
      if (!schema) throw new AppError('UNKNOWN_CHANNEL', 'Unknown event');
      return bridge.subscribe(event, (raw) => {
        const parsed = schema.safeParse(raw);
        if (parsed.success) listener(parsed.data);
      });
    }) as RlApi['on'],
  };
}

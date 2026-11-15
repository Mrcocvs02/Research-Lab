import type { InvokeFn, OnEventFn } from './registry.js';
import type { Channels, Events } from './channels/index.js';

export * from './channels/index.js';
export * from './dispatch.js';
export * from './registry.js';

/** The API the preload exposes as `window.rl`. */
export interface RlApi {
  invoke: InvokeFn<Channels>;
  on: OnEventFn<Events>;
}

/** Name of the single Electron IPC channel carrying all invokes. */
export const IPC_INVOKE_CHANNEL = 'rl:invoke';
/** Name of the single Electron IPC channel carrying all push events. */
export const IPC_EVENT_CHANNEL = 'rl:event';

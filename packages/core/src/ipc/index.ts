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

/** Names of the single Electron IPC channels carrying all invokes and all push events (defined with the name lists). */
export { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from './names.js';
export * from './client.js';

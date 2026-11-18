import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { createEventBus } from './eventBus';
import type { IpcEnvelope, RlBridge } from '@rl/core';
// Plain name lists, not the registry: the preload runs in every window at start and must not load zod and every schema.
import { CHANNEL_NAMES, EVENT_NAMES, IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@rl/core/ipc-names';

const CHANNELS = new Set(CHANNEL_NAMES);
const EVENTS = new Set(EVENT_NAMES);
const unknownChannel: IpcEnvelope = { ok: false, error: { code: 'UNKNOWN_CHANNEL', message: 'Unknown channel' } };

/**
 * The only thing the renderer gets: two functions, no Electron objects, no generic ipcRenderer.
 * Unknown channel names are refused here and again in the main process.
 */
// One ipcRenderer listener for all the subscribers of the window (see eventBus.ts).
const onIpc = (_e: unknown, name: string, payload: unknown) => dispatchEvent(name, payload);
let dispatchEvent: (name: string, payload: unknown) => void = () => {};
const events = createEventBus(
  (dispatch) => {
    dispatchEvent = dispatch;
    ipcRenderer.on(IPC_EVENT_CHANNEL, onIpc);
  },
  () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, onIpc),
);

const bridge: RlBridge = {
  async invokeRaw(channel, payload): Promise<IpcEnvelope> {
    if (typeof channel !== 'string' || !CHANNELS.has(channel)) return unknownChannel;
    return (await ipcRenderer.invoke(IPC_INVOKE_CHANNEL, channel, payload)) as IpcEnvelope;
  },
  subscribe(event, listener) {
    if (typeof event !== 'string' || !EVENTS.has(event)) throw new Error('Unknown event');
    return events.subscribe(event, listener);
  },
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
};

contextBridge.exposeInMainWorld('rlBridge', bridge);

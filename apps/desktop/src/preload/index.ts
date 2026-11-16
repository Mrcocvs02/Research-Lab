import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { AppError, channels, events, IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL, type IpcEnvelope, type RlBridge } from '@rl/core';

/**
 * The only thing the renderer gets: two functions, no Electron objects, no generic ipcRenderer.
 * Unknown channel names are refused here and again in the main process.
 */
const bridge: RlBridge = {
  async invokeRaw(channel, payload): Promise<IpcEnvelope> {
    if (typeof channel !== 'string' || !Object.hasOwn(channels, channel)) {
      return { ok: false, error: new AppError('UNKNOWN_CHANNEL', 'Unknown channel').toJSON() };
    }
    return (await ipcRenderer.invoke(IPC_INVOKE_CHANNEL, channel, payload)) as IpcEnvelope;
  },
  subscribe(event, listener) {
    if (typeof event !== 'string' || !Object.hasOwn(events, event)) throw new AppError('UNKNOWN_CHANNEL', 'Unknown event');
    const handler = (_e: unknown, name: string, payload: unknown) => {
      if (name === event) listener(payload);
    };
    ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    };
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

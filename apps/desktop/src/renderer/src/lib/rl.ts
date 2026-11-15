import { createRlApi } from '@rl/core';

/** Typed IPC client: `await rl.invoke('settings:get', {})`; rejects with `AppError`. */
export const rl = createRlApi(window.rlBridge);

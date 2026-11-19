/// <reference types="vite/client" />
import type { RlBridge } from '@rl/core';

declare global {
  interface Window {
    /** Raw bridge from the preload. Application code uses `rl` from `./lib/rl`. */
    rlBridge: RlBridge;
    /** True only in an e2e development run (RL_E2E=1): the preload sets it, the Map then exposes `__rlMapProbe`. */
    rlE2E?: true;
    __rlMapProbe?: () => unknown;
  }
}

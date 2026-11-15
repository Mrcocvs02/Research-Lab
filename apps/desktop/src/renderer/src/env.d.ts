/// <reference types="vite/client" />
import type { RlBridge } from '@rl/core';

declare global {
  interface Window {
    /** Raw bridge from the preload. Application code uses `rl` from `./lib/rl`. */
    rlBridge: RlBridge;
  }
}

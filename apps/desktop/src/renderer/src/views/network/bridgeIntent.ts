import type { BridgePath } from './BridgePath';

/**
 * A bridge to draw in the Map, handed over by the Discover view ("Show on the map"): a one-slot mailbox read once when the Map
 * mounts, like `discoverIntent` the other way round, so neither view imports the other.
 */
let pending: BridgePath | null = null;

export function setMapBridge(path: BridgePath | null): void {
  pending = path;
}

export function takeMapBridge(): BridgePath | null {
  const p = pending;
  pending = null;
  return p;
}

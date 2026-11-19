/**
 * "Extend the bibliography" and "Find a bridge" started from another view (the selection bar of the Library): what to search
 * from. A one-slot mailbox, read once by Discover when it mounts, so the Library needs no import of Discover and Discover no
 * knowledge of who asked (the same pattern as `libraryIntent`).
 */
export interface DiscoverIntent {
  kind: 'extend' | 'bridge';
  docIds: string[];
}

let pending: DiscoverIntent | null = null;

export function setDiscoverIntent(intent: DiscoverIntent | null): void {
  pending = intent;
}

export function takeDiscoverIntent(): DiscoverIntent | null {
  const p = pending;
  pending = null;
  return p;
}

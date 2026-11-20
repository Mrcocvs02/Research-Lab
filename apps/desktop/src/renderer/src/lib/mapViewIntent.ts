/**
 * "Open on the Map" from a project (section 20.7.1): the saved view to open. A one-slot mailbox, read once when the Map's panel mounts
 * (the same pattern as `libraryIntent`), so the project page needs no import of the Map.
 */
let pending: string | null = null;

export function setMapViewIntent(viewId: string | null): void {
  pending = viewId;
}

export function takeMapViewIntent(): string | null {
  const p = pending;
  pending = null;
  return p;
}

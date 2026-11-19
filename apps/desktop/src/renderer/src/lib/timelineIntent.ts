/**
 * "Linea del tempo" started from the selection bar of the Library: the documents to lay out by year in the Map. A one-slot
 * mailbox, read once by the Map when it mounts (the same pattern as `discoverIntent`), so the Library needs no import of the Map.
 */
let pending: string[] | null = null;

export function setTimelineIntent(docIds: string[] | null): void {
  pending = docIds;
}

export function takeTimelineIntent(): string[] | null {
  const p = pending;
  pending = null;
  return p;
}

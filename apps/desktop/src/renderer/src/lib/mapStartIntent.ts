/**
 * "Show on the Map" from the link finder (§18.2): the document the network of the Map starts from. A one-slot mailbox, read
 * once by the Map when it mounts (the same pattern as `timelineIntent`), so the Library needs no import of the Map.
 */
let pending: { docId: string; label: string } | null = null;

export function setMapStart(start: { docId: string; label: string } | null): void {
  pending = start;
}

export function takeMapStart(): { docId: string; label: string } | null {
  const p = pending;
  pending = null;
  return p;
}

/**
 * "Open in the Library" from another view (the Map): the filter to start with. A one-slot mailbox, read once by the Library
 * when it mounts, so the other view needs no import of the Library and the Library no knowledge of who asked.
 */
export interface LibraryIntent {
  /** Taxonomy node ids that must all be on the documents. */
  tags?: string[];
  /** Author names (every written form of one author). */
  authors?: string[];
  /** An explicit set of documents (a topic of the model). */
  docIds?: string[];
  /** Open the vocabulary with the guided cleanup ("Tidy the tags" from the Map, D-508). */
  cleanup?: boolean;
}

let pending: LibraryIntent | null = null;

export function setLibraryIntent(intent: LibraryIntent | null): void {
  pending = intent;
}

export function takeLibraryIntent(): LibraryIntent | null {
  const p = pending;
  // Cleared after the render that read it (a strict-mode render reads twice).
  queueMicrotask(() => {
    if (pending === p) pending = null;
  });
  return p;
}

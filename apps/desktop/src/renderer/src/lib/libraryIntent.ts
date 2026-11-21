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
  /** Open the tag manager directly (palette, shortcut, sidebar, facet): the tree, "To review", the guided cleanup or the field vocabulary dialog. */
  manage?: TagPlace;
}

export type TagPlace = 'manage' | 'review' | 'cleanup' | 'pack';
/** Sent when the Library is already on screen (a mailbox read at mount does not reach it). */
export const TAG_MANAGER_EVENT = 'rl:tag-manager';

/** The direct way into the tag manager: leaves the request and moves to the Library (`toLibrary`) unless it is there already. */
export function openTagManager(toLibrary: () => void, place: TagPlace = 'manage'): void {
  setLibraryIntent({ manage: place });
  window.dispatchEvent(new Event(TAG_MANAGER_EVENT));
  toLibrary();
}

/** The place an intent asks for (the Map's `cleanup` flag is the old way to say `cleanup`). */
export const tagPlaceOf = (i: LibraryIntent | null): TagPlace | null => i?.manage ?? (i?.cleanup ? 'cleanup' : null);

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

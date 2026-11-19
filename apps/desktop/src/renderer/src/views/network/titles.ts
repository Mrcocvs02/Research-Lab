import { rl } from '../../lib/rl';

/** Titles of the documents drawn next to their points on a deep zoom (§4.22): fetched a few at a time, kept for the session. Never an id. */
const cache = new Map<string, string | null>();
const pending = new Set<string>();

export const peekTitle = (docId: string): string | null => cache.get(docId) ?? null;

/** The title, or the file name without its extension; null when the document has neither. */
export const titleOrName = (d: { title: string | null; path?: string | undefined }): string | null => {
  if (d.title && d.title.trim() !== '') return d.title;
  const name = d.path?.split(/[\/]/).pop()?.replace(/\.[^.]+$/, '');
  return name && name !== '' ? name : null;
};

/** Asks for the titles not known yet (at most 30 per call); `done` runs after each one arrives. */
export function wantTitles(ids: readonly string[], done: () => void): void {
  for (const id of ids.filter((i) => !cache.has(i) && !pending.has(i)).slice(0, 30)) {
    pending.add(id);
    rl.invoke('documents:get', { docId: id }).then(
      (d) => cache.set(id, titleOrName(d)),
      () => cache.set(id, null),
    ).finally(() => {
      pending.delete(id);
      done();
    });
  }
}

import { useSyncExternalStore } from 'react';

/**
 * "Add from DOI, arXiv or URL" and "Add a resource or link" can start from the + Add menu, the search box, the palette or
 * the document card. A one-slot mailbox: any of them asks, the shell (`AddDialogs`) shows the dialog, so none of them
 * imports the dialogs and their code stays lazy.
 */
export type AddRequest = { kind: 'id'; text?: string } | { kind: 'resource'; docId?: string };

let current: AddRequest | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function requestAdd(req: AddRequest | null): void {
  current = req;
  for (const l of [...listeners]) l();
}

export const useAddRequest = (): AddRequest | null => useSyncExternalStore(subscribe, () => current, () => current);

const DOI = /^\s*(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+\s*$/i;
const ARXIV = /^\s*(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?\s*$/i;

/** Text pasted in the search box that is a DOI or an arXiv id (so the box can offer to add it). */
export const looksLikeIdentifier = (text: string): boolean => text.length <= 300 && (DOI.test(text) || ARXIV.test(text));

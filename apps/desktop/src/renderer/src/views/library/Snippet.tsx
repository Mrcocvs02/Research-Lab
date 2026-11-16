import type { ReactNode } from 'react';
import { SEARCH_MARK_CLOSE, SEARCH_MARK_OPEN } from '@rl/core';
import { safeText } from './safeText';

const SPLIT = new RegExp(`([${SEARCH_MARK_OPEN}${SEARCH_MARK_CLOSE}])`);

/**
 * Shows a snippet whose matches sit between the marker characters U+0001 and U+0002 (stripped from document
 * text at indexing, so only the index can produce them): as `<mark>` text nodes, never as HTML.
 * Literal `[[` and `]]` are ordinary text.
 */
export function Snippet({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let marked = false;
  text.split(SPLIT).forEach((part, i) => {
    if (part === SEARCH_MARK_OPEN) marked = true;
    else if (part === SEARCH_MARK_CLOSE) marked = false;
    else {
      const clean = safeText(part);
      if (clean) out.push(marked ? <mark key={i}>{clean}</mark> : clean);
    }
  });
  return <>{out}</>;
}

/** A snippet without markers, for tooltips. */
export const plainSnippet = (text: string): string => safeText(text.replaceAll(SEARCH_MARK_OPEN, '').replaceAll(SEARCH_MARK_CLOSE, ''));

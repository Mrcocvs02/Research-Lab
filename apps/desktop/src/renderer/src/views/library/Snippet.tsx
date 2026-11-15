import type { ReactNode } from 'react';

/** Shows a snippet whose matches are marked `[[...]]`: as `<mark>` text nodes, never as HTML. */
export function Snippet({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let marked = false;
  text.split(/(\[\[|\]\])/).forEach((part, i) => {
    if (part === '[[') marked = true;
    else if (part === ']]') marked = false;
    else if (part) out.push(marked ? <mark key={i}>{part}</mark> : part);
  });
  return <>{out}</>;
}

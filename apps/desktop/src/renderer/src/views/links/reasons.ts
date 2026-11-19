/** The reasons of a link (§18.2) as stored by the main process. */
export interface LinkReasons {
  terms?: string[];
  cites?: 'to' | 'from' | 'both';
  shared?: number;
  tags?: string[];
  authors?: string[];
}

export interface FoundLink {
  id?: string;
  docId: string;
  title: string;
  year: number | null;
  weight: number;
  reasons: LinkReasons;
}

/** One sentence from the reasons; `tr` is the translation of `<prefix>.reason.<part>`. */
export function reasonLine(r: LinkReasons | undefined, tr: (part: string, opts?: Record<string, unknown>) => string, clean: (s: string) => string): string {
  if (!r) return tr('none');
  const out: string[] = [];
  if (r.cites) out.push(tr(r.cites));
  else if (r.shared) out.push(tr('shared', { count: r.shared }));
  if (r.terms?.length) out.push(tr('terms', { terms: r.terms.map(clean).join(', ') }));
  if (r.tags?.length) out.push(tr('tags', { tags: r.tags.map(clean).join(', ') }));
  if (r.authors?.length) out.push(tr('authors', { authors: r.authors.map(clean).join(', ') }));
  return out.length > 0 ? out.join(' · ') : tr('none');
}

/** A weight 0..1 as five blocks and two decimals. */
export const weightBar = (w: number): string => {
  const n = Math.max(0, Math.min(5, Math.round(w * 5)));
  return '▮'.repeat(n) + '▯'.repeat(5 - n);
};

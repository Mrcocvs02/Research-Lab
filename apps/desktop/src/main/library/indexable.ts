import type { AiField, DocumentId, DocumentRecord, IndexableDocument, LibraryStore, TaxonomyFile } from '@rl/core';

/** Words of the taxonomy that make a document findable: tag labels and aliases, type labels, venue names. */
export interface TaxonomyLookup {
  tagTerms(ids: string[]): Record<string, string[]>;
  /** The tags plus everything they imply, transitively (computed here, never stored on the record). */
  expandTags(ids: readonly string[]): string[];
  tagLabel(id: string): string | undefined;
  typeLabel(id: string | null): string | undefined;
  venueName(id: string | undefined): string | undefined;
}

export function makeTaxonomyLookup(tax: Pick<TaxonomyFile, 'nodes' | 'documentTypes' | 'venues'> | null): TaxonomyLookup {
  const nodes = new Map((tax?.nodes ?? []).map((n) => [n.id, n]));
  const types = new Map((tax?.documentTypes ?? []).map((t) => [t.id, t]));
  const venues = new Map((tax?.venues ?? []).map((v) => [v.id, v]));
  return {
    expandTags(ids) {
      const out = new Set<string>(ids);
      const stack = [...ids];
      while (stack.length > 0) {
        for (const next of nodes.get(stack.pop() as string)?.implies ?? []) {
          if (!out.has(next)) {
            out.add(next);
            stack.push(next);
          }
        }
      }
      return [...out];
    },
    tagTerms(ids) {
      const out: Record<string, string[]> = {};
      for (const id of ids) {
        const n = nodes.get(id);
        out[id] = n ? [n.label, ...n.aliases] : [id];
      }
      return out;
    },
    tagLabel: (id) => nodes.get(id)?.label,
    typeLabel: (id) => (id ? types.get(id)?.label : undefined),
    venueName: (id) => (id ? venues.get(id)?.name : undefined),
  };
}

const usable = <T>(f: AiField<T> | undefined): T | undefined => (f && f.review.status !== 'rejected' ? f.value : undefined);

/**
 * The abstract to index. `undefined` keeps what the index has; `''` clears it. The AI summary/description win when
 * the user has not rejected them; otherwise the abstract found in the file (right after an extraction, `extraction`
 * is given and "none found" means `''`). Without an extraction, a rejected or withdrawn AI text must not stay in
 * the index: `''` when the record still carries AI text that is rejected, else the index keeps its abstract
 * (the one found in the file's text).
 */
function abstractOf(record: DocumentRecord, extraction: { abstract?: string } | undefined): string | undefined {
  const ai = [usable(record.ai.summary), usable(record.ai.description)].filter(Boolean).join('\n\n');
  if (ai) return ai;
  if (extraction) return extraction.abstract || '';
  return record.ai.summary || record.ai.description ? '' : undefined;
}

type Source = Pick<LibraryStore, 'notes' | 'annotations'>;

/**
 * Everything searchable about a document except its page text: metadata, tag words, the user's notes and
 * annotations, and the AI-written summary and keywords (only when the user has not rejected them; they stay
 * in `record.ai`, the index just reads them). Notes or annotations that cannot be read are left out of
 * the update (the index keeps what it has).
 */
export async function buildIndexable(
  src: Source,
  taxonomy: TaxonomyLookup,
  record: DocumentRecord,
  extraction?: { abstract?: string },
): Promise<Omit<IndexableDocument, 'pages'>> {
  // Implied tags are searchable and filterable like the document's own (D-103): the index sees the expanded list.
  const tags = taxonomy.expandTags(record.tags);
  const out: Omit<IndexableDocument, 'pages'> = {
    record: tags.length === record.tags.length ? record : { ...record, tags },
    tagTerms: taxonomy.tagTerms(tags),
    typeLabel: taxonomy.typeLabel(record.type),
    venueName: taxonomy.venueName(record.ref.venueId),
    abstract: abstractOf(record, extraction),
    keywords: [...(usable(record.ai.keywords) ?? []), ...(usable(record.ai.synonyms) ?? [])],
  };
  try {
    const notes = await src.notes.listForDocument(record.id as DocumentId);
    // The user's short description of the file is searched like a note.
    out.notes = [record.userDescription, ...notes.map((n) => n.body)].filter(Boolean).join('\n\n');
  } catch {
    // keep what is indexed
  }
  try {
    const file = await src.annotations.get(record.id as DocumentId);
    out.annotations = (file?.annotations ?? []).map((a) => [a.text, a.comment].filter(Boolean).join(' ')).join('\n');
  } catch {
    // keep what is indexed
  }
  return out;
}

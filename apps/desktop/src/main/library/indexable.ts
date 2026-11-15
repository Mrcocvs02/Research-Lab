import type { AiField, DocumentId, DocumentRecord, IndexableDocument, LibraryStore, TaxonomyFile } from '@rl/core';

/** Words of the taxonomy that make a document findable: tag labels and aliases, type labels, venue names. */
export interface TaxonomyLookup {
  tagTerms(ids: string[]): Record<string, string[]>;
  tagLabel(id: string): string | undefined;
  typeLabel(id: string | null): string | undefined;
  venueName(id: string | undefined): string | undefined;
}

export function makeTaxonomyLookup(tax: Pick<TaxonomyFile, 'nodes' | 'documentTypes' | 'venues'> | null): TaxonomyLookup {
  const nodes = new Map((tax?.nodes ?? []).map((n) => [n.id, n]));
  const types = new Map((tax?.documentTypes ?? []).map((t) => [t.id, t]));
  const venues = new Map((tax?.venues ?? []).map((v) => [v.id, v]));
  return {
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

type Source = Pick<LibraryStore, 'notes' | 'annotations'>;

/**
 * Everything searchable about a document except its page text: metadata, tag words, the user's notes and
 * annotations, and the AI-written summary and keywords (only when the user has not rejected them; they stay
 * in `record.ai`, the index just reads them). Notes or annotations that cannot be read are left out of
 * the update (the index keeps what it has).
 */
export async function buildIndexable(src: Source, taxonomy: TaxonomyLookup, record: DocumentRecord): Promise<Omit<IndexableDocument, 'pages'>> {
  const out: Omit<IndexableDocument, 'pages'> = {
    record,
    tagTerms: taxonomy.tagTerms(record.tags),
    typeLabel: taxonomy.typeLabel(record.type),
    venueName: taxonomy.venueName(record.ref.venueId),
    abstract: [usable(record.ai.summary), usable(record.ai.description)].filter(Boolean).join('\n\n'),
    keywords: [...(usable(record.ai.keywords) ?? []), ...(usable(record.ai.synonyms) ?? [])],
  };
  try {
    const notes = await src.notes.listForDocument(record.id as DocumentId);
    out.notes = notes.map((n) => n.body).join('\n\n');
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

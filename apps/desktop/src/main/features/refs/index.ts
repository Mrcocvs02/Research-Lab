import { createTextExtractor } from '@rl/data';
import { lastName, titleKey } from '@rl/citations';
import { AppError, contentHashOf, documentIdSchema, type DocumentId, type RefEntry } from '@rl/core';
import { citationView } from '../../citations/refresh.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { localPaths } from '../../library/library-runtime.js';
import { bibliographyLines, parseBibliography, type RawEntry } from './parse.js';

/**
 * References of a paper (feature 29, D-415): the bibliography is read from the extracted text of the file (this machine only, no
 * network, no Claude) and each entry is matched to the citations already stored for the paper (OpenAlex, fetched on the
 * user's "Update citations"). An entry nothing matches keeps its raw text. Loaded on demand (dynamic import behind the handler).
 */
const DOI = /\b10\.\d{4,9}\/[^\s"<>]+/i;
type Link = Awaited<ReturnType<typeof citationView>>['references'][number];

/** Which stored reference an entry is: by DOI in the text, else by the title in the text, else by first author and year. */
export function matchEntry(e: RawEntry, links: readonly Link[]): Link | null {
  const doi = DOI.exec(e.text)?.[0]?.replace(/[.,;)]+$/, '').toLowerCase();
  if (doi) {
    const hit = links.find((l) => l.doi?.toLowerCase() === doi);
    if (hit) return hit;
  }
  const key = titleKey(e.text);
  const byTitle = links.find((l) => l.title && titleKey(l.title).length >= 15 && key.includes(titleKey(l.title)));
  if (byTitle) return byTitle;
  if (e.surname && e.year) return links.find((l) => l.year === e.year && lastName(l.authors?.[0]) === e.surname) ?? null;
  return null;
}

export async function getRefs(s: MainServices, req: { docId: string }): Promise<{ found: boolean; items: RefEntry[] }> {
  const rt = await s.runtime.require();
  const rec = await rt.store.documents.get(documentIdSchema.parse(req.docId) as DocumentId);
  if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
  if (rec.missing) return { found: false, items: [] };
  const root = (await s.libraries.profile(rt.libraryId)).rootPath;
  const extractor = createTextExtractor({ cacheDir: localPaths(s.localDataDir, rt.libraryId).textCacheDir });
  const text = await extractor.extract(root, rec.path, { hash: contentHashOf(rec), ...(rec.pdfWrite ? { contentHash: contentHashOf(rec) } : {}) }).catch((e: unknown) => {
    s.log.warn('references: text unavailable', { error: e });
    return null;
  });
  const lines = text ? bibliographyLines(text.pages) : null;
  const entries = lines ? parseBibliography(lines) : [];
  if (entries.length === 0) return { found: false, items: [] };
  const links = (await citationView(rt, rec.id)).references;
  return {
    found: true,
    items: entries.map((e) => {
      const l = matchEntry(e, links);
      return {
        ...e,
        work: l ? { title: l.title ?? null, authors: (l.authors ?? []).slice(0, 6), year: l.year ?? null, venue: l.venue ?? null, doi: l.doi ?? null, arxivId: l.arxivId ?? null } : null,
        docId: l?.matched?.docId ?? null,
      };
    }),
  };
}

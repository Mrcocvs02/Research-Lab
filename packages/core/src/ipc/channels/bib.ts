import { z } from 'zod';
import { defineChannels } from '../registry.js';

export interface BibAnalysis {
  previewId: string;
  source: 'bibtex' | 'csl' | 'rdf' | 'zotero';
  entries: number;
  inLibrary: number;
  withFile: number;
  noFile: number;
  tags: number;
  notes: number;
  collections: Array<{ name: string; count: number }>;
}
export interface BibImportResult {
  changeId: string | null;
  updated: number;
  tagged: number;
  projects: number;
  notes: number;
  queued: number;
  notImported: Array<{ label: string; reason: string }>;
}
export interface BibStatus {
  linked: boolean;
  file: string | null;
  state: 'ok' | 'changed-outside' | 'missing' | 'error';
  at: string | null;
}

// Responses are built by the main process, so they are typed here and not validated again (the main entry stays small, D-408).
const reply = <T>() => z.custom<T>();
const pid = z.string().min(1).max(100);

/** Zotero and BibTeX (7, 52): the logic is in `main/features/bib/`, loaded on first use. */
export const bibChannels = defineChannels('bib', {
  /** Reads a file picked with `dialog:chooseFile` (purpose `bib-source`): BibTeX, CSL JSON, Zotero RDF or a Zotero database. Read-only. */
  analyze: { request: z.object({ path: z.string().min(1).max(1024) }), response: reply<BibAnalysis>() },
  import: {
    request: z.object({ previewId: z.string().max(64), collections: z.enum(['projects', 'tags', 'ignore']), tags: z.boolean(), notes: z.boolean(), queueFiles: z.boolean() }),
    response: reply<BibImportResult>(),
  },
  /**
   * The managed .bib file of a project: `link` (folder from `dialog:chooseFolder`, purpose `export-destination`, and a file name), `unlink`,
   * `status`, `overwrite` (rewrite although the file was changed outside the app: the user chose "Overwrite").
   */
  link: {
    request: z.object({ projectId: pid, op: z.enum(['status', 'link', 'unlink', 'overwrite']), destination: z.string().max(1024).optional(), fileName: z.string().max(120).optional() }),
    response: reply<BibStatus>(),
  },
  /** BibTeX of a project or of documents, to the clipboard (D-436). */
  copy: { request: z.object({ projectId: pid.optional(), docIds: z.array(z.string().max(32)).max(5000).optional() }), response: reply<{ count: number }>() },
});

import { z } from 'zod';
import { defineChannels } from '../registry.js';
import { exportSelectionSchema } from './export.js';

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

/** PRISMA 2020 flow counts of a project (D-439): identified per source, then the steps; `edited` marks the numbers the user typed over the app's own. */
export interface PrismaCounts {
  identified: Array<{ source: string; count: number }>;
  duplicates: number;
  screened: number;
  excludedScreening: number;
  assessed: number;
  excludedFull: Array<{ reason: string; count: number }>;
  included: number;
}
export interface PrismaState {
  counts: PrismaCounts;
  /** Reasons of the candidates rejected at screening in the app, by code or text, with how many. */
  screeningReasons: Array<{ reason: string; count: number }>;
  edited: boolean;
}
const prismaCountsSchema = z.object({
  identified: z.array(z.object({ source: z.string().trim().min(1).max(80), count: z.number().int().min(0).max(1e7) })).max(20),
  duplicates: z.number().int().min(0).max(1e7),
  screened: z.number().int().min(0).max(1e7),
  excludedScreening: z.number().int().min(0).max(1e7),
  assessed: z.number().int().min(0).max(1e7),
  excludedFull: z.array(z.object({ reason: z.string().trim().min(1).max(200), count: z.number().int().min(0).max(1e7) })).max(20),
  included: z.number().int().min(0).max(1e7),
});

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
  /**
   * References of an export selection to a file in a folder chosen with `dialog:chooseFolder` (purpose `export-destination`):
   * BibTeX, RIS or CSL JSON, keys by the schema of the library (Z2). The file name is the base of `fileName` plus the extension of the format.
   */
  export: {
    request: z.object({ selection: exportSelectionSchema, format: z.enum(['bibtex', 'ris', 'csl']), destination: z.string().min(1).max(1024), fileName: z.string().max(120).optional() }),
    response: reply<{ count: number; file: string }>(),
  },
  /** A text file (SVG or Markdown of the PRISMA diagram, or `pdf`: the Markdown of a report laid out as a plain PDF) to a new file in a folder chosen with `dialog:chooseFolder`; an existing file is never overwritten (the name gets a number). */
  saveText: {
    request: z.object({ destination: z.string().min(1).max(1024), fileName: z.string().max(100), ext: z.enum(['svg', 'md', 'pdf']), text: z.string().max(400_000) }),
    response: reply<{ file: string }>(),
  },
  /** The PRISMA counts of a project: the app's own (from its "extend" searches) plus what the user added for steps done outside. */
  prismaGet: { request: z.object({ projectId: pid }), response: reply<PrismaState>() },
  /** Saves the counts as the user edited them (the difference from the app's own is what is kept). */
  prismaSet: { request: z.object({ projectId: pid, counts: prismaCountsSchema }), response: reply<PrismaState>() },
});

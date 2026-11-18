import { z } from 'zod';
import { defineChannels } from '../registry.js';

/** What a resource is. `reference` is a work added from a DOI or an arXiv id with no file ("Senza file"). */
export const RESOURCE_KINDS = ['code', 'data', 'web', 'notebook', 'folder', 'reference'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceView {
  id: string;
  kind: ResourceKind;
  title: string;
  description: string;
  /** http(s) address, or null for a local resource. */
  url: string | null;
  /** Host of `url` (for the row), null for a local resource. */
  host: string | null;
  /** Library-relative path of a local resource, null for a link. */
  path: string | null;
  /** A local resource whose file or folder is no longer there. */
  missing: boolean;
  source: 'link' | 'doi' | 'arxiv';
  doi: string | null;
  arxivId: string | null;
  authors: string[];
  year: number | null;
  preview: { title: string | null; description: string | null; at: string } | null;
  docs: string[];
  projects: string[];
  createdAt: string;
}

export type ImportIdState = 'recognized' | 'in-library' | 'not-found' | 'offline' | 'invalid';
export interface ImportIdItem {
  /** The line as typed (cut). */
  input: string;
  kind: 'doi' | 'arxiv' | null;
  /** Normalised identifier (DOI without prefix, arXiv id with its version when given). */
  id: string | null;
  state: ImportIdState;
  /** `invalid` and `not-found`: why (`not-http`, `private-host`, `no-id`, `shape`, `too-long`). */
  reason?: string;
  metadata?: { title: string | null; authors: string[]; year: number | null; venue: string | null };
  existing?: { kind: 'document' | 'resource'; id: string; title: string | null };
  /** The open PDF can be downloaded (arXiv only: the metadata host serves it). */
  canDownload: boolean;
}
export interface ImportIdAddResult {
  added: number;
  skipped: number;
  /** PDFs downloaded and waiting in the inbox for the user's confirmation. */
  queued: number;
  /** PDFs that could not be downloaded (the data entry was still added). */
  failedDownloads: number;
}
export interface ResumeInfo {
  last: { docId: string; title: string | null; page: number | null; at: string } | null;
  recent: Array<{ docId: string; title: string | null; page: number | null; at: string }>;
  /** Set once after an unclean close: the document that was open. */
  unclean: { docId: string; title: string | null; page: number | null } | null;
}

// Responses are built by the main process, so they are typed here and not validated again (the main entry stays small, D-408).
const reply = <T>() => z.custom<T>();
const rid = z.string().min(1).max(100);
const text = (n: number) => z.string().max(n);

/** Resources beyond PDFs (48, D-398): links and local files or folders of the library, linked to documents and projects. */
export const resourcesChannels = defineChannels('resources', {
  list: { request: z.object({ docId: rid.optional(), projectId: rid.optional() }), response: z.object({ items: z.array(reply<ResourceView>()) }) },
  /**
   * Adds a link (`url`, http or https only) or a local resource (`path`: what `dialog:chooseFile` or `dialog:chooseFolder`
   * with a `resource-*` purpose returned; it must be inside the library, it is stored relative to it).
   */
  add: {
    request: z.object({
      kind: z.enum(RESOURCE_KINDS).exclude(['reference']),
      url: text(2048).optional(),
      path: text(1024).optional(),
      title: text(300).optional(),
      description: text(2000).optional(),
      docIds: z.array(rid).max(50).default([]),
      projectIds: z.array(rid).max(50).default([]),
    }),
    response: reply<ResourceView>(),
  },
  update: {
    request: z.object({ id: rid, title: text(300).optional(), description: text(2000).optional(), docIds: z.array(rid).max(50).optional(), projectIds: z.array(rid).max(50).optional() }),
    response: reply<ResourceView>(),
  },
  remove: { request: z.object({ id: rid }), response: z.object({ ok: z.literal(true) }) },
  /** A link opens in the browser (http and https only); a local file or folder opens with the default program (same policy as documents). */
  open: { request: z.object({ id: rid }), response: z.object({ ok: z.literal(true) }) },
  /** "Load the preview · contacts the site": title and description only, no cookies, 512 KB at most, no images. */
  preview: { request: z.object({ id: rid }), response: reply<ResourceView>() },
});

/** Import from DOI, arXiv or URL (23): the data come from OpenAlex and arXiv; the open PDF only after the user's confirmation. */
export const importIdChannels = defineChannels('importId', {
  resolve: { request: z.object({ text: text(20_000) }), response: z.object({ items: z.array(reply<ImportIdItem>()) }) },
  add: {
    request: z.object({ entries: z.array(z.object({ kind: z.enum(['doi', 'arxiv']), id: text(300) })).min(1).max(20), downloadPdf: z.boolean().default(false) }),
    response: reply<ImportIdAddResult>(),
  },
});

/** Resume reading (25, D-414). */
export const resumeChannels = defineChannels('resume', {
  get: { request: z.object({}), response: reply<ResumeInfo>() },
  /** The reader shows `page` of `docId` (debounced by the caller); `closed`: the reader was closed. */
  record: { request: z.object({ docId: rid, page: z.number().int().min(1).max(100_000).optional(), closed: z.boolean().default(false) }), response: z.object({ ok: z.literal(true) }) },
});

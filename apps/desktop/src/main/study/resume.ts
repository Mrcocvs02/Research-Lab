import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DocumentId, ResumeInfo } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';

/**
 * "Resume" (25, D-414). The reading position is two fields of the document's study state (`lastPage`, `lastOpenedAt`),
 * written when the reader rests on a page or closes. A small local file marks the document that is open; the normal
 * quit removes it (`closeOpenMark`), so a mark found at the next start means the app did not close cleanly.
 */
const FILE = 'open-reader.json';
const markFile = (dir: string) => path.join(dir, FILE);

let startup: { libraryId: string; docId: string; page: number | null } | null = null;

/** At the start of the app: reads the mark the last run left, if any, and removes it. */
export function initResume(localDataDir: string): void {
  try {
    const m = JSON.parse(readFileSync(markFile(localDataDir), 'utf8')) as { libraryId?: unknown; docId?: unknown; page?: unknown };
    if (typeof m.libraryId === 'string' && typeof m.docId === 'string') startup = { libraryId: m.libraryId, docId: m.docId, page: typeof m.page === 'number' ? m.page : null };
  } catch {
    startup = null;
  }
  closeOpenMark(localDataDir);
}

/** Normal quit (and a closed reader): no document is open any more. */
export function closeOpenMark(localDataDir: string): void {
  try {
    rmSync(markFile(localDataDir), { force: true });
  } catch {
    /* nothing to remove, or the folder is not writable: the next start simply sees no mark */
  }
}

export async function recordResume(s: MainServices, req: { docId: string; page?: number | undefined; closed: boolean }): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  if (req.closed) closeOpenMark(s.localDataDir);
  else {
    try {
      writeFileSync(markFile(s.localDataDir), JSON.stringify({ libraryId: rt.libraryId, docId: req.docId, page: req.page ?? null }));
    } catch {
      /* the mark is a convenience */
    }
  }
  await rt.store.documents
    .update(req.docId as DocumentId, (cur) => {
      if (!cur) throw new Error('unknown document');
      const page = req.page ?? cur.study.lastPage;
      // A page the reader only passes through is not written: the same page again changes nothing.
      if (req.page !== undefined && cur.study.lastPage === page && !req.closed) return cur;
      return { ...cur, study: { ...cur.study, ...(page !== undefined ? { lastPage: page } : {}), lastOpenedAt: new Date().toISOString() } };
    })
    .catch((e: unknown) => s.log.warn('recording the reading position failed', { error: e }));
  return { ok: true };
}

export async function getResume(s: MainServices): Promise<ResumeInfo> {
  const rt = await s.runtime.require();
  const docs = (await rt.store.documents.list()).filter((d) => d.study.lastOpenedAt && !d.missing && /\.pdf$/i.test(d.path));
  docs.sort((a, b) => (b.study.lastOpenedAt ?? '').localeCompare(a.study.lastOpenedAt ?? ''));
  const row = (d: (typeof docs)[number]) => ({ docId: d.id, title: d.title, page: d.study.lastPage ?? null, at: d.study.lastOpenedAt! });
  let unclean: ResumeInfo['unclean'] = null;
  if (startup && startup.libraryId === rt.libraryId) {
    const d = await rt.store.documents.get(startup.docId as DocumentId).catch(() => null);
    if (d && !d.missing) unclean = { docId: d.id, title: d.title, page: startup.page ?? d.study.lastPage ?? null };
  }
  // Shown once: a later call (the search menu) does not repeat it.
  startup = null;
  return { last: docs[0] ? row(docs[0]) : null, recent: docs.slice(1, 4).map(row), unclean };
}

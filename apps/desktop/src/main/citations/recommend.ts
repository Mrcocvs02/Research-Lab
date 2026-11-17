import { AppError, WATCH_FILE_LIMITS, type CitationLink, type DocumentId } from '@rl/core';
import { findOwned, linkKey } from '@rl/citations';
import type { MainServices } from '../ipc/handlers/services.js';
import type { DomainHandlers } from '../ipc/types.js';
import { ownedIndex, updateWatch, type Res } from './context.js';

const CITING_SHOWN = 20;

interface Entry {
  link: CitationLink;
  citing: string[];
  inScope: string[];
}

/** Richer links first: the one that has a title is what is shown. */
const better = (a: CitationLink, b: CitationLink) => !a.title && Boolean(b.title);

/** "Read next": works cited by at least `minCiting` library documents (of the scope) and not in the library; offline, from the stored citation files. */
export async function readNext(s: MainServices, req: { limit: number; minCiting: number; projectId?: string | undefined; folder?: string | undefined }): Res<DomainHandlers<'recommend'>['recommend:readNext']> {
  const rt = await s.runtime.require();
  const store = rt.store;
  const existing = new Set(await store.documents.listIds());
  let scope: Set<string> | null = null;
  if (req.projectId) {
    const p = await store.projects.get(req.projectId);
    if (!p) throw new AppError('NOT_FOUND', 'Unknown project');
    scope = new Set(p.members.map((m) => m.docId));
  } else if (req.folder) {
    const folder = req.folder.replace(/\/+$/, '');
    scope = new Set((await store.documents.list()).filter((d) => d.path === folder || d.path.startsWith(`${folder}/`)).map((d) => d.id));
  }
  const ix = await ownedIndex(rt);
  const dismissed = new Set((await store.readWatch()).dismissedRecommendations);
  const byKey = new Map<string, Entry>();
  let documentsWithCitations = 0;
  for (const file of await store.citations.list()) {
    if (!existing.has(file.docId) || file.references.length === 0) continue;
    const inScope = scope === null || scope.has(file.docId);
    if (inScope) documentsWithCitations++;
    for (const link of file.references) {
      const key = linkKey(link);
      if (!key || dismissed.has(key) || findOwned(ix, link, file.docId)) continue;
      let e = byKey.get(key);
      if (!e) byKey.set(key, (e = { link, citing: [], inScope: [] }));
      else if (better(e.link, link)) e.link = link;
      if (!e.citing.includes(file.docId)) {
        e.citing.push(file.docId);
        if (inScope) e.inScope.push(file.docId);
      }
    }
  }
  const ranked = [...byKey.entries()]
    .filter(([, e]) => e.inScope.length >= req.minCiting)
    .sort(([ka, a], [kb, b]) => b.inScope.length - a.inScope.length || b.citing.length - a.citing.length || (b.link.year ?? 0) - (a.link.year ?? 0) || (ka < kb ? -1 : 1))
    .slice(0, req.limit);
  const titles = new Map<string, string | null>();
  const need = [...new Set(ranked.flatMap(([, e]) => [...e.inScope, ...e.citing].slice(0, CITING_SHOWN)))];
  for (let i = 0; i < need.length; i += 32) {
    await Promise.all(need.slice(i, i + 32).map(async (id) => void titles.set(id, (await store.documents.get(id as DocumentId).catch(() => null))?.title ?? null)));
  }
  return {
    documentsWithCitations,
    items: ranked.map(([key, e]) => {
      const { matchedDocId: _m, checkedAt: _c, ...work } = e.link;
      const shown = [...new Set([...e.inScope, ...e.citing])].slice(0, CITING_SHOWN);
      return { key, work, citing: shown.map((id) => ({ docId: id as DocumentId, title: titles.get(id) ?? null })), citingCount: e.citing.length, score: e.inScope.length };
    }),
  };
}

export async function dismissRecommendation(s: MainServices, key: string): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  await updateWatch(rt, (w) => {
    if (!w.dismissedRecommendations.includes(key)) w.dismissedRecommendations = [...w.dismissedRecommendations, key].slice(-WATCH_FILE_LIMITS.dismissedRecommendations);
  });
  return { ok: true };
}

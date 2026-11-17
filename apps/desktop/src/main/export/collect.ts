import { AppError, EXPORT_LIMITS, type DocumentId, type DocumentRecord, type ExportSelection, type LibraryConfig, type Project } from '@rl/core';
import { inEnabledFolder } from '@rl/ai';
import type { GraphModel } from '@rl/graph';
import { loadModel } from '../graph/service.js';
import { loadView, type LibraryView } from '../graph/view.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';

export interface Collected {
  config: LibraryConfig;
  /** Selected documents (cited works included), by id. */
  docs: DocumentRecord[];
  direct: number;
  citedAdded: number;
  project: Project | null;
  /** Selected documents in folders not enabled for the AI. */
  aiDisabled: number;
  missingFiles: number;
  view: LibraryView;
  /** The graph model when one was built (cluster concepts); null otherwise. */
  model: { m: GraphModel; index: Map<string, number> } | null;
}

const inFolder = (relPath: string, folder: string) => folder.replace(/\/+$/, '') === '' || inEnabledFolder(relPath, [folder]);

/**
 * The documents an export selection stands for: the union of a project, folders, tags, clusters and documents, plus the
 * works they cite up to `citedDepth` steps (matched library documents only). Documents in excluded folders never enter.
 */
export async function collect(s: MainServices, rt: LibraryRuntime, sel: ExportSelection): Promise<Collected> {
  const [config, all, view] = await Promise.all([rt.store.readConfig(), rt.store.documents.list(), loadView(rt)]);
  const excluded = config.excludedFolders.filter((f) => f.replace(/\/+$/, '') !== '');
  const usable = all.filter((r) => !excluded.some((f) => inFolder(r.path, f)));
  const byId = new Map(usable.map((r) => [r.id as string, r]));
  const picked = new Set<string>();

  let project: Project | null = null;
  if (sel.projectId !== undefined) {
    project = await rt.store.projects.get(sel.projectId).catch(() => null);
    if (!project) throw new AppError('NOT_FOUND', 'Unknown project');
    for (const m of project.members) if (byId.has(m.docId)) picked.add(m.docId);
  }
  for (const f of sel.folders) for (const r of usable) if (inFolder(r.path, f)) picked.add(r.id);
  for (const tag of sel.tagIds) {
    const family = view.tagFamily(tag);
    if (!family) throw new AppError('NOT_FOUND', 'Unknown tag');
    for (const r of usable) if (view.tagsOf(r).some((t) => family.has(t))) picked.add(r.id);
  }
  const lm = await loadModel(s, rt);
  const model = lm ? { m: lm.model, index: lm.index } : null;
  if (sel.clusterIds.length > 0) {
    if (!model) throw new AppError('NOT_FOUND', 'The graph has not been built yet', { reason: 'no-model' });
    const wanted = new Set<number>();
    for (const id of sel.clusterIds) {
      const c = model.m.clusters.findIndex((x) => x.id === id);
      if (c < 0) throw new AppError('NOT_FOUND', 'Unknown cluster');
      wanted.add(c);
    }
    model.m.ids.forEach((docId, i) => {
      if (byId.has(docId) && (model.m.cl[i] as number[]).some((c) => wanted.has(c))) picked.add(docId);
    });
  }
  for (const id of sel.docIds) {
    if (!byId.has(id)) throw new AppError('NOT_FOUND', 'Unknown document');
    picked.add(id);
  }
  const direct = picked.size;
  if (direct > EXPORT_LIMITS.documents) throw new AppError('INVALID_REQUEST', `Too many documents (${direct}, at most ${EXPORT_LIMITS.documents})`, { reason: 'too-many' });

  // Cited works of the library, breadth first, up to the depth and the cap.
  if (sel.includeCited && sel.citedDepth > 0) {
    let frontier = [...picked];
    for (let depth = 0; depth < sel.citedDepth && frontier.length > 0 && picked.size < EXPORT_LIMITS.documents; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const file = await rt.store.citations.get(id as DocumentId).catch(() => null);
        for (const l of file?.references ?? []) {
          const m = l.matchedDocId;
          if (!m || picked.has(m) || !byId.has(m) || picked.size >= EXPORT_LIMITS.documents) continue;
          picked.add(m);
          next.push(m);
        }
      }
      frontier = next;
    }
  }
  const docs = [...picked].sort().map((id) => byId.get(id) as DocumentRecord);
  return {
    config,
    docs,
    direct,
    citedAdded: docs.length - direct,
    project,
    aiDisabled: docs.filter((d) => !inEnabledFolder(d.path, config.aiEnabledFolders)).length,
    missingFiles: docs.filter((d) => d.missing).length,
    view,
    model,
  };
}

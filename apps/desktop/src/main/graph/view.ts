import { AppError, type DocumentRecord, type TaxonomyFile } from '@rl/core';
import { createExploreIndex, type AuthorAliases, type ExploreIndex } from '@rl/graph';
import { documentsKey } from '../citations/context.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { makeTaxonomyLookup, type TaxonomyLookup } from '../library/indexable.js';
import { folderOfPath } from './inputs.js';

/** The documents of the active library as the graph handlers read them, rebuilt only when a document changed. */
export interface LibraryView {
  key: string;
  /** Present documents (not `missing`). */
  records: DocumentRecord[];
  byId: Map<string, DocumentRecord>;
  tax: TaxonomyFile | null;
  lookup: TaxonomyLookup;
  /** Tags of a record with what they imply (memoised). */
  tagsOf(rec: DocumentRecord): string[];
  /** Tag ids that count as `tagId`: itself and every descendant (by `parents`). */
  tagFamily(tagId: string): Set<string> | null;
  /** Documents that carry a tag (implied tags included); counted once per view. */
  tagCount(tag: string): number;
  folders(): Map<string, { direct: number; total: number }>;
  /** Explore's index; `aliasKey` names the author corrections it was built with (a new key builds a new index). */
  explore(aliases?: AuthorAliases, aliasKey?: string): ExploreIndex;
}

const views = new WeakMap<object, LibraryView>();

export const titleOf = (rec: Pick<DocumentRecord, 'title' | 'path'>): string => rec.title?.trim() || rec.path.slice(rec.path.lastIndexOf('/') + 1);

export async function loadView(rt: LibraryRuntime): Promise<LibraryView> {
  const key = documentsKey(rt);
  const hit = views.get(rt);
  if (hit && hit.key === key) return hit;
  const [all, tax] = await Promise.all([rt.store.documents.list(), rt.store.readTaxonomy().catch((): TaxonomyFile | null => null)]);
  const records = all.filter((r) => !r.missing);
  const lookup = makeTaxonomyLookup(tax);
  const tagMemo = new Map<string, string[]>();
  let tagCounts: Map<string, number> | undefined;
  let folderMap: ReturnType<LibraryView['folders']> | undefined;
  let exploreIndex: { key: string; index: ExploreIndex } | undefined;
  const view: LibraryView = {
    key,
    records,
    byId: new Map(records.map((r) => [r.id, r])),
    tax,
    lookup,
    tagsOf(rec) {
      let t = tagMemo.get(rec.id);
      if (!t) tagMemo.set(rec.id, (t = lookup.expandTags(rec.tags)));
      return t;
    },
    tagCount(tag) {
      if (!tagCounts) {
        tagCounts = new Map();
        for (const r of records) for (const t of new Set(view.tagsOf(r))) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
      return tagCounts.get(tag) ?? 0;
    },
    tagFamily(tagId) {
      const nodes = tax?.nodes ?? [];
      if (!nodes.some((n) => n.id === tagId)) return null;
      const kids = new Map<string, string[]>();
      for (const n of nodes) for (const p of n.parents) (kids.get(p) ?? kids.set(p, []).get(p))!.push(n.id);
      const out = new Set<string>([tagId]);
      const stack = [tagId];
      while (stack.length > 0) for (const c of kids.get(stack.pop() as string) ?? []) if (!out.has(c)) (out.add(c), stack.push(c));
      return out;
    },
    folders() {
      if (!folderMap) {
        folderMap = new Map();
        const bump = (f: string, direct: boolean) => {
          const e = folderMap!.get(f) ?? { direct: 0, total: 0 };
          e.total++;
          if (direct) e.direct++;
          folderMap!.set(f, e);
        };
        for (const r of records) {
          let f = folderOfPath(r.path);
          bump(f, true);
          while (f !== '') bump((f = folderOfPath(f)), false);
        }
      }
      return folderMap;
    },
    explore(aliases, aliasKey = '') {
      if (exploreIndex?.key !== aliasKey)
        exploreIndex = {
          key: aliasKey,
          index: createExploreIndex(
            records.map((r) => ({ id: r.id, title: titleOf(r), year: r.year, authors: r.authors, venue: r.ref.venue, venueId: r.ref.venueId, tags: tagsOfMemo(r) })),
            { nodes: tax?.nodes ?? [], venues: tax?.venues ?? [] },
            aliases,
          ),
        };
      return exploreIndex.index;
    },
  };
  const tagsOfMemo = (r: DocumentRecord) => view.tagsOf(r);
  views.set(rt, view);
  return view;
}

/** Documents of a scope (a folder, a project, a tag and what is under it), or null for the whole library. */
export async function scopeIds(rt: LibraryRuntime, view: LibraryView, scope: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined): Promise<Set<string> | null> {
  if (!scope || (scope.folder === undefined && scope.projectId === undefined && scope.tagId === undefined)) return null;
  let ids: Set<string> | null = null;
  const narrow = (next: Set<string>) => {
    ids = ids ? new Set([...ids].filter((i) => next.has(i))) : next;
  };
  if (scope.folder !== undefined) {
    const f = scope.folder.replace(/\/+$/, '');
    narrow(new Set(view.records.filter((r) => f === '' || r.path.startsWith(`${f}/`)).map((r) => r.id)));
  }
  if (scope.projectId !== undefined) {
    const project = await rt.store.projects.get(scope.projectId).catch(() => null);
    if (!project) throw new AppError('NOT_FOUND', 'Unknown project');
    narrow(new Set(project.members.map((m) => m.docId as string)));
  }
  if (scope.tagId !== undefined) {
    const family = view.tagFamily(scope.tagId);
    if (!family) throw new AppError('NOT_FOUND', 'Unknown tag');
    narrow(new Set(view.records.filter((r) => view.tagsOf(r).some((t) => family.has(t))).map((r) => r.id)));
  }
  return ids;
}

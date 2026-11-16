import { AppError } from '@rl/core';
import { emitEvent } from './mockRl';

type Handler = (payload: any) => unknown;

export interface FakeDoc {
  docId: string;
  title: string | null;
  authors: string[];
  year: number | null;
  type: string | null;
  venue?: string | null;
  path: string;
  studyState: 'to-read' | 'reading' | 'read';
  tags: string[];
  addedAt: string;
  size?: number;
  missing?: boolean;
  revision?: number;
  userDescription?: string;
  doi?: string | null;
  arxivId?: string | null;
  underlined?: boolean;
  underlinedOrigin?: 'annotations' | 'manual';
  extracted?: Record<string, unknown>;
  ai?: Record<string, unknown>;
}

export interface FakeNode {
  id: string;
  label: string;
  parents: string[];
  aliases: string[];
  implies: string[];
  status: 'active' | 'candidate' | 'deprecated';
  origin: 'user' | 'ai' | 'import';
  color?: string;
}

interface FakeProject {
  id: string;
  kind: 'project' | 'collection';
  name: string;
  description: string;
  notes: string;
  status: 'active' | 'paused' | 'done' | 'archived';
  archivedFrom?: string;
  revision: number;
  members: Array<{ docId: string; addedAt: string }>;
  plan: Array<{ docId: string; order: number }>;
}

export interface FakeAnnotation {
  id: string;
  kind: 'highlight' | 'underline';
  page: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  text: string;
  color: string;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

const NOW = '2026-01-01T00:00:00.000Z';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function makeDocs(n: number): FakeDoc[] {
  return Array.from({ length: n }, (_, i) => ({
    docId: `d${String(i).padStart(15, '0')}`,
    title: `Paper ${String(i).padStart(4, '0')}`,
    authors: [`Author ${i % 7}`],
    year: 2000 + (i % 25),
    type: 'article',
    path: `${['alpha', 'beta/inner', 'gamma'][i % 3]}/paper-${i}.pdf`,
    studyState: (['to-read', 'reading', 'read'] as const)[i % 3]!,
    tags: [],
    addedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    size: 1000 + ((i * 7919) % 5000) * 37,
  }));
}

/**
 * A small in-memory main process for the component tests: documents, taxonomy with operations, history with
 * undo and redo, projects. It answers the channel shapes of the contracts; it is not a second implementation of
 * the backend (no validation beyond what the views rely on).
 */
export function memoryLibrary(init: { docs?: FakeDoc[]; nodes?: FakeNode[]; projects?: FakeProject[] } = {}) {
  const state = {
    docs: init.docs ?? makeDocs(6),
    nodes: init.nodes ?? ([] as FakeNode[]),
    projects: init.projects ?? ([] as FakeProject[]),
    taxRevision: 1,
    /** Notes by `docId` and page (`0` is the note of the whole file). */
    notes: new Map<string, { body: string; createdAt: string; updatedAt: string }>(),
    /** Annotations by `docId`. */
    annotations: new Map<string, FakeAnnotation[]>(),
    /** Documents whose annotations are reported as made on another version of the file. */
    stale: new Set<string>(),
    /** Annotations saved again after the file changed (re-confirmed): no longer stale. */
    fresh: new Set<string>(),
    /** Thumbnails the (fake) operating system can give, by `docId`; the others fall back to drawing. */
    nativeThumbs: new Map<string, string>(),
    /** Thumbnail URLs stored by `thumbs:put`, by `docId`. */
    thumbs: new Map<string, string>(),
    /** Documents `reader:open` refuses, with the reason (`details.reason`). */
    readerRefusal: new Map<string, string>(),
    /** Fields added to the search hit of a document (`field`, `page`, `snippet`). */
    hitExtra: new Map<string, Record<string, unknown>>(),
    clock: 0,
    history: [] as Array<{ id: string; summary: string; action: string; undone: boolean; dead?: boolean; undo(): void; redo(): void }>,
    nextId: 1,
  };
  const snapshot = () => structuredClone({ docs: state.docs, nodes: state.nodes, projects: state.projects });
  const restore = (s: ReturnType<typeof snapshot>) => {
    state.docs = s.docs;
    state.nodes = s.nodes;
    state.projects = s.projects;
  };
  /** Runs a mutation and records it as an undoable change. */
  const change = <T>(action: string, summary: string, kind: 'documents' | 'taxonomy' | 'projects', fn: () => T, ids?: string[]): T & { changeId: string } => {
    // A new change ends the redo line: what was undone before can no longer be redone.
    for (const h of state.history) if (h.undone) h.dead = true;
    const before = snapshot();
    const result = fn();
    const after = snapshot();
    const id = `c${state.nextId++}`;
    state.history.unshift({ id, summary, action, undone: false, undo: () => restore(structuredClone(before)), redo: () => restore(structuredClone(after)) });
    emitEvent('library:changed', ids ? { kind, ids } : { kind });
    return { ...(result as object), changeId: id } as T & { changeId: string };
  };

  const tagsWithImplied = (d: FakeDoc) => {
    const out = new Set<string>();
    const stack = [...d.tags];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const n of state.nodes.find((x) => x.id === id)?.implies ?? []) stack.push(n);
    }
    return [...out];
  };
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of state.nodes) if (!out.has(n.id) && n.parents.some((p) => out.has(p))) (out.add(n.id), (grew = true));
    }
    return out;
  };
  const summary = (d: FakeDoc) => ({
    docId: d.docId,
    title: d.title,
    authors: d.authors,
    year: d.year,
    type: d.type,
    venue: d.venue ?? null,
    path: d.path,
    studyState: d.studyState,
    tags: tagsWithImplied(d),
    directTags: [...d.tags],
    addedAt: d.addedAt,
    missing: Boolean(d.missing),
    size: d.size ?? 1234,
  });
  const matches = (d: FakeDoc, text: string, f: any = {}) => {
    const t = (text ?? '').trim().toLowerCase();
    if (t && !`${d.title} ${d.authors.join(' ')}`.toLowerCase().includes(t)) return false;
    if (d.missing && !f.includeMissing) return false;
    const has = (tag: string) => tagsWithImplied(d).some((x) => descendantsOf(tag).has(x));
    for (const tag of f.tags ?? []) if (!has(tag)) return false;
    if (f.tagsAny?.length && !f.tagsAny.some(has)) return false;
    if (f.tagsExclude?.some(has)) return false;
    const dir = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : '';
    const inside = (p: string) => dir === p || dir.startsWith(`${p}/`);
    if (f.folders?.length && !f.folders.some(inside)) return false;
    if (f.folder !== undefined && f.folder !== '' && !(f.includeSubfolders === false ? dir === f.folder : inside(f.folder))) return false;
    if (f.folder === '' && f.includeSubfolders === false && dir !== '') return false;
    if (f.studyStates?.length && !f.studyStates.includes(d.studyState)) return false;
    if (f.authors?.length && !f.authors.every((a: string) => d.authors.includes(a))) return false;
    if (f.yearFrom && (d.year ?? 0) < f.yearFrom) return false;
    if (f.yearTo && (d.year ?? 9999) > f.yearTo) return false;
    return true;
  };
  const sorted = (docs: FakeDoc[], sort: string) =>
    [...docs].sort((a, b) => {
      if (sort === 'year-desc') return (b.year ?? 0) - (a.year ?? 0);
      if (sort === 'year-asc') return (a.year ?? 0) - (b.year ?? 0);
      if (sort === 'added-desc') return b.addedAt.localeCompare(a.addedAt);
      if (sort === 'size-desc') return (b.size ?? 1234) - (a.size ?? 1234);
      if (sort === 'size-asc') return (a.size ?? 1234) - (b.size ?? 1234);
      if (sort === 'author') return (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '');
      return (a.title ?? '').localeCompare(b.title ?? '');
    });
  const bucket = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].map(([value, count]) => ({ value, count }));
  };
  const facets = (docs: FakeDoc[]) => ({
    total: docs.length,
    tags: [],
    authors: bucket(docs.flatMap((d) => d.authors)),
    types: bucket(docs.map((d) => d.type ?? '').filter(Boolean)),
    venues: [],
    studyStates: bucket(docs.map((d) => d.studyState)),
    years: bucket(docs.filter((d) => d.year).map((d) => String(d.year))),
    folders: [],
  });
  const hit = (d: FakeDoc) => ({ docId: d.docId, title: d.title, authors: d.authors, year: d.year, type: d.type, path: d.path, studyState: d.studyState, score: 1, field: 'title', snippet: d.title ?? '', ...(state.hitExtra.get(d.docId) ?? {}), size: d.size ?? 1234, tags: tagsWithImplied(d), directTags: [...d.tags] });

  const counts = (n: FakeNode) => {
    const direct = state.docs.filter((d) => d.tags.includes(n.id)).length;
    const implied = state.docs.filter((d) => tagsWithImplied(d).includes(n.id)).length;
    const below = descendantsOf(n.id);
    const subtree = state.docs.filter((d) => tagsWithImplied(d).some((t) => below.has(t))).length;
    return { direct, implied, subtree };
  };
  const taxonomy = () => ({ revision: state.taxRevision, nodes: state.nodes.map((n) => ({ ...n, counts: counts(n) })), documentTypes: [{ id: 'article', label: 'Article', aliases: [] }], venues: [] });

  const folderTree = () => {
    const paths = new Map<string, { direct: number; total: number }>();
    let rootDirect = 0;
    for (const d of state.docs) {
      const parts = d.path.split('/').slice(0, -1);
      if (parts.length === 0) rootDirect++;
      parts.forEach((_, i) => {
        const p = parts.slice(0, i + 1).join('/');
        const e = paths.get(p) ?? { direct: 0, total: 0 };
        e.total++;
        if (i === parts.length - 1) e.direct++;
        paths.set(p, e);
      });
    }
    const folders = [...paths.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([path, c]) => ({ path, name: path.split('/').pop()!, parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null, depth: path.split('/').length, ...c }));
    return { rootDirect, total: state.docs.length, folders };
  };

  const record = (d: FakeDoc) => ({
    schemaVersion: 1,
    id: d.docId,
    hash: 'a'.repeat(64),
    path: d.path,
    revision: d.revision ?? 0,
    size: 1234,
    mtimeMs: 0,
    missing: Boolean(d.missing),
    type: d.type,
    title: d.title,
    authors: d.authors,
    year: d.year,
    lang: null,
    ref: { venue: d.venue ?? undefined },
    doi: d.doi ?? null,
    arxivId: d.arxivId ?? null,
    userDescription: d.userDescription,
    tags: d.tags,
    study: { state: d.studyState, underlined: { value: Boolean(d.underlined), origin: d.underlinedOrigin ?? 'manual' } },
    ai: d.ai ?? {},
    addedAt: d.addedAt,
    updatedAt: d.addedAt,
    extracted: d.extracted,
  });

  const projectDetail = (p: FakeProject) => {
    const doc = (id: string) => state.docs.find((d) => d.docId === id);
    const count = (s: string) => p.members.filter((m) => doc(m.docId)?.studyState === s).length;
    return {
      project: {
        id: p.id, kind: p.kind, name: p.name, description: p.description, status: p.status, revision: p.revision, createdAt: NOW, updatedAt: NOW,
        counts: { total: p.members.length, toRead: count('to-read'), reading: count('reading'), read: count('read'), missing: 0 },
        notes: p.notes, archivedFrom: p.archivedFrom,
      },
      members: p.members.map((m) => {
        const d = doc(m.docId);
        return { docId: m.docId, addedAt: m.addedAt, known: Boolean(d), missing: false, title: d?.title ?? null, authors: d?.authors ?? [], year: d?.year ?? null, path: d?.path ?? null, studyState: d?.studyState ?? null };
      }),
      readingPlan: [...p.plan].sort((a, b) => a.order - b.order).map((it) => ({ ...it, status: doc(it.docId)?.studyState ?? 'to-read', studyState: doc(it.docId)?.studyState ?? null, title: doc(it.docId)?.title ?? null, missing: false })),
    };
  };
  const project = (id: string) => {
    const p = state.projects.find((x) => x.id === id);
    if (!p) throw new AppError('NOT_FOUND', 'project');
    return p;
  };
  const projectChange = <T>(summary: string, fn: () => T) => change('project.update', summary, 'projects', fn);

  /** The "underlined" flag follows the annotations unless the user set it to true by hand (and that is kept). */
  const underlinedAfterAnnotations = (docId: string) => {
    const d = state.docs.find((x) => x.docId === docId);
    if (d && !(d.underlined && d.underlinedOrigin === 'manual')) {
      d.underlined = (state.annotations.get(docId) ?? []).length > 0;
      d.underlinedOrigin = 'annotations';
    }
    return { value: Boolean(d?.underlined), origin: d?.underlinedOrigin ?? 'manual' };
  };

  const handlers: Record<string, Handler> = {
    'scan:status': () => ({ libraryId: 'lib-a', state: 'done', seen: state.docs.length, processed: 0, indexed: state.docs.length }),
    'scan:start': () => ({ libraryId: 'lib-a', state: 'done', seen: state.docs.length, processed: 0, indexed: state.docs.length }),
    'library:tree': folderTree,
    'documents:list': (p) => {
      const all = sorted(state.docs.filter((d) => matches(d, '', p.filters)), p.sort ?? 'title');
      return { total: all.length, items: all.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 50)).map(summary) };
    },
    'documents:ids': (p) => {
      const rows = sorted(state.docs.filter((d) => matches(d, p.text ?? '', p.filters)), !p.sort || p.sort === 'relevance' ? 'title' : p.sort);
      return { total: rows.length, ids: rows.slice(0, p.limit ?? 50_000).map((d) => d.docId) };
    },
    'documents:get': (p) => {
      const d = state.docs.find((x) => x.docId === p.docId);
      if (!d) throw new AppError('NOT_FOUND', 'doc');
      return record(d);
    },
    'documents:update': (p) => {
      const d = state.docs.find((x) => x.docId === p.docId);
      if (!d) throw new AppError('NOT_FOUND', 'doc');
      if (p.expectedRevision !== undefined && p.expectedRevision !== (d.revision ?? 0)) throw new AppError('CONFLICT', 'revision');
      const out = change('document.fields', 'Document fields changed', 'documents', () => {
        const patch = p.patch;
        if ('title' in patch) d.title = patch.title;
        if ('authors' in patch) d.authors = patch.authors;
        if ('year' in patch) d.year = patch.year;
        if ('type' in patch) d.type = patch.type;
        if ('venue' in patch) d.venue = patch.venue;
        if ('doi' in patch) d.doi = patch.doi;
        if ('arxivId' in patch) d.arxivId = patch.arxivId;
        if ('userDescription' in patch) d.userDescription = patch.userDescription;
        if ('studyState' in patch) d.studyState = patch.studyState;
        if ('underlined' in patch) (d.underlined = patch.underlined, (d.underlinedOrigin = 'manual'));
        d.revision = (d.revision ?? 0) + 1;
        return { document: record(d) };
      }, [d.docId]);
      // Projects that hold the document follow its study state.
      const involved = state.projects.filter((x) => x.members.some((m) => m.docId === d.docId)).map((x) => x.id);
      if (involved.length > 0) emitEvent('library:changed', { kind: 'projects', ids: involved });
      return out;
    },
    'documents:tag': (p) => {
      let changed = 0;
      const out = change('tags.update', 'Tags changed', 'documents', () => {
        for (const id of p.docIds) {
          const d = state.docs.find((x) => x.docId === id);
          if (!d) throw new AppError('NOT_FOUND', 'doc');
          const next = new Set(d.tags);
          for (const t of p.add ?? []) next.add(t);
          for (const t of p.remove ?? []) next.delete(t);
          if (next.size !== d.tags.length || [...next].some((t) => !d.tags.includes(t))) changed++;
          d.tags = [...next];
        }
        return { changed, unchanged: p.docIds.length - changed };
      });
      return out;
    },
    'reader:open': (p) => {
      const d = state.docs.find((x) => x.docId === p.docId);
      if (!d) throw new AppError('NOT_FOUND', 'doc');
      const reason = state.readerRefusal.get(d.docId) ?? (d.missing ? 'missing' : /\.pdf$/i.test(d.path) ? null : 'not-pdf');
      if (reason) throw new AppError('PERMISSION_DENIED', 'refused', { reason });
      return { url: `rl-doc://doc/${d.docId}?v=aaaaaaaa`, hash: 'a'.repeat(64), title: d.title };
    },
    'thumbs:list': (p) => ({
      items: (p.docIds as string[]).map((id) => {
        const d = state.docs.find((x) => x.docId === id);
        if (!d || d.missing || !/\.pdf$/i.test(d.path)) return { docId: id, url: null, drawable: false };
        const url = state.thumbs.get(id) ?? null;
        return { docId: id, url, drawable: url === null, hash: 'a'.repeat(64) };
      }),
    }),
    'thumbs:native': (p) => {
      const url = state.nativeThumbs.get(p.docId) ?? null;
      if (url) state.thumbs.set(p.docId, url);
      return { url, reason: url ? 'ok' : 'unsupported' };
    },
    'thumbs:put': (p) => {
      const url = `rl-thumb://thumb/${p.docId}?v=${String(p.hash).slice(0, 8)}`;
      state.thumbs.set(p.docId, url);
      return { url };
    },
    'reader:openLink': () => ({ ok: true }),
    'notes:get': (p) => {
      const n = state.notes.get(`${p.docId}|${p.page ?? 0}`);
      return { note: n ? { docId: p.docId, ...(p.page ? { page: p.page } : {}), ...n } : null };
    },
    'notes:list': (p) => ({
      items: [...state.notes.entries()]
        .filter(([k]) => k.startsWith(`${p.docId}|`))
        .map(([k, n]) => ({ page: Number(k.split('|')[1]) || null, updatedAt: n.updatedAt, excerpt: n.body.slice(0, 200) }))
        .sort((a, b) => (a.page ?? 0) - (b.page ?? 0)),
    }),
    'notes:save': (p) => {
      const key = `${p.docId}|${p.page ?? 0}`;
      const cur = state.notes.get(key);
      if ((cur?.updatedAt ?? null) !== p.expectedUpdatedAt) throw new AppError('CONFLICT', 'note changed');
      let note: ReturnType<typeof state.notes.get> | null = null;
      if (p.body.trim() === '') state.notes.delete(key);
      else {
        const at = new Date(Date.parse(NOW) + ++state.clock * 1000).toISOString();
        note = { body: p.body, createdAt: cur?.createdAt ?? at, updatedAt: at };
        state.notes.set(key, note);
      }
      emitEvent('library:changed', { kind: 'notes', ids: [p.docId] });
      return { note: note ? { docId: p.docId, ...(p.page ? { page: p.page } : {}), ...note } : null };
    },
    'annotations:list': (p) => {
      const all = state.annotations.get(p.docId) ?? [];
      const staleIds = state.stale.has(p.docId) ? all.filter((a) => !state.fresh.has(a.id)).map((a) => a.id) : [];
      return { annotations: structuredClone(all), stale: staleIds.length > 0, staleIds };
    },
    'annotations:save': (p) => {
      const list = state.annotations.get(p.docId) ?? [];
      const a = p.annotation;
      const at = new Date(Date.parse(NOW) + ++state.clock * 1000).toISOString();
      const prev = a.id ? list.find((x) => x.id === a.id) : undefined;
      if (a.id && !prev) throw new AppError('NOT_FOUND', 'annotation');
      const saved: FakeAnnotation = {
        id: a.id ?? `an${state.nextId++}`,
        kind: a.kind,
        page: a.page,
        rects: a.rects,
        text: a.text ?? '',
        color: a.color ?? 'yellow',
        ...(a.comment ? { comment: a.comment } : {}),
        createdAt: prev?.createdAt ?? at,
        updatedAt: at,
      };
      state.fresh.add(saved.id);
      state.annotations.set(p.docId, prev ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved]);
      const underlined = underlinedAfterAnnotations(p.docId);
      emitEvent('library:changed', { kind: 'annotations', ids: [p.docId] });
      return { annotation: structuredClone(saved), underlined };
    },
    'annotations:remove': (p) => {
      const list = state.annotations.get(p.docId) ?? [];
      const removed = list.some((x) => x.id === p.id);
      state.annotations.set(p.docId, list.filter((x) => x.id !== p.id));
      const underlined = underlinedAfterAnnotations(p.docId);
      emitEvent('library:changed', { kind: 'annotations', ids: [p.docId] });
      return { removed, underlined };
    },
    'documents:open': () => ({ ok: true }),
    'documents:reveal': () => ({ ok: true }),
    'search:run': (p) => {
      const all = state.docs.filter((d) => matches(d, p.text, p.filters));
      const rows = sorted(all, p.sort === 'relevance' ? 'title' : p.sort);
      return { total: rows.length, hits: rows.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 25)).map(hit), tookMs: 1, facets: facets(all) };
    },
    'search:query': (p) => {
      const rows = sorted(state.docs.filter((d) => matches(d, p.text, p.filters)), p.sort === 'relevance' ? 'title' : p.sort);
      return { total: rows.length, hits: rows.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 25)).map(hit), tookMs: 1 };
    },
    'search:facets': (p) => facets(state.docs.filter((d) => matches(d, p.text, p.filters))),
    'taxonomy:get': taxonomy,
    'taxonomy:apply': (p) => {
      if (p.expectedRevision !== undefined && p.expectedRevision !== state.taxRevision) throw new AppError('CONFLICT', 'revision', { conflict: 'revision' });
      const created: Array<{ index: number; id: string }> = [];
      let documentsChanged = 0;
      const out = change('taxonomy.update', 'Taxonomy changed', 'taxonomy', () => {
        p.ops.forEach((op: any, index: number) => {
          const node = (id: string) => {
            const n = state.nodes.find((x) => x.id === id);
            if (!n) throw new AppError('NOT_FOUND', id);
            return n;
          };
          switch (op.op) {
            case 'create': {
              const id = op.id ?? slug(op.label);
              if (state.nodes.some((n) => n.id === id)) throw new AppError('ALREADY_EXISTS', id);
              state.nodes.push({ id, label: op.label, parents: op.parents ?? [], aliases: op.aliases ?? [], implies: op.implies ?? [], status: 'active', origin: 'user', ...(op.color ? { color: op.color } : {}) });
              created.push({ index, id });
              break;
            }
            case 'rename':
              node(op.id).label = op.label;
              break;
            case 'move':
              if (op.parents.some((x: string) => descendantsOf(op.id).has(x))) throw new AppError('INVALID_REQUEST', 'cycle');
              node(op.id).parents = op.parents;
              break;
            case 'setAliases':
              node(op.id).aliases = op.aliases;
              break;
            case 'setImplies':
              node(op.id).implies = op.implies;
              break;
            case 'setColor': {
              const n = node(op.id);
              if (op.color === null) delete n.color;
              else n.color = op.color;
              break;
            }
            case 'deprecate':
              node(op.id).status = 'deprecated';
              break;
            case 'restore':
              node(op.id).status = 'active';
              break;
            case 'merge': {
              const from = node(op.from);
              const into = node(op.into);
              for (const d of state.docs) {
                if (d.tags.includes(from.id)) {
                  d.tags = [...new Set(d.tags.filter((t) => t !== from.id).concat(into.id))];
                  documentsChanged++;
                }
              }
              into.aliases = [...new Set([...into.aliases, from.label, ...from.aliases])];
              for (const n of state.nodes) n.parents = n.parents.map((x) => (x === from.id ? into.id : x));
              state.nodes = state.nodes.filter((n) => n.id !== from.id);
              break;
            }
            case 'delete': {
              const n = node(op.id);
              if (state.docs.some((d) => d.tags.includes(n.id))) throw new AppError('CONFLICT', 'in use', { conflict: 'in-use' });
              state.nodes = state.nodes.filter((x) => x.id !== n.id);
              break;
            }
            default:
              throw new AppError('INVALID_REQUEST', 'op');
          }
        });
        state.taxRevision++;
        return {};
      });
      return { taxonomy: taxonomy(), changeId: out.changeId, created, documentsChanged };
    },
    'history:list': () => ({
      items: state.history.map((h) => ({ changeId: h.id, at: NOW, deviceId: 'dev', actor: 'user', kind: 'change', action: h.action, summary: h.summary, counts: { documents: 1, taxonomy: 0, projects: 0 }, undoable: !h.undone, undone: h.undone, mine: true })),
      canUndo: state.history.some((h) => !h.undone),
      canRedo: state.history.some((h) => h.undone && !h.dead),
    }),
    'history:undo': (p) => {
      const h = p.changeId ? state.history.find((x) => x.id === p.changeId) : state.history.find((x) => !x.undone);
      if (!h || h.undone) throw new AppError('NOT_FOUND', 'nothing to undo');
      h.undo();
      h.undone = true;
      state.taxRevision++;
      emitEvent('library:changed', { kind: 'documents' });
      emitEvent('library:changed', { kind: 'taxonomy' });
      emitEvent('library:changed', { kind: 'projects' });
      return { target: h.id, changeId: `u${h.id}`, summary: h.summary, documentsChanged: 0 };
    },
    'history:redo': (p) => {
      const h = p.changeId ? state.history.find((x) => x.id === p.changeId) : state.history.find((x) => x.undone);
      if (!h || !h.undone) throw new AppError('NOT_FOUND', 'nothing to redo');
      h.redo();
      h.undone = false;
      emitEvent('library:changed', { kind: 'documents' });
      emitEvent('library:changed', { kind: 'taxonomy' });
      emitEvent('library:changed', { kind: 'projects' });
      return { target: h.id, changeId: `r${h.id}`, summary: h.summary, documentsChanged: 0 };
    },
    'projects:list': (p) => ({ items: state.projects.filter((x) => p.includeArchived || x.status !== 'archived').map((x) => projectDetail(x).project).map(({ notes: _n, archivedFrom: _a, ...rest }) => rest) }),
    'projects:get': (p) => projectDetail(project(p.id)),
    'projects:create': (p) => {
      const id = p.id ?? slug(p.name);
      const proj: FakeProject = { id, kind: p.kind ?? 'project', name: p.name, description: p.description ?? '', notes: p.notes ?? '', status: 'active', revision: 0, members: (p.docIds ?? []).map((docId: string) => ({ docId, addedAt: NOW })), plan: [] };
      projectChange('Project created', () => state.projects.push(proj));
      return projectDetail(proj);
    },
    'projects:update': (p) => {
      const proj = project(p.id);
      if (p.expectedRevision !== undefined && p.expectedRevision !== proj.revision) throw new AppError('CONFLICT', 'revision', { conflict: 'revision' });
      projectChange('Project changed', () => {
        Object.assign(proj, p.patch);
        proj.revision++;
      });
      return projectDetail(proj);
    },
    'projects:delete': (p) => {
      const proj = project(p.id);
      projectChange('Project archived', () => {
        proj.archivedFrom = proj.status;
        proj.status = 'archived';
        proj.revision++;
      });
      return projectDetail(proj);
    },
    'projects:restore': (p) => {
      const proj = project(p.id);
      projectChange('Project restored', () => {
        proj.status = (proj.archivedFrom as FakeProject['status']) ?? 'active';
        proj.revision++;
      });
      return projectDetail(proj);
    },
    'projects:addMembers': (p) => {
      const proj = project(p.projectId);
      projectChange('Members added', () => {
        for (const id of p.docIds) if (!proj.members.some((m) => m.docId === id)) proj.members.push({ docId: id, addedAt: NOW });
        proj.revision++;
      });
      return projectDetail(proj);
    },
    'projects:removeMembers': (p) => {
      const proj = project(p.projectId);
      projectChange('Members removed', () => {
        proj.members = proj.members.filter((m) => !p.docIds.includes(m.docId));
        proj.plan = proj.plan.filter((i) => !p.docIds.includes(i.docId));
        proj.revision++;
      });
      return projectDetail(proj);
    },
    'projects:setReadingPlan': (p) => {
      const proj = project(p.projectId);
      if (p.expectedRevision !== undefined && p.expectedRevision !== proj.revision) throw new AppError('CONFLICT', 'revision', { conflict: 'revision' });
      projectChange('Plan changed', () => {
        proj.plan = p.items;
        proj.revision++;
      });
      return projectDetail(proj);
    },
  };
  return { state, handlers };
}

import path from 'node:path';
import { EXPORT_LIMITS, isReservedWindowsName, type CitationLink, type DocumentId, type DocumentRecord, type ExportSelection } from '@rl/core';
import { resolveInRoot } from '@rl/core/node';
import {
  assignCitekeys,
  cardParts,
  cardPath,
  commandFiles,
  conceptParts,
  conceptPath,
  conceptSlugs,
  graphJson,
  guidePart,
  indexPart,
  layoutCard,
  layoutParts,
  mergeParts,
  notesReadme,
  sha256,
  type CardInput,
  type ExportManifest,
  type MarkedText,
  type Part,
  type WorkRef,
} from '@rl/export';
import { modelId } from '../graph/service.js';
import { readLabels } from '../graph/labels-store.js';
import { titleOf } from '../graph/view.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { Collected } from './collect.js';

/** A file the export wants in the folder; the sink decides what to do with it (write, or only count). */
export type FileSpec =
  | { kind: 'parts'; rel: string; parts: Part[]; layout: (p: readonly Part[]) => string }
  | { kind: 'whole'; rel: string; text: string }
  | { kind: 'once'; rel: string; text: string };

export type FileOutcome = 'new' | 'updated' | 'unchanged' | 'kept-edited';

export interface Sink {
  /** Writes (or only counts) one file of the export. */
  put(spec: FileSpec): Promise<FileOutcome>;
  /** A copy into `sources/`: bytes copied (0 when the file already was there or the original is missing). */
  copy(source: string, rel: string): Promise<number>;
}

export interface PipelineOptions {
  s: MainServices;
  rt: LibraryRuntime;
  c: Collected;
  selection: ExportSelection;
  manifest: ExportManifest | null;
  libraryName: string;
  signal?: AbortSignal | undefined;
  onProgress?: ((phase: 'collect' | 'write' | 'copy', done: number, total: number) => void) | undefined;
}

export interface PipelineOutput {
  /** Markdown characters generated (for the token estimate). */
  chars: number;
  indexTokens: number;
  files: number;
  copyBytes: number;
  citekeys: Record<string, string>;
  titles: Record<string, string>;
  orphaned: number;
  cancelled: boolean;
}

const LINKS_PER_CARD = 100;
const HIGHLIGHTS_PER_CARD = 200;
const MAX_CONCEPTS = 300;
const MAX_CLUSTER_CONCEPTS = 200;
const COPY_EXT = /^[a-z0-9]{1,8}$/;

const marked = (f: { value: string; review: { status: string } } | undefined): MarkedText | undefined =>
  !f || f.review.status === 'rejected' ? undefined : { text: f.value, ai: true, reviewed: f.review.status === 'accepted' || f.review.status === 'edited' };

const linkKey = (l: CitationLink) => (l.doi ? `doi:${l.doi.toLowerCase()}` : l.arxivId ? `arxiv:${l.arxivId.toLowerCase()}` : `t:${(l.title ?? '').toLowerCase().slice(0, 120)}|${l.year ?? ''}`);

/** Walks the export in a fixed order and hands every file to the sink. Reads the library, never writes it. */
export async function generate(o: PipelineOptions, sink: Sink): Promise<PipelineOutput> {
  const { c, rt, selection } = o;
  const lang = c.config.language;
  const progress = o.onProgress ?? (() => {});
  const cancelled = () => o.signal?.aborted === true;
  const docs = c.docs;
  const out: PipelineOutput = { chars: 0, indexTokens: 0, files: 0, copyBytes: 0, citekeys: {}, titles: {}, orphaned: 0, cancelled: false };

  /* ---------------- collect: citekeys, citations, concepts ---------------- */
  const citekeys = assignCitekeys(
    docs.map((d) => ({ id: d.id, authors: d.authors, year: d.year, title: d.title })),
    o.manifest?.citekeys ?? {},
  );
  out.citekeys = citekeys;
  const key = (d: DocumentRecord) => citekeys[d.id] as string;
  const selected = new Map(docs.map((d) => [d.id as string, d]));
  const titles: Record<string, string> = { ...(o.manifest?.titles ?? {}) };
  for (const d of docs) titles[d.id] = titleOf(d).slice(0, 300);
  out.titles = titles;

  const refsOf = new Map<string, CitationLink[]>();
  const citedByOf = new Map<string, CitationLink[]>();
  const reverse = new Map<string, Set<string>>();
  let loaded = 0;
  for (const d of docs) {
    if (cancelled()) return { ...out, cancelled: true };
    const file = await rt.store.citations.get(d.id as DocumentId).catch(() => null);
    refsOf.set(d.id, file?.references ?? []);
    citedByOf.set(d.id, file?.citedBy ?? []);
    for (const l of file?.references ?? []) {
      if (l.matchedDocId && selected.has(l.matchedDocId) && l.matchedDocId !== d.id) (reverse.get(l.matchedDocId) ?? reverse.set(l.matchedDocId, new Set()).get(l.matchedDocId)!).add(d.id);
    }
    if (++loaded % 200 === 0) progress('collect', loaded, docs.length);
  }
  const work = (l: CitationLink): WorkRef => {
    const m = l.matchedDocId ? selected.get(l.matchedDocId) : undefined;
    if (m) return { citekey: key(m), title: titleOf(m), ...(m.year !== null ? { year: m.year } : {}) };
    return { ...(l.title ? { title: l.title } : {}), ...(l.year !== undefined ? { year: l.year } : {}), ...(l.doi ? { doi: l.doi } : {}), authors: l.authors.slice(0, 2) };
  };
  const cites = (d: DocumentRecord): WorkRef[] => {
    const seen = new Set<string>();
    const list: WorkRef[] = [];
    for (const l of refsOf.get(d.id) ?? []) {
      if (l.matchedDocId === d.id) continue;
      const k = l.matchedDocId && selected.has(l.matchedDocId) ? `d:${l.matchedDocId}` : linkKey(l);
      if (seen.has(k) || (!l.title && !l.doi && !l.arxivId && !l.matchedDocId)) continue;
      seen.add(k);
      list.push(work(l));
    }
    return list.slice(0, LINKS_PER_CARD);
  };
  const citedBy = (d: DocumentRecord): WorkRef[] => {
    const seen = new Set<string>();
    const list: WorkRef[] = [];
    for (const id of reverse.get(d.id) ?? []) {
      seen.add(`d:${id}`);
      const m = selected.get(id) as DocumentRecord;
      list.push({ citekey: key(m), title: titleOf(m), ...(m.year !== null ? { year: m.year } : {}) });
    }
    for (const l of citedByOf.get(d.id) ?? []) {
      if (l.matchedDocId === d.id) continue;
      const k = l.matchedDocId && selected.has(l.matchedDocId) ? `d:${l.matchedDocId}` : linkKey(l);
      if (seen.has(k) || (!l.title && !l.doi && !l.arxivId && !l.matchedDocId)) continue;
      seen.add(k);
      list.push(work(l));
    }
    return list.slice(0, LINKS_PER_CARD);
  };

  // Concepts: taxonomy tags used by the selection, and clusters of the graph model.
  const lookup = c.view.lookup;
  const tagDocs = new Map<string, string[]>();
  for (const d of docs) for (const t of c.view.tagsOf(d)) (tagDocs.get(t) ?? tagDocs.set(t, []).get(t)!).push(d.id);
  const tagList = [...tagDocs.entries()]
    .flatMap(([id, ids]) => {
      const label = lookup.tagLabel(id);
      return label ? [{ id, label, ids }] : [];
    })
    .sort((a, b) => b.ids.length - a.ids.length || (a.label < b.label ? -1 : 1))
    .slice(0, MAX_CONCEPTS);

  interface ClusterInfo {
    idx: number;
    label: string;
    ai: boolean;
    level: number;
    parent: number;
    terms: string[];
    ids: string[];
  }
  const clusterList: ClusterInfo[] = [];
  if (c.model) {
    const { m, index } = c.model;
    const labels = await readLabels(o.s, rt, modelId(m)).catch(() => ({}) as Record<string, { text: string }>);
    const members = new Map<number, string[]>();
    for (const d of docs) {
      const i = index.get(d.id);
      if (i === undefined) continue;
      for (const k of m.cl[i] as number[]) (members.get(k) ?? members.set(k, []).get(k)!).push(d.id);
    }
    for (const [idx, ids] of members) {
      const mc = m.clusters[idx];
      if (!mc) continue;
      const ai = labels[mc.id]?.text;
      clusterList.push({ idx, label: ai ?? (mc.terms.slice(0, 3).join(', ') || mc.id), ai: Boolean(ai), level: mc.level, parent: mc.parent, terms: mc.terms.slice(0, 12), ids });
    }
    clusterList.sort((a, b) => a.level - b.level || b.ids.length - a.ids.length || (a.label < b.label ? -1 : 1));
    clusterList.splice(MAX_CLUSTER_CONCEPTS);
  }
  const slugList = conceptSlugs([...tagList.map((t) => ({ label: t.label })), ...clusterList.map((k) => ({ label: k.label, prefix: 'cluster-' }))]).map((sl) => (isReservedWindowsName(sl) ? `${sl}-topic` : sl));
  const tagSlug = new Map(tagList.map((t, i) => [t.id, slugList[i] as string]));
  const clusterSlug = new Map(clusterList.map((k, i) => [k.idx, slugList[tagList.length + i] as string]));
  const conceptsOfDoc = new Map<string, Array<{ slug: string; label: string }>>();
  const addConcept = (docId: string, slug: string, label: string) => {
    const l = conceptsOfDoc.get(docId) ?? [];
    if (l.length < 10) l.push({ slug, label });
    conceptsOfDoc.set(docId, l);
  };
  for (const d of docs) {
    for (const t of d.tags) {
      const sl = tagSlug.get(t);
      if (sl) addConcept(d.id, sl, lookup.tagLabel(t) as string);
    }
  }
  for (const k of clusterList) for (const id of k.ids) addConcept(id, clusterSlug.get(k.idx) as string, k.label);
  const paperLine = (id: string) => {
    const d = selected.get(id) as DocumentRecord;
    return { citekey: key(d), title: titleOf(d), year: d.year };
  };

  // INDEX input.
  const study = { toRead: 0, reading: 0, read: 0 };
  for (const d of docs) study[d.study.state === 'to-read' ? 'toRead' : d.study.state]++;
  const stateList = (st: string) => docs.filter((d) => d.study.state === st).map((d) => ({ citekey: key(d), title: titleOf(d) }));
  const readingOrder = (c.project?.readingPlan ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((it) => {
      const d = selected.get(it.docId);
      return d ? [{ citekey: key(d), title: titleOf(d), year: d.year, status: it.status ?? d.study.state }] : [];
    });
  const orphanIds = Object.keys(o.manifest?.citekeys ?? {}).filter((id) => !selected.has(id));
  out.orphaned = orphanIds.length;
  const idx = indexPart(
    {
      lang,
      name: o.libraryName,
      projectName: c.project?.name,
      papers: docs.length,
      concepts: tagList.length + clusterList.length,
      themes: tagList.map((t) => ({ slug: tagSlug.get(t.id) as string, label: t.label, count: t.ids.length })),
      clusters: clusterList.map((k) => ({ slug: clusterSlug.get(k.idx) as string, label: k.label, count: k.ids.length, ai: k.ai })),
      readingOrder,
      study,
      reading: stateList('reading'),
      toRead: stateList('to-read'),
      orphans: orphanIds.map((id) => ({ citekey: (o.manifest as ExportManifest).citekeys[id] as string, title: titles[id] ?? '' })),
    },
    EXPORT_LIMITS.indexTokens,
  );
  out.indexTokens = idx.tokens;

  /* ---------------- the files ---------------- */
  const commands = commandFiles(lang);
  const total = 2 + tagList.length + clusterList.length + commands.length + 1 + 1 + (selection.sources === 'paths' ? 1 : 0) + docs.length;
  let done = 0;
  const put = async (spec: FileSpec, countsAsMarkdown = true): Promise<boolean> => {
    if (cancelled()) {
      out.cancelled = true;
      return false;
    }
    const chars = spec.kind === 'parts' ? spec.parts.reduce((n, p) => n + p.body.length, 0) : spec.text.length;
    if (countsAsMarkdown) out.chars += chars;
    await sink.put(spec);
    out.files++;
    progress('write', ++done, total);
    return true;
  };
  const asParts = (rel: string, parts: Part[]): FileSpec => ({ kind: 'parts', rel, parts, layout: layoutParts });

  if (!(await put(asParts('CLAUDE.md', [guidePart({ lang, name: o.libraryName, hasSources: selection.sources, mcpHint: c.config.mcp.enabled })])))) return out;
  if (!(await put(asParts('INDEX.md', [idx.part])))) return out;
  for (const [i, t] of tagList.entries()) {
    const parts = conceptParts({ slug: tagSlug.get(t.id) as string, label: t.label, kind: 'tag', aiLabel: false, terms: [], papers: t.ids.map(paperLine) }, lang);
    if (!(await put({ kind: 'parts', rel: conceptPath(slugList[i] as string), parts, layout: layoutParts }))) return out;
  }
  for (const k of clusterList) {
    const parent = k.parent >= 0 ? clusterSlug.get(k.parent) : undefined;
    const parentLabel = parent ? clusterList.find((x) => x.idx === k.parent)?.label : undefined;
    const parts = conceptParts({ slug: clusterSlug.get(k.idx) as string, label: k.label, kind: 'cluster', aiLabel: k.ai, terms: k.terms, parent: parent && parentLabel ? { slug: parent, label: parentLabel } : undefined, papers: k.ids.map(paperLine) }, lang);
    if (!(await put({ kind: 'parts', rel: conceptPath(clusterSlug.get(k.idx) as string), parts, layout: layoutParts }))) return out;
  }
  for (const f of commands) if (!(await put({ kind: 'whole', rel: f.rel, text: f.text }))) return out;
  const citeEdges: Array<[string, string]> = [];
  for (const d of docs) for (const l of refsOf.get(d.id) ?? []) if (l.matchedDocId && l.matchedDocId !== d.id && selected.has(l.matchedDocId)) citeEdges.push([key(d), key(selected.get(l.matchedDocId) as DocumentRecord)]);
  const graph = graphJson({
    papers: docs.map((d) => ({ citekey: key(d), docId: d.id, title: titleOf(d), year: d.year, tags: d.tags.map((t) => lookup.tagLabel(t) ?? t), concepts: (conceptsOfDoc.get(d.id) ?? []).map((k) => k.slug) })),
    concepts: [...tagList.map((t) => ({ slug: tagSlug.get(t.id) as string, label: t.label, kind: 'tag' as const })), ...clusterList.map((k) => ({ slug: clusterSlug.get(k.idx) as string, label: k.label, kind: 'cluster' as const }))],
    cites: citeEdges,
  });
  if (!(await put({ kind: 'whole', rel: 'graph.json', text: graph }, false))) return out;
  if (!(await put({ kind: 'once', rel: 'notes/README.md', text: notesReadme(lang) }))) return out;
  if (selection.sources === 'paths') {
    const rows = docs.map((d) => `${key(d)}\t${path.join(rt.store.rootPath, ...d.path.split('/'))}`);
    if (!(await put({ kind: 'whole', rel: 'sources/paths.tsv', text: `${rows.join('\n')}\n` }, false))) return out;
  }

  // Cards, one at a time (notes and highlights are read as each card is made).
  for (const d of docs) {
    const notes = selection.includeNotes ? await rt.store.notes.listForDocument(d.id as DocumentId).catch(() => []) : [];
    const ann = selection.includeAnnotations ? await rt.store.annotations.get(d.id as DocumentId).catch(() => null) : null;
    const description: MarkedText | undefined = d.userDescription ? { text: d.userDescription, ai: false, reviewed: true } : marked(d.ai.description);
    const input: CardInput = {
      docId: d.id,
      citekey: key(d),
      title: titleOf(d),
      authors: d.authors,
      year: d.year,
      venue: d.ref.venue,
      arxivId: d.arxivId,
      doi: d.doi,
      tags: d.tags.map((t) => lookup.tagLabel(t) ?? t),
      study: d.study.state,
      underlined: d.study.underlined.value,
      description,
      summary: marked(d.ai.summary),
      notes: notes.map((n) => ({ page: n.frontmatter.scope === 'page' ? (n.frontmatter.page ?? null) : null, body: n.body.slice(0, 8000) })).filter((n) => n.body.trim() !== ''),
      highlights: (ann?.annotations ?? [])
        .filter((a) => a.text.trim() !== '' || a.comment)
        .sort((a, b) => a.page - b.page)
        .slice(0, HIGHLIGHTS_PER_CARD)
        .map((a) => ({ page: a.page, text: a.text, comment: a.comment, kind: a.kind })),
      cites: cites(d),
      citedBy: citedBy(d),
      concepts: conceptsOfDoc.get(d.id) ?? [],
    };
    if (!(await put({ kind: 'parts', rel: cardPath(key(d)), parts: cardParts(input, lang), layout: (p) => layoutCard(p, lang) }))) return out;
  }

  // Sources: copies (originals are only read) or the sizes for the estimate.
  if (selection.sources === 'copies') {
    let copied = 0;
    for (const d of docs) {
      if (cancelled()) {
        out.cancelled = true;
        return out;
      }
      const ext = path.extname(d.path).slice(1).toLowerCase();
      if (!d.missing && COPY_EXT.test(ext)) {
        try {
          const src = await resolveInRoot(rt.store.rootPath, d.path);
          out.copyBytes += await sink.copy(src, `sources/${key(d)}.${ext}`);
        } catch (e) {
          o.s.log.warn('a source file could not be copied into the export', { error: e });
        }
      }
      progress('copy', ++copied, docs.length);
    }
  }
  return out;
}

/** A merge of one file against what the folder holds: the pure part of the sinks. */
export function mergeSpec(spec: FileSpec, existing: string | null, known: { parts?: Record<string, string>; whole?: string } | undefined): { outcome: FileOutcome; text: string | null; entry: { parts?: Record<string, string>; whole?: string } | null } {
  if (spec.kind === 'once') return { outcome: existing === null ? 'new' : 'unchanged', text: existing === null ? spec.text : null, entry: null };
  if (spec.kind === 'whole') {
    if (existing === null) return { outcome: 'new', text: spec.text, entry: { whole: sha256(spec.text) } };
    if (known?.whole === undefined || sha256(existing) !== known.whole) return { outcome: 'kept-edited', text: null, entry: null };
    if (existing === spec.text) return { outcome: 'unchanged', text: null, entry: { whole: known.whole } };
    return { outcome: 'updated', text: spec.text, entry: { whole: sha256(spec.text) } };
  }
  const r = mergeParts(existing, spec.parts, known?.parts, spec.layout);
  if (r.status === 'kept-edited') return { outcome: 'kept-edited', text: null, entry: null };
  return { outcome: r.status, text: r.status === 'new' || r.status === 'updated' ? r.text : null, entry: { parts: r.hashes } };
}
